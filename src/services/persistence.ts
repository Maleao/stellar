import {
  ACHIEVEMENTS,
  applyRun,
  defaultProfile,
  isTrailUnlocked,
  type AchievementId,
  type ApplyResult,
  type GuideMode,
  type MotionPref,
  type Profile,
  type RunSummary,
  type Settings,
  type TrailId,
  TRAILS,
} from '../core/progression';

export const STORAGE_KEY = 'estilingue-estelar/save';
export const SCHEMA_VERSION = 1;

/** Abstração mínima de armazenamento (localStorage, memória ou falso em testes). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export type StorageStatus = 'ok' | 'unavailable' | 'future-version';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number => Math.floor(num(v, fallback, 0, max));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const ACH_IDS = ACHIEVEMENTS.map((a) => a.id);
const TRAIL_IDS = TRAILS.map((t) => t.id);
const MAX_SCORE = 10_000_000;

/**
 * Valida campo a campo. Campos ausentes ou com tipo errado recebem o padrão; o resto é preservado.
 * Nunca lança.
 */
export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isObj(raw)) return d;
  const best = isObj(raw.best) ? raw.best : {};
  const totals = isObj(raw.totals) ? raw.totals : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const achievements = Array.isArray(raw.achievements)
    ? [...new Set(raw.achievements.filter((a): a is AchievementId => ACH_IDS.includes(a as AchievementId)))]
    : [];
  const s: Settings = {
    masterVolume: num(settings.masterVolume, d.settings.masterVolume, 0, 1),
    music: bool(settings.music, d.settings.music),
    sfx: bool(settings.sfx, d.settings.sfx),
    motion: oneOf<MotionPref>(settings.motion, ['auto', 'reduced', 'full'], d.settings.motion),
    guide: oneOf<GuideMode>(settings.guide, ['start', 'always', 'never'], d.settings.guide),
  };
  const p: Profile = {
    schemaVersion: 1,
    best: { travessia: int(best.travessia, 0, MAX_SCORE), infinito: int(best.infinito, 0, MAX_SCORE) },
    bestDepth: int(raw.bestDepth, 0, 1_000_000),
    totals: {
      runs: int(totals.runs, 0),
      motes: int(totals.motes, 0),
      perfects: int(totals.perfects, 0),
      victories: int(totals.victories, 0),
      stars: int(totals.stars, 0),
    },
    achievements,
    trail: oneOf<TrailId>(raw.trail, TRAIL_IDS, 'cometa'),
    settings: s,
    tutorialDone: bool(raw.tutorialDone, false),
    appliedRuns: Array.isArray(raw.appliedRuns)
      ? raw.appliedRuns.filter((r): r is string => typeof r === 'string' && r.length < 64).slice(-30)
      : [],
  };
  if (!isTrailUnlocked(p, p.trail)) p.trail = 'cometa';
  // Coerência: vitória implica a conquista correspondente (e vice-versa).
  if (p.totals.victories > 0 && !p.achievements.includes('travessia')) p.achievements.push('travessia');
  if (p.achievements.includes('travessia') && p.totals.victories === 0) p.totals.victories = 1;
  return p;
}

/**
 * Migrações de esquema: cada entrada converte da versão N para N+1.
 * A versão 0 representa saves pré-versionamento (apenas { best: number }).
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  0: (raw) => ({ ...raw, schemaVersion: 1, best: { travessia: typeof raw.best === 'number' ? raw.best : 0, infinito: 0 } }),
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> | 'future' {
  let version = typeof raw.schemaVersion === 'number' && Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) return 'future';
  let data = raw;
  while (version < SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) return { schemaVersion: SCHEMA_VERSION };
    data = m(data);
    version += 1;
  }
  return data;
}

export class PersistenceService {
  private cache: Profile;
  private statusValue: StorageStatus = 'ok';
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore | null) {
    this.store = store ?? new MemoryStore();
    if (!store) this.statusValue = 'unavailable';
    this.cache = this.read();
  }

  /** Cria o serviço usando localStorage quando possível, senão memória. */
  static forBrowser(): PersistenceService {
    let ls: Storage | null = null;
    try {
      ls = window.localStorage;
      const probe = `${STORAGE_KEY}/probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
    } catch {
      ls = null;
    }
    return new PersistenceService(ls);
  }

  get status(): StorageStatus {
    return this.statusValue;
  }

  get profile(): Profile {
    return this.cache;
  }

  /** Lê, valida e migra. Em caso de qualquer falha, devolve o padrão sem lançar. */
  private read(): Profile {
    let text: string | null = null;
    try {
      text = this.store.getItem(STORAGE_KEY);
    } catch {
      this.statusValue = 'unavailable';
      return this.cache ?? defaultProfile();
    }
    if (text === null) return defaultProfile();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return defaultProfile(); // corrompido: começa do zero; será sobrescrito na próxima gravação válida
    }
    if (!isObj(parsed)) return defaultProfile();
    const migrated = migrate(parsed);
    if (migrated === 'future') {
      // Save de uma versão mais nova do jogo: não sobrescrever para não destruir o progresso.
      this.statusValue = 'future-version';
      return sanitizeProfile(parsed);
    }
    return sanitizeProfile(migrated);
  }

  /** Recarrega do armazenamento (ex.: outra aba gravou). */
  reload(): Profile {
    this.cache = this.read();
    return this.cache;
  }

  /**
   * Leitura fresca → mutação → gravação. Assim, gravações de outra aba feitas entre
   * duas operações desta não são perdidas (merge-on-write).
   */
  private update(mutate: (fresh: Profile) => Profile): Profile {
    const fresh = this.statusValue === 'unavailable' ? this.cache : this.read();
    const next = sanitizeProfile(mutate(fresh));
    this.cache = next;
    if (this.statusValue === 'ok') {
      try {
        this.store.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        this.statusValue = 'unavailable'; // cota cheia, modo privado etc.: segue em memória
      }
    }
    return next;
  }

  commitRun(run: RunSummary): ApplyResult {
    let result: ApplyResult = { profile: this.cache, applied: false, newRecord: false, newAchievements: [] };
    this.update((fresh) => {
      result = applyRun(fresh, run);
      return result.profile;
    });
    return { ...result, profile: this.cache };
  }

  updateSettings(patch: Partial<Settings>): Profile {
    return this.update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  }

  setTrail(trail: TrailId): Profile {
    return this.update((p) => (isTrailUnlocked(p, trail) ? { ...p, trail } : p));
  }

  setTutorialDone(done: boolean): Profile {
    return this.update((p) => ({ ...p, tutorialDone: done }));
  }

  /** Apaga progresso mantendo as configurações. */
  resetProgress(): Profile {
    return this.update((p) => ({ ...defaultProfile(), settings: p.settings }));
  }
}

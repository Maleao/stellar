import { CONFIG, type GameMode } from './config';
import type { DeathCause, RunStats } from './types';

export type TrailId = 'cometa' | 'ambar' | 'aurora' | 'supernova';
export type GuideMode = 'start' | 'always' | 'never';
export type MotionPref = 'auto' | 'reduced' | 'full';

export interface Settings {
  masterVolume: number;
  music: boolean;
  sfx: boolean;
  motion: MotionPref;
  guide: GuideMode;
}

export interface Profile {
  schemaVersion: 1;
  best: Record<GameMode, number>;
  bestDepth: number;
  totals: { runs: number; motes: number; perfects: number; victories: number; stars: number };
  achievements: AchievementId[];
  trail: TrailId;
  settings: Settings;
  tutorialDone: boolean;
  /** Últimos runIds aplicados — torna a gravação do resultado idempotente. */
  appliedRuns: string[];
}

export interface RunSummary {
  runId: string;
  mode: GameMode;
  seed: number;
  score: number;
  depth: number;
  victory: boolean;
  cause: DeathCause | null;
  stats: RunStats;
  ticks: number;
}

export type AchievementId =
  | 'primeiro-salto'
  | 'rente'
  | 'em-chamas'
  | 'salto-duplo'
  | 'setor-3'
  | 'colecionador'
  | 'supernova'
  | 'travessia';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  description: string;
  unlocksTrail?: TrailId;
  test: (run: RunSummary, profile: Profile) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'primeiro-salto', name: 'Primeiro Salto', description: 'Alcance a estrela 2.', test: (r) => r.depth >= 2 },
  { id: 'rente', name: 'Rente ao Núcleo', description: 'Faça um Perfeito.', test: (r) => r.stats.perfects >= 1 },
  { id: 'em-chamas', name: 'Em Chamas', description: 'Chegue ao multiplicador ×5.', test: (r) => r.stats.maxCombo >= 5 },
  { id: 'salto-duplo', name: 'Salto Duplo', description: 'Pule uma estrela inteira.', test: (r) => r.stats.skips >= 1 },
  {
    id: 'setor-3',
    name: 'Setor 3',
    description: 'Alcance a estrela 21.',
    unlocksTrail: 'ambar',
    test: (r) => r.depth >= 21,
  },
  {
    id: 'colecionador',
    name: 'Colecionador',
    description: 'Colete 200 fragmentos no total.',
    unlocksTrail: 'aurora',
    test: (_r, p) => p.totals.motes >= 200,
  },
  { id: 'supernova', name: 'Supernova', description: 'Chegue ao multiplicador ×8.', test: (r) => r.stats.maxCombo >= CONFIG.COMBO_MAX },
  {
    id: 'travessia',
    name: 'Travessia',
    description: 'Alcance o Farol e vença. Libera o Modo Infinito.',
    unlocksTrail: 'supernova',
    test: (r) => r.victory,
  },
];

export const TRAILS: readonly { id: TrailId; name: string; requires: AchievementId | null }[] = [
  { id: 'cometa', name: 'Cometa', requires: null },
  { id: 'ambar', name: 'Âmbar', requires: 'setor-3' },
  { id: 'aurora', name: 'Aurora', requires: 'colecionador' },
  { id: 'supernova', name: 'Supernova', requires: 'travessia' },
];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  masterVolume: 0.7,
  music: true,
  sfx: true,
  motion: 'auto',
  guide: 'start',
};

export function defaultProfile(): Profile {
  return {
    schemaVersion: 1,
    best: { travessia: 0, infinito: 0 },
    bestDepth: 0,
    totals: { runs: 0, motes: 0, perfects: 0, victories: 0, stars: 0 },
    achievements: [],
    trail: 'cometa',
    settings: { ...DEFAULT_SETTINGS },
    tutorialDone: false,
    appliedRuns: [],
  };
}

export const isTrailUnlocked = (p: Profile, id: TrailId): boolean => {
  const t = TRAILS.find((x) => x.id === id);
  return !!t && (t.requires === null || p.achievements.includes(t.requires));
};

export const isInfiniteUnlocked = (p: Profile): boolean => p.totals.victories > 0;

export interface ApplyResult {
  profile: Profile;
  applied: boolean;
  newRecord: boolean;
  newAchievements: AchievementDef[];
}

const MAX_APPLIED_RUNS = 30;

/** Aplica o resultado de uma partida ao perfil. Puro e idempotente por runId. */
export function applyRun(input: Profile, run: RunSummary): ApplyResult {
  if (input.appliedRuns.includes(run.runId)) {
    return { profile: input, applied: false, newRecord: false, newAchievements: [] };
  }
  const p: Profile = structuredClone(input);
  const score = Math.max(0, Math.floor(run.score));
  const newRecord = score > p.best[run.mode];
  p.best[run.mode] = Math.max(p.best[run.mode], score);
  p.bestDepth = Math.max(p.bestDepth, run.depth);
  p.totals.runs += 1;
  p.totals.motes += run.stats.motes;
  p.totals.perfects += run.stats.perfects;
  p.totals.stars += run.depth;
  p.totals.victories += run.victory ? 1 : 0;
  p.appliedRuns = [...p.appliedRuns, run.runId].slice(-MAX_APPLIED_RUNS);

  const newAchievements: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements.includes(a.id) && a.test(run, p)) {
      p.achievements.push(a.id);
      newAchievements.push(a);
    }
  }
  return { profile: p, applied: true, newRecord: newRecord && score > 0, newAchievements };
}

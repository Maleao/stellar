import { describe, expect, it } from 'vitest';
import { applyRun, defaultProfile, isInfiniteUnlocked, isTrailUnlocked, type RunSummary } from '../../src/core/progression';
import { MemoryStore, migrate, PersistenceService, sanitizeProfile, STORAGE_KEY, type KeyValueStore } from '../../src/services/persistence';

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  runId: 'r1',
  mode: 'travessia',
  seed: 1,
  score: 1000,
  depth: 5,
  victory: false,
  cause: 'core',
  stats: { perfects: 1, maxCombo: 2, motes: 10, skips: 0, perfectStreak: 1 },
  ticks: 1000,
  ...over,
});

describe('progressão', () => {
  it('aplica resultado: recorde, totais e conquistas', () => {
    const r = applyRun(defaultProfile(), summary());
    expect(r.applied).toBe(true);
    expect(r.newRecord).toBe(true);
    expect(r.profile.best.travessia).toBe(1000);
    expect(r.profile.totals).toMatchObject({ runs: 1, motes: 10, perfects: 1, stars: 5 });
    expect(r.newAchievements.map((a) => a.id).sort()).toEqual(['primeiro-salto', 'rente']);
  });

  it('é idempotente por runId (resultado não é processado duas vezes)', () => {
    const once = applyRun(defaultProfile(), summary()).profile;
    const twice = applyRun(once, summary());
    expect(twice.applied).toBe(false);
    expect(twice.profile.totals.runs).toBe(1);
  });

  it('conquista é concedida uma única vez e desbloqueia rastro/modo', () => {
    let p = applyRun(defaultProfile(), summary({ runId: 'a', victory: true, depth: 50 })).profile;
    expect(isTrailUnlocked(p, 'supernova')).toBe(true);
    expect(isTrailUnlocked(p, 'aurora')).toBe(false);
    expect(isInfiniteUnlocked(p)).toBe(true);
    const again = applyRun(p, summary({ runId: 'b', victory: true, depth: 50 }));
    expect(again.newAchievements.some((a) => a.id === 'travessia')).toBe(false);
    p = again.profile;
    expect(p.achievements.filter((a) => a === 'travessia')).toHaveLength(1);
  });

  it('pontuação menor não é recorde e não reduz o melhor', () => {
    const p = applyRun(defaultProfile(), summary({ runId: 'a', score: 900 })).profile;
    const r = applyRun(p, summary({ runId: 'b', score: 100 }));
    expect(r.newRecord).toBe(false);
    expect(r.profile.best.travessia).toBe(900);
  });

  it('fragmentos acumulados liberam Colecionador ao cruzar 200', () => {
    let p = defaultProfile();
    for (let i = 0; i < 19; i++) p = applyRun(p, summary({ runId: `m${i}` })).profile;
    expect(p.achievements).not.toContain('colecionador');
    const r = applyRun(p, summary({ runId: 'm19' }));
    expect(r.newAchievements.map((a) => a.id)).toContain('colecionador');
  });
});

describe('validação e migração', () => {
  it('dados ausentes, de tipo errado ou absurdos recebem padrões seguros', () => {
    expect(sanitizeProfile(null)).toEqual(defaultProfile());
    expect(sanitizeProfile('lixo')).toEqual(defaultProfile());
    const p = sanitizeProfile({
      best: { travessia: -50, infinito: 'muito' },
      bestDepth: Infinity,
      totals: { runs: 3.7, motes: NaN },
      achievements: ['rente', 'inexistente', 'rente', 42],
      trail: 'supernova', // ainda bloqueado → volta ao padrão
      settings: { masterVolume: 9, music: 'sim', guide: 'talvez', motion: 'reduced' },
      tutorialDone: 1,
      appliedRuns: 'x',
    });
    expect(p.best).toEqual({ travessia: 0, infinito: 0 });
    expect(p.bestDepth).toBe(0);
    expect(p.totals.runs).toBe(3);
    expect(p.totals.motes).toBe(0);
    expect(p.achievements).toEqual(['rente']);
    expect(p.trail).toBe('cometa');
    expect(p.settings).toEqual({ masterVolume: 1, music: true, sfx: true, motion: 'reduced', guide: 'start' });
    expect(p.tutorialDone).toBe(false);
    expect(p.appliedRuns).toEqual([]);
  });

  it('migra save legado (v0) e recusa versão futura', () => {
    const m = migrate({ best: 777 });
    expect(m).not.toBe('future');
    expect(sanitizeProfile(m).best.travessia).toBe(777);
    expect(migrate({ schemaVersion: 99 })).toBe('future');
  });
});

describe('PersistenceService', () => {
  it('recupera após recarregar', () => {
    const store = new MemoryStore();
    const a = new PersistenceService(store);
    a.commitRun(summary());
    a.updateSettings({ music: false });
    const b = new PersistenceService(store);
    expect(b.profile.best.travessia).toBe(1000);
    expect(b.profile.settings.music).toBe(false);
    expect(b.status).toBe('ok');
  });

  it('JSON corrompido não quebra: começa do zero e grava por cima na próxima gravação', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEY, '{"best": {"travessia": 5'); // truncado
    const s = new PersistenceService(store);
    expect(s.profile).toEqual(defaultProfile());
    s.commitRun(summary());
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).best.travessia).toBe(1000);
  });

  it('armazenamento que lança erro: jogo segue em memória e informa o status', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const s = new PersistenceService(throwing);
    expect(s.status).toBe('unavailable');
    const r = s.commitRun(summary());
    expect(r.profile.best.travessia).toBe(1000);
    expect(s.profile.best.travessia).toBe(1000);
  });

  it('gravação falha por cota: degrada para memória sem lançar', () => {
    const store = new MemoryStore();
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const s = new PersistenceService(store);
    expect(() => s.commitRun(summary())).not.toThrow();
    expect(s.status).toBe('unavailable');
    expect(s.profile.totals.runs).toBe(1);
  });

  it('duas abas gravando não apagam o progresso uma da outra (merge-on-write)', () => {
    const store = new MemoryStore();
    const tabA = new PersistenceService(store);
    const tabB = new PersistenceService(store); // ambas leram o save vazio
    tabA.commitRun(summary({ runId: 'a', score: 500, stats: { perfects: 0, maxCombo: 1, motes: 3, skips: 0, perfectStreak: 0 } }));
    tabB.commitRun(summary({ runId: 'b', score: 300, stats: { perfects: 0, maxCombo: 1, motes: 4, skips: 0, perfectStreak: 0 } }));
    tabB.updateSettings({ sfx: false });
    const fresh = new PersistenceService(store).profile;
    expect(fresh.totals.runs).toBe(2);
    expect(fresh.totals.motes).toBe(7);
    expect(fresh.best.travessia).toBe(500);
    expect(fresh.settings.sfx).toBe(false);
  });

  it('save de versão futura não é sobrescrito', () => {
    const store = new MemoryStore();
    const future = JSON.stringify({ schemaVersion: 7, best: { travessia: 99999 } });
    store.setItem(STORAGE_KEY, future);
    const s = new PersistenceService(store);
    expect(s.status).toBe('future-version');
    s.commitRun(summary());
    expect(store.getItem(STORAGE_KEY)).toBe(future);
  });

  it('resetProgress apaga progresso e mantém configurações; setTrail só aceita rastro liberado', () => {
    const s = new PersistenceService(new MemoryStore());
    s.updateSettings({ masterVolume: 0.2 });
    s.commitRun(summary());
    s.setTrail('aurora');
    expect(s.profile.trail).toBe('cometa');
    s.resetProgress();
    expect(s.profile.totals.runs).toBe(0);
    expect(s.profile.settings.masterVolume).toBe(0.2);
  });
});

import { describe, expect, it } from 'vitest';
import { releaseSearch, findRelease } from '../../src/core/bot';
import { createRun } from '../../src/core/simulation';
import { MAX_PARTICLES, Particles } from '../../src/render/particles';
import { AudioManager } from '../../src/services/audio';

describe('AudioManager sem Web Audio (ex.: navegador antigo, ambiente sem som)', () => {
  it('nenhum método lança e o estado indica falha', () => {
    const a = new AudioManager();
    expect(() => {
      a.unlock();
      a.setSettings({ masterVolume: 5, music: true, sfx: true });
      a.setMusic(true);
      a.setIntensity(2);
      a.setDucked(true);
      for (const n of ['release', 'capture', 'perfect', 'mote', 'warn', 'death', 'victory', 'ui', 'skip'] as const) a.play(n, { combo: 3 });
      a.update();
    }).not.toThrow();
    expect(a.available).toBe(false);
    expect(a.state).toBe('failed');
    expect(a.activeVoices).toBe(0);
  });
});

describe('partículas', () => {
  it('têm teto fixo e expiram', () => {
    const p = new Particles();
    for (let i = 0; i < 100; i++) p.burst(0, 0, 50, '#fff');
    expect(p.list.length).toBe(MAX_PARTICLES);
    for (let i = 0; i < 300; i++) p.update(1 / 60);
    expect(p.list.length).toBe(0);
    p.density = 0.35;
    p.burst(0, 0, 10, '#fff');
    expect(p.list.length).toBe(4);
  });
});

describe('busca incremental do bot', () => {
  it('cede controle durante a busca e chega ao mesmo plano da busca direta', () => {
    const run = createRun(2024);
    const gen = releaseSearch(run, { strategy: 'best', stride: 3, horizon: 140 });
    let yields = 0;
    let r = gen.next();
    while (!r.done) {
      yields++;
      r = gen.next();
    }
    expect(yields).toBeGreaterThan(1);
    expect(r.value).toEqual(findRelease(run, { strategy: 'best', stride: 3, horizon: 140 }));
  });
});

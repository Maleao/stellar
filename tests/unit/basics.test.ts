import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/core/config';
import { closestOnSegment, wrapAngle } from '../../src/core/math';
import { canTransition, PhaseMachine, type Phase } from '../../src/core/phase';
import { hashSeed, mulberry32, normalizeSeed, rngFor } from '../../src/core/rng';
import { FixedStepAccumulator } from '../../src/loop';
import { createRun, stateHash, step } from '../../src/core/simulation';

describe('rng', () => {
  it('é determinístico, no intervalo [0,1) e bem distribuído', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 50_000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
      buckets[Math.floor(x * 10)]++;
    }
    for (const c of buckets) expect(Math.abs(c - 5000)).toBeLessThan(400);
  });

  it('hashSeed separa índices e sais', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(hashSeed(1, i));
    expect(seen.size).toBe(1000);
    expect(rngFor(1, 5, 1)()).not.toBe(rngFor(1, 5, 2)());
  });

  it('normalizeSeed rejeita entradas inválidas', () => {
    expect(normalizeSeed('123')).toBe(123);
    expect(normalizeSeed(4294967295)).toBe(4294967295);
    for (const bad of ['abc', '', -1, 1.5, NaN, Infinity, 2 ** 33, null, {}]) expect(normalizeSeed(bad)).toBeNull();
  });
});

describe('geometria', () => {
  it('ponto mais próximo em segmento', () => {
    expect(closestOnSegment(0, 0, 10, 0, 5, 3)).toMatchObject({ t: 0.5, distance: 3 });
    expect(closestOnSegment(0, 0, 10, 0, -5, 0)).toMatchObject({ t: 0, distance: 5 });
    expect(closestOnSegment(0, 0, 10, 0, 20, 0)).toMatchObject({ t: 1, distance: 10 });
    expect(closestOnSegment(1, 1, 1, 1, 4, 5)).toMatchObject({ t: 0, distance: 5 }); // segmento degenerado
  });
  it('wrapAngle normaliza', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBe(0.5);
  });
});

describe('máquina de estados', () => {
  it('aceita somente transições válidas', () => {
    const m = new PhaseMachine();
    const log: string[] = [];
    m.onChange((to, from) => log.push(`${from}>${to}`));
    expect(m.go('PLAYING')).toBe(false); // BOOT não vai direto ao jogo
    expect(m.go('MENU')).toBe(true);
    expect(m.go('RESULTS')).toBe(false);
    expect(m.go('PLAYING')).toBe(true);
    expect(m.go('PLAYING')).toBe(false); // não inicia duas partidas
    expect(m.go('MENU')).toBe(false); // precisa pausar antes
    expect(m.go('PAUSED')).toBe(true);
    expect(m.go('PLAYING')).toBe(true);
    expect(m.go('ENDING')).toBe(true);
    expect(m.go('PAUSED')).toBe(false); // não pausa durante o encerramento
    expect(m.go('PLAYING')).toBe(false); // resultados não podem ser pulados
    expect(m.go('RESULTS')).toBe(true);
    expect(m.go('PLAYING')).toBe(true);
    expect(log).toEqual(['BOOT>MENU', 'MENU>PLAYING', 'PLAYING>PAUSED', 'PAUSED>PLAYING', 'PLAYING>ENDING', 'ENDING>RESULTS', 'RESULTS>PLAYING']);
  });

  it('tabela completa: nada sai de ENDING exceto RESULTS', () => {
    const all: Phase[] = ['BOOT', 'MENU', 'PLAYING', 'PAUSED', 'ENDING', 'RESULTS'];
    expect(all.filter((p) => canTransition('ENDING', p))).toEqual(['RESULTS']);
  });
});

describe('loop de passo fixo', () => {
  it('converte deltas variados no mesmo número de ticks (independente de FPS)', () => {
    const run = (deltas: number[]): number => {
      const acc = new FixedStepAccumulator();
      return deltas.reduce((n, d) => n + acc.consume(d), 0);
    };
    const at30 = run(new Array(300).fill(1 / 30));
    const at144 = run(new Array(1440).fill(1 / 144));
    const jitter = run(Array.from({ length: 1000 }, (_, i) => (i % 3 === 0 ? 0.004 : i % 3 === 1 ? 0.012 : 0.014)));
    expect(at30).toBe(1200);
    expect(at144).toBe(1200);
    expect(Math.abs(jitter - 1200)).toBeLessThanOrEqual(1);
  });

  it('limita o delta após perda de foco e ignora deltas inválidos', () => {
    const acc = new FixedStepAccumulator();
    expect(acc.consume(30)).toBe(Math.round(CONFIG.MAX_FRAME_DELTA / CONFIG.TICK));
    for (const bad of [NaN, -1, 0, Infinity]) expect(acc.consume(bad)).toBe(0);
  });

  it('mesma duração em FPS diferentes produz o mesmo estado de jogo', () => {
    const simulate = (deltas: number[]): string => {
      const acc = new FixedStepAccumulator();
      const r = createRun(55);
      for (const d of deltas) for (let k = acc.consume(d); k > 0; k--) step(r, r.tick === 240);
      return stateHash(r);
    };
    expect(simulate(new Array(180).fill(1 / 60))).toBe(simulate(new Array(360).fill(1 / 120)));
  });
});

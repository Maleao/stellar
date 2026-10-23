import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/core/config';
import { difficultyAt, isHaven, rampProgress, sectorOf } from '../../src/core/difficulty';
import { createRun } from '../../src/core/simulation';
import type { Anchor } from '../../src/core/types';
import { debrisXAt, generateAnchor, generateDebris, generateMotes } from '../../src/core/world';

const SEEDS = Array.from({ length: 60 }, (_, i) => (i + 1) * 2654435761 >>> 0);

function chain(seed: number, n: number, mode: 'travessia' | 'infinito' = 'infinito'): Anchor[] {
  const out: Anchor[] = [generateAnchor(seed, 0, null, mode)];
  for (let i = 1; i <= n; i++) out.push(generateAnchor(seed, i, out[i - 1]!, mode));
  return out;
}

describe('dificuldade', () => {
  it('é monotônica, limitada e depende só do índice', () => {
    let prev = difficultyAt(0);
    for (let i = 1; i <= 120; i++) {
      const d = difficultyAt(i);
      expect(d.angularSpeed).toBeGreaterThanOrEqual(prev.angularSpeed);
      expect(d.captureRadius).toBeLessThanOrEqual(prev.captureRadius);
      expect(d.collapseTime).toBeLessThanOrEqual(prev.collapseTime);
      expect(d.collapseTime).toBeGreaterThanOrEqual(CONFIG.RANGE.collapseTime[1]);
      prev = d;
    }
    expect(rampProgress(-5)).toBe(0);
    expect(rampProgress(10_000)).toBe(1);
    expect(difficultyAt(CONFIG.DEBRIS_FROM - 1).debrisPerGap).toBe(0);
  });

  it('setores e refúgios a cada 10 estrelas', () => {
    expect(sectorOf(0)).toBe(1);
    expect(sectorOf(9)).toBe(1);
    expect(sectorOf(10)).toBe(2);
    expect([0, 10, 20, 35].map(isHaven)).toEqual([false, true, true, false]);
  });
});

describe('geração de estrelas', () => {
  it('respeita limites, espaçamento e ordem vertical em 60 sementes', () => {
    for (const seed of SEEDS) {
      const as = chain(seed, 120);
      for (let i = 1; i < as.length; i++) {
        const a = as[i]!;
        const p = as[i - 1]!;
        const d = difficultyAt(i);
        const amp = a.move?.amplitude ?? 0;
        expect(a.baseX - amp).toBeGreaterThanOrEqual(CONFIG.ANCHOR_MIN_X - 1e-9);
        expect(a.baseX + amp).toBeLessThanOrEqual(CONFIG.ANCHOR_MAX_X + 1e-9);
        const gap = p.y - a.y;
        expect(gap).toBeGreaterThanOrEqual(d.gapMin - 1e-9);
        expect(gap).toBeLessThanOrEqual(d.gapMax + 1e-9);
        // A órbita estável da anterior nunca toca a zona de captura da seguinte (inclusive com movimento).
        expect(gap).toBeGreaterThan(CONFIG.ORBIT_RADIUS + CONFIG.PLAYER_RADIUS + a.captureRadius);
        if (i < CONFIG.MOVING_FROM) expect(a.move).toBeNull();
      }
    }
  });

  it('refúgios são generosos e o Farol existe só na Travessia, no índice final', () => {
    const t = chain(7, CONFIG.FINAL_INDEX, 'travessia');
    expect(t[CONFIG.FINAL_INDEX]!.final).toBe(true);
    expect(t.filter((a) => a.final)).toHaveLength(1);
    for (const a of t.filter((x) => x.haven)) {
      expect(a.captureRadius).toBe(CONFIG.HAVEN.captureRadius);
      expect(a.collapseTime).toBe(CONFIG.HAVEN.collapseTime);
      expect(a.move).toBeNull();
    }
    expect(chain(7, 80, 'infinito').some((a) => a.final)).toBe(false);
  });

  it('geração preguiçosa da partida é idêntica à geração direta', () => {
    const run = createRun(31337, 'travessia');
    const direct = chain(31337, run.generatedUpTo, 'travessia');
    for (const a of run.anchors) {
      expect(a.baseX).toBe(direct[a.index]!.baseX);
      expect(a.y).toBe(direct[a.index]!.y);
    }
  });
});

describe('fragmentos e detritos', () => {
  it('detritos nunca cruzam uma órbita estável (justiça) e ficam dentro do campo', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const as = chain(seed, 120);
      for (let i = 1; i < as.length; i++) {
        for (const d of generateDebris(seed, as[i - 1]!, as[i]!)) {
          total++;
          const keep = CONFIG.ORBIT_RADIUS + CONFIG.PLAYER_RADIUS + d.radius;
          for (const a of [as[i - 1]!, as[i]!]) expect(Math.abs(d.y - a.y)).toBeGreaterThan(keep);
          for (let t = 0; t < 60; t += 0.37) {
            const x = debrisXAt(d, t);
            expect(x).toBeGreaterThanOrEqual(d.minX - 1e-9);
            expect(x).toBeLessThanOrEqual(d.maxX + 1e-9);
          }
        }
        if (i - 1 < CONFIG.DEBRIS_FROM || as[i]!.haven || as[i - 1]!.haven) {
          expect(generateDebris(seed, as[i - 1]!, as[i]!)).toEqual([]);
        }
      }
    }
    expect(total).toBeGreaterThan(500); // os detritos de fato aparecem
  });

  it('movimento do detrito é contínuo (reflete, não teleporta)', () => {
    const d = { id: 1, x0: 100, x: 100, y: 0, radius: 10, vx: 120, minX: 10, maxX: 590, spin: 0, shapeSeed: 0 };
    let prev = debrisXAt(d, 0);
    for (let t = 1 / 120; t < 30; t += 1 / 120) {
      const x = debrisXAt(d, t);
      expect(Math.abs(x - prev)).toBeLessThanOrEqual(120 / 120 + 1e-6);
      prev = x;
    }
  });

  it('fragmentos não ficam dentro de nenhuma órbita', () => {
    for (const seed of SEEDS) {
      const as = chain(seed, 60);
      for (let i = 1; i < as.length; i++) {
        for (const m of generateMotes(seed, as[i - 1]!, as[i]!)) {
          for (const a of [as[i - 1]!, as[i]!]) {
            expect(Math.hypot(m.x - a.baseX, m.y - a.y)).toBeGreaterThan(CONFIG.ORBIT_RADIUS + CONFIG.MOTE_RADIUS);
          }
        }
      }
    }
  });
});

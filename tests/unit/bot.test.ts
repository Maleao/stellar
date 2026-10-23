import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/core/config';
import { autoplay, findRelease } from '../../src/core/bot';
import { createRun, step } from '../../src/core/simulation';

/**
 * Integração do núcleo inteiro: o bot usa a mesma simulação que o jogador.
 * Se o gerador criar um trecho impossível, estes testes falham.
 */
describe('solvabilidade do gerador', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

  it('cada estrela da Travessia é alcançável a partir da anterior (24 sementes, sem pular)', () => {
    for (const seed of seeds) {
      const run = autoplay(createRun(seed, 'travessia'), { strategy: 'first', onlyNext: true });
      expect(run.ended, `semente ${seed} parou na estrela ${run.depth}`).toEqual({ kind: 'victory' });
      expect(run.stats.skips).toBe(0);
    }
  }, 240_000);

  it('o Modo Infinito continua solucionável após o platô de dificuldade (120 estrelas)', () => {
    for (const seed of seeds.slice(0, 4)) {
      const run = createRun(seed, 'infinito');
      autoplay(run, { strategy: 'first', onlyNext: true }, 120 * 60 * 6);
      expect(run.depth, `semente ${seed}: ${JSON.stringify(run.ended)}`).toBeGreaterThanOrEqual(120);
      // Memória limitada em partidas longas: entidades antigas são podadas.
      expect(run.anchors.length).toBeLessThanOrEqual(CONFIG.LOOKAHEAD + 4);
      expect(run.motes.length).toBeLessThan(80);
      expect(run.debris.length).toBeLessThan(40);
    }
  }, 240_000);

  it('partidas completas jogadas para pontuar: vitória com Perfeitos, combos e conquistas plausíveis', () => {
    for (const seed of seeds.slice(0, 3)) {
      const run = autoplay(createRun(seed, 'travessia'), { strategy: 'best', stride: 2 });
      expect(run.ended).toEqual({ kind: 'victory' });
      expect(run.stats.perfects).toBeGreaterThan(5);
      expect(run.stats.maxCombo).toBe(CONFIG.COMBO_MAX);
      expect(run.score).toBeGreaterThan(10_000);
    }
  }, 240_000);
});

describe('findRelease', () => {
  it('não altera o estado recebido', () => {
    const run = createRun(4242);
    const before = JSON.stringify(run);
    findRelease(run);
    expect(JSON.stringify(run)).toBe(before);
  });

  it('o plano funciona quando executado na simulação real', () => {
    const run = createRun(4242);
    const plan = findRelease(run)!;
    expect(plan).not.toBeNull();
    for (let i = 0; i < plan.wait; i++) step(run, false);
    step(run, true);
    for (let i = 0; i < plan.flightTicks + 1 && run.depth === 0; i++) step(run, false);
    expect(run.depth).toBe(plan.targetIndex);
  });

  it('retorna null em voo ou após o fim', () => {
    const run = createRun(1);
    step(run, true);
    expect(findRelease(run)).toBeNull();
  });
});

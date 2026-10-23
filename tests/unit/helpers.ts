import { CONFIG } from '../../src/core/config';
import { createRun, step } from '../../src/core/simulation';
import type { Anchor, RunState, SimEvent } from '../../src/core/types';

/**
 * Cenário controlado: jogador orbitando a estrela 0 em (300, 0), no ângulo π (x = 250),
 * girando no sentido horário — soltar no tick 1 lança-o reto para cima (vx = 0, vy < 0) a partir de x = 250.
 * A estrela 1 é posicionada a `offset` u à direita da linha de voo, `gap` u acima.
 */
export function straightUpScenario(offset: number, gap = 250, extra: Partial<Anchor> = {}): RunState {
  const run = createRun(12345, 'travessia');
  run.motes = [];
  run.debris = [];
  const a1 = run.anchors[1]!;
  Object.assign(a1, { baseX: 250 + offset, x: 250 + offset, y: -gap, move: null, haven: false, final: false }, extra);
  // Empurra as demais estrelas para longe para não interferirem.
  for (const a of run.anchors.slice(2)) {
    a.baseX = a.x = 300;
    a.y = -2000 - a.index * 300;
    a.move = null;
  }
  return run;
}

export function stepN(run: RunState, n: number, release = false): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...step(run, release && i === 0));
  return all;
}

/** Avança até um evento do tipo pedido (ou limite). */
export function stepUntil(run: RunState, type: SimEvent['type'], limit = 2000): SimEvent | undefined {
  for (let i = 0; i < limit; i++) {
    const ev = step(run, false).find((e) => e.type === type);
    if (ev) return ev;
    if (run.ended) return undefined;
  }
  return undefined;
}

export const ticks = (seconds: number): number => Math.round(seconds / CONFIG.TICK);

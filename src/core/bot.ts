import { CONFIG } from './config';
import { difficultyAt } from './difficulty';
import { collapseRemaining, step } from './simulation';
import type { RunState } from './types';

export interface ReleasePlan {
  /** Ticks sem soltar antes do tick em que se solta. */
  wait: number;
  targetIndex: number;
  perfect: boolean;
  /** Ticks de voo até a captura. */
  flightTicks: number;
}

export interface BotOptions {
  /** 'first' = primeiro instante viável; 'best' = prefere Perfeito, depois mais pontos. */
  strategy?: 'first' | 'best';
  /** Testa a cada `stride` ticks (1 = exaustivo). */
  stride?: number;
  /** Margem (ticks) antes do colapso que o bot não usa. */
  safety?: number;
  /** Para 'best': não procurar além deste número de ticks se já houver uma opção. */
  horizon?: number;
  /** Só aceita capturar exatamente a próxima estrela (usado para provar solvabilidade de cada trecho). */
  onlyNext?: boolean;
}

const clone = (run: RunState): RunState => structuredClone(run);

/**
 * Filtro rápido: a reta de soltura passa perto de alguma estrela à frente?
 * Conservador (folga para estrelas móveis); só serve para evitar simular voos obviamente perdidos.
 */
function rayMayCapture(run: RunState): boolean {
  const p = run.player;
  if (p.kind !== 'orbit') return false;
  const ux = -Math.sin(p.angle) * p.dir;
  const uy = Math.cos(p.angle) * p.dir;
  const reach = difficultyAt(run.depth).flightSpeed * CONFIG.MAX_FLIGHT_TIME;
  for (const a of run.anchors) {
    if (a.index <= run.depth) continue;
    const rx = a.x - run.x;
    const ry = a.y - run.y;
    const along = rx * ux + ry * uy;
    const slack = a.move ? a.move.amplitude * 2 : 0;
    if (along < -a.captureRadius - slack || along > reach + a.captureRadius + slack) continue;
    if (Math.abs(rx * uy - ry * ux) <= a.captureRadius + slack + 2) return true;
  }
  return false;
}

/** Simula o voo a partir de um estado já em voo até capturar, morrer ou esgotar o tempo. */
function simulateFlight(run: RunState, fromDepth: number): { captured: number | null; perfect: boolean; ticks: number } {
  const maxTicks = Math.ceil(CONFIG.MAX_FLIGHT_TIME / CONFIG.TICK) + 2;
  for (let i = 1; i <= maxTicks; i++) {
    const events = step(run, false);
    for (const e of events) {
      if (e.type === 'capture') return { captured: e.anchorIndex, perfect: e.perfect, ticks: i };
      if (e.type === 'death') return { captured: null, perfect: false, ticks: i };
    }
    if (run.ended) return { captured: null, perfect: false, ticks: i };
    if (run.player.kind === 'orbit' && run.depth > fromDepth) return { captured: run.depth, perfect: false, ticks: i };
  }
  return { captured: null, perfect: false, ticks: maxTicks };
}

/**
 * Busca incremental: cede o controle (yield) após cada voo simulado, para que a camada de
 * apresentação possa repartir o custo entre quadros. Não altera `run`.
 */
export function* releaseSearch(run: RunState, opts: BotOptions = {}): Generator<void, ReleasePlan | null, void> {
  if (run.ended || run.player.kind !== 'orbit') return null;
  const strategy = opts.strategy ?? 'first';
  const stride = Math.max(1, opts.stride ?? 1);
  const safety = opts.safety ?? 2;
  const remaining = collapseRemaining(run) ?? 0;
  const maxWait = Math.max(0, Math.floor(remaining / CONFIG.TICK) - safety);
  const horizon = opts.horizon ?? maxWait;

  const base = clone(run);
  let best: ReleasePlan | null = null;
  let bestScore = -Infinity;

  for (let wait = 0; wait <= maxWait; wait++) {
    if (wait > 0) {
      step(base, false);
      if (base.ended) break;
    }
    if (wait % stride !== 0) continue;
    if (!rayMayCapture(base)) continue;
    const trial = clone(base);
    const startDepth = trial.depth;
    step(trial, true);
    if (trial.ended) continue;
    const r = simulateFlight(trial, startDepth);
    yield;
    if (r.captured === null) continue;
    if (opts.onlyNext && r.captured !== startDepth + 1) continue;
    const plan: ReleasePlan = { wait, targetIndex: r.captured, perfect: r.perfect, flightTicks: r.ticks };
    if (strategy === 'first') return plan;
    const score = (r.perfect ? 1000 : 0) + (r.captured - startDepth) * 300 - wait * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
    if (best && wait >= horizon) break;
  }
  return best;
}

/**
 * Procura, usando a própria simulação, um instante de soltura que leve a uma captura sem morrer.
 * Não altera `run`. Retorna null se nenhuma opção existir antes do colapso.
 */
export function findRelease(run: RunState, opts: BotOptions = {}): ReleasePlan | null {
  const search = releaseSearch(run, opts);
  let r = search.next();
  while (!r.done) r = search.next();
  return r.value;
}

/** Joga uma partida inteira com o bot. Retorna o estado final e quantos ticks levou. */
export function autoplay(run: RunState, opts: BotOptions = {}, maxTicks = 120 * 60 * 15): RunState {
  let plan: ReleasePlan | null = null;
  let searched = false;
  while (!run.ended && run.tick < maxTicks) {
    if (run.player.kind === 'orbit') {
      if (!searched) {
        plan = findRelease(run, opts);
        searched = true;
      }
      if (plan && plan.wait <= 0) {
        step(run, true);
        plan = null;
        searched = false;
        continue;
      }
      if (plan) plan.wait -= 1;
    }
    step(run, false);
  }
  return run;
}

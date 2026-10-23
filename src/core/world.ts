import { CONFIG, type GameMode } from './config';
import { difficultyAt, isHaven } from './difficulty';
import { clamp } from './math';
import { range, rngFor } from './rng';
import type { Anchor, Debris, Mote } from './types';

const SALT_ANCHOR = 1;
const SALT_MOTES = 2;
const SALT_DEBRIS = 3;

/**
 * Gera a estrela `index` a partir da anterior. A aleatoriedade vem de rngFor(seed, index),
 * logo a mesma (semente, índice, anterior) produz sempre a mesma estrela.
 */
export function generateAnchor(seed: number, index: number, prev: Anchor | null, mode: GameMode): Anchor {
  const d = difficultyAt(index);
  const final = mode === 'travessia' && index === CONFIG.FINAL_INDEX;
  const haven = !final && isHaven(index);

  if (index === 0 || prev === null) {
    return {
      index: 0,
      baseX: CONFIG.FIELD_WIDTH / 2,
      x: CONFIG.FIELD_WIDTH / 2,
      y: 0,
      captureRadius: d.captureRadius,
      coreRadius: CONFIG.CORE_RADIUS,
      perfectRadius: CONFIG.PERFECT_RADIUS,
      collapseTime: CONFIG.FIRST_ANCHOR_TIMER,
      move: null,
      haven: false,
      final: false,
    };
  }

  const rng = rngFor(seed, index, SALT_ANCHOR);
  const gap = range(rng, d.gapMin, d.gapMax);

  const moving = !haven && !final && index >= CONFIG.MOVING_FROM && rng() < 0.45;
  const amplitude = moving ? range(rng, d.moveAmplitude * 0.6, d.moveAmplitude) : 0;
  const minX = CONFIG.ANCHOR_MIN_X + amplitude;
  const maxX = CONFIG.ANCHOR_MAX_X - amplitude;

  // Desloca lateralmente com variedade real: evita colunas verticais monótonas.
  // Zigue-zague preferencial: a estrela i+2 raramente fica alinhada com i, o que torna o salto duplo um feito.
  const prevDir = prev.index === 0 ? (rng() < 0.5 ? -1 : 1) : Math.sign(prev.baseX - CONFIG.FIELD_WIDTH / 2) || 1;
  let dx = range(rng, 60, d.maxDx) * (rng() < 0.7 ? -prevDir : prevDir);
  if (prev.baseX + dx < minX || prev.baseX + dx > maxX) dx = -dx;
  const baseX = clamp(prev.baseX + dx, minX, maxX);

  return {
    index,
    baseX,
    x: baseX,
    y: prev.y - gap,
    captureRadius: haven ? CONFIG.HAVEN.captureRadius : final ? Math.max(d.captureRadius, 92) : d.captureRadius,
    coreRadius: final ? CONFIG.CORE_RADIUS + 3 : CONFIG.CORE_RADIUS,
    perfectRadius: final ? CONFIG.PERFECT_RADIUS + 3 : CONFIG.PERFECT_RADIUS,
    collapseTime: haven ? CONFIG.HAVEN.collapseTime : d.collapseTime,
    move: moving ? { amplitude, period: range(rng, d.movePeriod * 0.85, d.movePeriod * 1.15), phase: range(rng, 0, Math.PI * 2) } : null,
    haven,
    final,
  };
}

/** Posição X de uma estrela no tempo t (segundos desde o início da partida). */
export function anchorXAt(a: Anchor, t: number): number {
  if (!a.move) return a.baseX;
  return a.baseX + a.move.amplitude * Math.sin((t / a.move.period) * Math.PI * 2 + a.move.phase);
}

/** Fragmentos no intervalo entre as estrelas a → b (a.index + 1 === b.index). */
export function generateMotes(seed: number, a: Anchor, b: Anchor): Mote[] {
  if (b.final) return [];
  const rng = rngFor(seed, b.index, SALT_MOTES);
  if (rng() < 0.2) return []; // nem todo trecho tem fragmentos
  const count = 3 + Math.floor(rng() * 3);
  const side = rng() < 0.5 ? -1 : 1;
  const dx = b.baseX - a.baseX;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const start = range(rng, 0.36, 0.42);
  const step = 0.07;
  const motes: Mote[] = [];
  for (let k = 0; k < count; k++) {
    const f = start + step * k;
    // A linha tangente à órbita de a que passa por b se afasta de a.ORBIT_RADIUS e chega a 0 em b.
    const offset = side * (1 - f) * CONFIG.ORBIT_RADIUS + range(rng, -6, 6);
    motes.push({
      id: b.index * 16 + k,
      x: clamp(a.baseX + dx * f + nx * offset, 20, CONFIG.FIELD_WIDTH - 20),
      y: a.y + dy * f + ny * offset,
      alive: true,
    });
  }
  return motes;
}

/** Faixa vertical segura para detritos entre a e b: nunca cruza a órbita estável de nenhuma das duas. */
export function debrisLaneBounds(a: Anchor, b: Anchor, radius: number): { top: number; bottom: number } | null {
  const keep = CONFIG.ORBIT_RADIUS + CONFIG.PLAYER_RADIUS + radius + CONFIG.DEBRIS_CLEARANCE;
  const bottom = a.y - keep; // y cresce para baixo; a está abaixo de b
  const top = b.y + keep;
  return top <= bottom ? { top, bottom } : null;
}

export function generateDebris(seed: number, a: Anchor, b: Anchor): Debris[] {
  if (a.haven || b.haven || b.final || a.index < CONFIG.DEBRIS_FROM) return [];
  const d = difficultyAt(b.index);
  const rng = rngFor(seed, b.index, SALT_DEBRIS);
  const whole = Math.floor(d.debrisPerGap);
  const count = whole + (rng() < d.debrisPerGap - whole ? 1 : 0);
  const out: Debris[] = [];
  for (let k = 0; k < count; k++) {
    const radius = range(rng, CONFIG.DEBRIS_RADIUS[0], CONFIG.DEBRIS_RADIUS[1]);
    const lane = debrisLaneBounds(a, b, radius);
    if (!lane) continue;
    const minX = radius;
    const maxX = CONFIG.FIELD_WIDTH - radius;
    const x0 = range(rng, minX, maxX);
    out.push({
      id: b.index * 16 + k,
      x0,
      x: x0,
      y: range(rng, lane.top, lane.bottom),
      radius,
      vx: range(rng, d.debrisSpeed * 0.7, d.debrisSpeed) * (rng() < 0.5 ? -1 : 1),
      minX,
      maxX,
      spin: range(rng, -2, 2),
      shapeSeed: Math.floor(rng() * 1e9),
    });
  }
  return out;
}

/**
 * X do detrito no tempo t: movimento de vai-e-vem (reflexão nas bordas) como função pura do tempo,
 * para que o momento em que o detrito foi gerado não altere sua posição.
 */
export function debrisXAt(d: Debris, t: number): number {
  const span = d.maxX - d.minX;
  if (span <= 0) return d.minX;
  const period = span * 2;
  let u = (d.x0 - d.minX + d.vx * t) % period;
  if (u < 0) u += period;
  return d.minX + (u <= span ? u : period - u);
}

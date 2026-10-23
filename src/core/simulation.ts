import { CONFIG, type GameMode } from './config';
import { difficultyAt } from './difficulty';
import { closestOnSegment, lerp, smoothstep } from './math';
import type { Anchor, DeathCause, RunState, SimEvent } from './types';
import { anchorXAt, debrisXAt, generateAnchor, generateDebris, generateMotes } from './world';

const START_ANGLE = Math.PI; // começa à esquerda da primeira estrela, girando no sentido horário

export function createRun(seed: number, mode: GameMode = 'travessia'): RunState {
  const first = generateAnchor(seed, 0, null, mode);
  const run: RunState = {
    seed: seed >>> 0,
    mode,
    tick: 0,
    x: first.x + Math.cos(START_ANGLE) * CONFIG.ORBIT_RADIUS,
    y: first.y + Math.sin(START_ANGLE) * CONFIG.ORBIT_RADIUS,
    player: {
      kind: 'orbit',
      anchorIndex: 0,
      angle: START_ANGLE,
      radius: CONFIG.ORBIT_RADIUS,
      captureRadius: CONFIG.ORBIT_RADIUS,
      dir: 1,
      orbitTime: 0,
      warned: false,
    },
    depth: 0,
    score: 0,
    combo: 1,
    anchors: [first],
    motes: [],
    debris: [],
    generatedUpTo: 0,
    stats: { perfects: 0, maxCombo: 1, motes: 0, skips: 0, perfectStreak: 0 },
    ended: null,
  };
  ensureGenerated(run);
  return run;
}

export function getAnchor(run: RunState, index: number): Anchor | undefined {
  // As estrelas ficam ordenadas por índice e contíguas; acesso O(1) pelo deslocamento.
  const first = run.anchors[0];
  if (!first) return undefined;
  const a = run.anchors[index - first.index];
  return a && a.index === index ? a : undefined;
}

function ensureGenerated(run: RunState): void {
  const limit = run.mode === 'travessia' ? CONFIG.FINAL_INDEX : Number.POSITIVE_INFINITY;
  const target = Math.min(run.depth + CONFIG.LOOKAHEAD, limit);
  while (run.generatedUpTo < target) {
    const prev = run.anchors[run.anchors.length - 1]!;
    const next = generateAnchor(run.seed, prev.index + 1, prev, run.mode);
    const t = run.tick * CONFIG.TICK;
    next.x = anchorXAt(next, t);
    run.anchors.push(next);
    run.motes.push(...generateMotes(run.seed, prev, next));
    for (const d of generateDebris(run.seed, prev, next)) {
      d.x = debrisXAt(d, t);
      run.debris.push(d);
    }
    run.generatedUpTo = next.index;
  }
  prune(run);
}

function prune(run: RunState): void {
  const current = getAnchor(run, run.depth);
  if (!current) return;
  const floorY = current.y + CONFIG.PRUNE_BELOW;
  // Mantém algumas estrelas já visitadas para o render (elas aparecem apagadas abaixo).
  while (run.anchors.length > 0 && run.anchors[0]!.index < run.depth - 3) run.anchors.shift();
  if (run.motes.length > 0 && run.motes.some((m) => !m.alive || m.y > floorY)) {
    run.motes = run.motes.filter((m) => m.alive && m.y <= floorY);
  }
  if (run.debris.length > 0 && run.debris.some((d) => d.y > floorY)) {
    run.debris = run.debris.filter((d) => d.y <= floorY);
  }
}

function die(run: RunState, cause: DeathCause, events: SimEvent[]): void {
  run.player = { kind: 'dead', cause };
  run.ended = { kind: 'death', cause };
  run.combo = 1;
  events.push({ type: 'death', cause, x: run.x, y: run.y });
}

/** Verifica fragmentos e detritos ao longo do segmento percorrido. Retorna true se morreu. */
function sweepHazards(run: RunState, x0: number, y0: number, x1: number, y1: number, events: SimEvent[]): boolean {
  const pr = CONFIG.PLAYER_RADIUS;
  for (const m of run.motes) {
    if (!m.alive) continue;
    if (closestOnSegment(x0, y0, x1, y1, m.x, m.y).distance <= CONFIG.MOTE_RADIUS + pr) {
      m.alive = false;
      const points = CONFIG.SCORE_MOTE * run.combo;
      run.score += points;
      run.stats.motes += 1;
      events.push({ type: 'mote', points, x: m.x, y: m.y });
    }
  }
  for (const d of run.debris) {
    const c = closestOnSegment(x0, y0, x1, y1, d.x, d.y);
    if (c.distance < d.radius + pr) {
      run.x = c.x;
      run.y = c.y;
      die(run, 'debris', events);
      return true;
    }
  }
  return false;
}

/**
 * Avança exatamente um tick. `release` = o jogador pediu para soltar neste tick.
 * Depois que a partida termina, não altera nada (nenhum ponto após o fim).
 */
export function step(run: RunState, release: boolean): SimEvent[] {
  const events: SimEvent[] = [];
  if (run.ended) return events;

  const dt = CONFIG.TICK;
  run.tick += 1;
  const t = run.tick * dt;

  for (const a of run.anchors) if (a.move) a.x = anchorXAt(a, t);
  for (const d of run.debris) d.x = debrisXAt(d, t);

  const p = run.player;

  if (p.kind === 'orbit') {
    const anchor = getAnchor(run, p.anchorIndex);
    if (!anchor) throw new Error(`Estrela ${p.anchorIndex} ausente`);
    if (release) {
      const speed = difficultyAt(run.depth).flightSpeed;
      // Derivada de (cos a, sin a) é (-sin a, cos a); dir dá o sentido de giro.
      const vx = -Math.sin(p.angle) * p.dir * speed;
      const vy = Math.cos(p.angle) * p.dir * speed;
      run.player = { kind: 'flight', vx, vy, flightTime: 0, fromIndex: p.anchorIndex };
      events.push({ type: 'release', x: run.x, y: run.y });
    } else {
      const omega = difficultyAt(p.anchorIndex).angularSpeed;
      p.orbitTime += dt;
      p.angle += p.dir * omega * dt;
      if (p.angle > Math.PI * 4 || p.angle < -Math.PI * 4) p.angle %= Math.PI * 2; // evita crescimento ilimitado
      p.radius = lerp(p.captureRadius, CONFIG.ORBIT_RADIUS, smoothstep(p.orbitTime / CONFIG.ORBIT_SETTLE_TIME));
      const x0 = run.x;
      const y0 = run.y;
      run.x = anchor.x + Math.cos(p.angle) * p.radius;
      run.y = anchor.y + Math.sin(p.angle) * p.radius;
      if (sweepHazards(run, x0, y0, run.x, run.y, events)) return events;

      const remaining = anchor.collapseTime - p.orbitTime;
      if (!p.warned && remaining <= CONFIG.COLLAPSE_WARNING) {
        p.warned = true;
        events.push({ type: 'collapseWarn', anchorIndex: anchor.index });
      }
      if (remaining <= 0) {
        die(run, 'collapse', events);
        return events;
      }
      return events;
    }
  }

  const f = run.player;
  if (f.kind !== 'flight') return events;

  f.flightTime += dt;
  const x0 = run.x;
  const y0 = run.y;
  const x1 = x0 + f.vx * dt;
  const y1 = y0 + f.vy * dt;

  // Evento mais cedo ao longo do segmento: colisão com núcleo ou captura no periastro.
  let hit: { t: number; anchor: Anchor; distance: number; x: number; y: number; crash: boolean } | null = null;
  for (const a of run.anchors) {
    if (a.index <= f.fromIndex || a.index <= run.depth) continue; // estrelas apagadas são inertes
    const c = closestOnSegment(x0, y0, x1, y1, a.x, a.y);
    const crash = c.distance < a.coreRadius;
    // Periastro dentro do passo: a distância para de diminuir antes do fim do segmento.
    const capture = !crash && c.t < 1 && c.distance <= a.captureRadius;
    if ((crash || capture) && (!hit || c.t < hit.t || (c.t === hit.t && crash))) {
      hit = { t: c.t, anchor: a, distance: c.distance, x: c.x, y: c.y, crash };
    }
  }

  const endX = hit ? hit.x : x1;
  const endY = hit ? hit.y : y1;
  if (sweepHazards(run, x0, y0, endX, endY, events)) return events;
  run.x = endX;
  run.y = endY;

  if (hit?.crash) {
    die(run, 'core', events);
    return events;
  }

  if (hit) {
    const a = hit.anchor;
    const rx = run.x - a.x;
    const ry = run.y - a.y;
    const cross = rx * f.vy - ry * f.vx;
    const perfect = hit.distance <= a.perfectRadius;
    run.combo = perfect ? Math.min(run.combo + 1, CONFIG.COMBO_MAX) : 1;
    const skipped = Math.max(0, a.index - run.depth - 1);
    let points = CONFIG.SCORE_ANCHOR * run.combo + CONFIG.SCORE_SKIP * skipped * run.combo;
    run.depth = a.index;
    run.stats.perfects += perfect ? 1 : 0;
    run.stats.maxCombo = Math.max(run.stats.maxCombo, run.combo);
    run.stats.skips += skipped;
    run.stats.perfectStreak = perfect ? run.stats.perfectStreak + 1 : 0;
    run.player = {
      kind: 'orbit',
      anchorIndex: a.index,
      angle: Math.atan2(ry, rx),
      radius: Math.max(hit.distance, a.coreRadius),
      captureRadius: Math.max(hit.distance, a.coreRadius),
      dir: cross >= 0 ? 1 : -1,
      orbitTime: 0,
      warned: false,
    };
    run.score += points;
    events.push({ type: 'capture', anchorIndex: a.index, perfect, skipped, points, combo: run.combo, x: run.x, y: run.y });
    if (a.final) {
      points = CONFIG.SCORE_VICTORY;
      run.score += points;
      run.ended = { kind: 'victory' };
      events.push({ type: 'victory', points, x: run.x, y: run.y });
      return events;
    }
    ensureGenerated(run);
    return events;
  }

  const current = getAnchor(run, run.depth);
  const lostX = run.x < -CONFIG.VOID_MARGIN || run.x > CONFIG.FIELD_WIDTH + CONFIG.VOID_MARGIN;
  const lostFar = current ? Math.hypot(run.x - current.x, run.y - current.y) > CONFIG.MAX_DISTANCE_FROM_ANCHOR : false;
  if (lostX || lostFar || f.flightTime > CONFIG.MAX_FLIGHT_TIME) die(run, 'void', events);
  return events;
}

/** Tempo restante (s) antes do colapso da estrela atual, ou null em voo/fim. */
export function collapseRemaining(run: RunState): number | null {
  if (run.player.kind !== 'orbit') return null;
  const a = getAnchor(run, run.player.anchorIndex);
  return a ? Math.max(0, a.collapseTime - run.player.orbitTime) : null;
}

/** Hash estável do estado relevante — usado para provar determinismo. */
export function stateHash(run: RunState): string {
  const r = (n: number): string => n.toFixed(6);
  return [
    run.tick,
    r(run.x),
    r(run.y),
    run.player.kind,
    run.depth,
    run.score,
    run.combo,
    run.stats.motes,
    run.stats.perfects,
    run.ended ? JSON.stringify(run.ended) : '-',
  ].join('|');
}

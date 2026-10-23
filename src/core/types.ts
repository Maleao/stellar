import type { GameMode } from './config';

export interface Anchor {
  index: number;
  /** Centro "base" (para estrelas móveis, o centro da oscilação). */
  baseX: number;
  x: number;
  y: number;
  captureRadius: number;
  coreRadius: number;
  perfectRadius: number;
  /** Segundos que se pode orbitar antes do colapso. */
  collapseTime: number;
  move: { amplitude: number; period: number; phase: number } | null;
  haven: boolean;
  final: boolean;
}

export interface Mote {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface Debris {
  id: number;
  /** Posição X no instante t = 0 da partida (o movimento é função pura do tempo). */
  x0: number;
  x: number;
  y: number;
  radius: number;
  vx: number;
  minX: number;
  maxX: number;
  /** Apenas visual (rotação), não afeta colisão. */
  spin: number;
  shapeSeed: number;
}

export type DeathCause = 'core' | 'collapse' | 'void' | 'debris';

export type PlayerState =
  | {
      kind: 'orbit';
      anchorIndex: number;
      angle: number;
      radius: number;
      /** Raio no instante da captura (para convergir até ORBIT_RADIUS). */
      captureRadius: number;
      dir: 1 | -1;
      orbitTime: number;
      warned: boolean;
    }
  | { kind: 'flight'; vx: number; vy: number; flightTime: number; fromIndex: number }
  | { kind: 'dead'; cause: DeathCause };

export interface RunStats {
  perfects: number;
  maxCombo: number;
  motes: number;
  skips: number;
  /** Maior sequência de Perfeitos consecutivos. */
  perfectStreak: number;
}

export interface RunState {
  seed: number;
  mode: GameMode;
  tick: number;
  x: number;
  y: number;
  player: PlayerState;
  /** Índice da estrela mais alta já alcançada (= estrela atual ao orbitar). */
  depth: number;
  score: number;
  combo: number;
  anchors: Anchor[];
  motes: Mote[];
  debris: Debris[];
  /** Maior índice de estrela já gerado (detritos/fragmentos gerados por intervalo). */
  generatedUpTo: number;
  stats: RunStats;
  ended: null | { kind: 'death'; cause: DeathCause } | { kind: 'victory' };
}

export type SimEvent =
  | { type: 'release'; x: number; y: number }
  | {
      type: 'capture';
      anchorIndex: number;
      perfect: boolean;
      skipped: number;
      points: number;
      combo: number;
      x: number;
      y: number;
    }
  | { type: 'mote'; points: number; x: number; y: number }
  | { type: 'collapseWarn'; anchorIndex: number }
  | { type: 'death'; cause: DeathCause; x: number; y: number }
  | { type: 'victory'; points: number; x: number; y: number };

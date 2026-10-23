import { CONFIG } from './config';
import { lerp, smoothstep } from './math';

export interface DifficultyParams {
  angularSpeed: number;
  flightSpeed: number;
  gapMin: number;
  gapMax: number;
  maxDx: number;
  captureRadius: number;
  collapseTime: number;
  debrisPerGap: number;
  debrisSpeed: number;
  moveAmplitude: number;
  movePeriod: number;
}

/** Progresso 0..1 da rampa de dificuldade. Depende só do índice da estrela (transparente e justo). */
export function rampProgress(anchorIndex: number): number {
  return smoothstep(Math.max(0, anchorIndex) / CONFIG.DIFFICULTY_RAMP_END);
}

export function difficultyAt(anchorIndex: number): DifficultyParams {
  const t = rampProgress(anchorIndex);
  const r = CONFIG.RANGE;
  const pick = (k: keyof typeof r): number => lerp(r[k][0], r[k][1], t);
  return {
    angularSpeed: pick('angularSpeed'),
    flightSpeed: pick('flightSpeed'),
    gapMin: pick('gapMin'),
    gapMax: pick('gapMax'),
    maxDx: pick('maxDx'),
    captureRadius: pick('captureRadius'),
    collapseTime: pick('collapseTime'),
    debrisPerGap: anchorIndex >= CONFIG.DEBRIS_FROM ? pick('debrisPerGap') : 0,
    debrisSpeed: pick('debrisSpeed'),
    moveAmplitude: pick('moveAmplitude'),
    movePeriod: pick('movePeriod'),
  };
}

/** Setor exibido ao jogador (1-based): estrelas 0–9 → setor 1, etc. */
export const sectorOf = (anchorIndex: number): number => Math.floor(Math.max(0, anchorIndex) / CONFIG.HAVEN_EVERY) + 1;

export const isHaven = (anchorIndex: number): boolean => anchorIndex > 0 && anchorIndex % CONFIG.HAVEN_EVERY === 0;

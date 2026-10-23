/**
 * Balanceamento centralizado. Todo número que afeta o gameplay mora aqui.
 * Unidades: "u" = unidade de mundo (campo jogável tem FIELD_WIDTH u de largura), segundos, radianos.
 */
export const CONFIG = {
  /** Passo fixo da simulação. */
  TICK: 1 / 120,
  /** Delta real máximo convertido em ticks por quadro (evita espiral após perda de foco). */
  MAX_FRAME_DELTA: 0.25,

  FIELD_WIDTH: 600,
  /** Margem lateral além do campo antes de "perder-se no vazio". */
  VOID_MARGIN: 40,
  /** Área em que o centro das estrelas pode ficar. */
  ANCHOR_MIN_X: 90,
  ANCHOR_MAX_X: 510,

  PLAYER_RADIUS: 6,
  /** Raio da órbita estável ao redor de uma estrela. */
  ORBIT_RADIUS: 50,
  /** Tempo para o raio convergir do periastro até ORBIT_RADIUS. */
  ORBIT_SETTLE_TIME: 0.25,
  CORE_RADIUS: 13,
  PERFECT_RADIUS: 38,
  /** Tempo máximo de voo antes de se perder no vazio. */
  MAX_FLIGHT_TIME: 1.35,
  /** Distância da estrela atual além da qual o jogador se perde. */
  MAX_DISTANCE_FROM_ANCHOR: 900,
  COLLAPSE_WARNING: 1.5,
  FIRST_ANCHOR_TIMER: 9,

  COMBO_MAX: 8,
  SCORE_ANCHOR: 100,
  SCORE_SKIP: 150,
  SCORE_MOTE: 25,
  SCORE_VICTORY: 2000,

  MOTE_RADIUS: 7,

  /** Travessia: o Farol é a estrela de índice FINAL_INDEX (a 51ª contando a inicial 0 → "estrela 50"). */
  FINAL_INDEX: 50,
  HAVEN_EVERY: 10,
  /** Estrelas geradas à frente do jogador. */
  LOOKAHEAD: 8,
  /** Entidades abaixo desta distância da estrela atual são podadas. */
  PRUNE_BELOW: 1200,

  DIFFICULTY_RAMP_END: 60,
  DEBRIS_FROM: 6,
  MOVING_FROM: 20,

  /** Faixas de dificuldade: [fácil, difícil]. Interpoladas por difficulty.ts. */
  RANGE: {
    angularSpeed: [2.2, 3.2] as const,
    flightSpeed: [360, 470] as const,
    gapMin: [200, 250] as const,
    gapMax: [250, 330] as const,
    maxDx: [170, 260] as const,
    captureRadius: [100, 80] as const,
    collapseTime: [7.0, 4.0] as const,
    debrisPerGap: [0, 2] as const,
    debrisSpeed: [50, 130] as const,
    moveAmplitude: [35, 85] as const,
    movePeriod: [5.0, 3.2] as const,
  },
  HAVEN: { captureRadius: 110, collapseTime: 9 },
  /** Folga mínima vertical entre uma faixa de detrito e qualquer zona de captura/órbita. */
  DEBRIS_CLEARANCE: 16,
  DEBRIS_RADIUS: [9, 16] as const,
} as const;

export type GameMode = 'travessia' | 'infinito';

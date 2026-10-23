import { CONFIG } from './core/config';

/**
 * Acumulador de passo fixo. Converte deltas reais (variáveis) em ticks inteiros,
 * limitando o delta para não "recuperar" segundos perdidos após perda de foco.
 */
export class FixedStepAccumulator {
  private acc = 0;

  constructor(
    private readonly tick = CONFIG.TICK,
    private readonly maxDelta = CONFIG.MAX_FRAME_DELTA,
  ) {}

  /** Retorna quantos ticks executar para este delta (segundos). */
  consume(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
    this.acc += Math.min(deltaSeconds, this.maxDelta);
    // Tolerância de ponto flutuante para que 1/120 + 1/120 produza exatamente 2 ticks.
    const n = Math.floor(this.acc / this.tick + 1e-9);
    this.acc = Math.max(0, this.acc - n * this.tick);
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}

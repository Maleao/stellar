/** Fases da aplicação e transições permitidas. */
export type Phase = 'BOOT' | 'MENU' | 'PLAYING' | 'PAUSED' | 'ENDING' | 'RESULTS';

const TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  BOOT: ['MENU'],
  MENU: ['PLAYING'],
  PLAYING: ['PAUSED', 'ENDING'],
  PAUSED: ['PLAYING', 'MENU'],
  ENDING: ['RESULTS'],
  RESULTS: ['PLAYING', 'MENU'],
};

export const canTransition = (from: Phase, to: Phase): boolean => TRANSITIONS[from].includes(to);

export class PhaseMachine {
  private current: Phase = 'BOOT';
  private readonly listeners = new Set<(to: Phase, from: Phase) => void>();

  get phase(): Phase {
    return this.current;
  }

  /** Tenta a transição; retorna false (sem efeito) se ela não for permitida. */
  go(to: Phase): boolean {
    const from = this.current;
    if (!canTransition(from, to)) return false;
    this.current = to;
    for (const l of [...this.listeners]) l(to, from);
    return true;
  }

  onChange(listener: (to: Phase, from: Phase) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

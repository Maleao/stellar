export type InputAction = 'release' | 'pause';

const RELEASE_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/**
 * Traduz teclado/ponteiro em ações. A soltura é um "pulso" consumido pelo próximo tick
 * (no máximo uma por tick); auto-repeat de tecla segurada é ignorado.
 */
export class InputManager {
  private releasePending = false;
  private readonly handlers: Array<[EventTarget, string, EventListener, AddEventListenerOptions | undefined]> = [];
  /** Quando false, a soltura é descartada (menus, pausa, resultados). */
  gameplayActive = false;
  onAction: (a: InputAction) => void = () => undefined;
  /** Primeiro gesto do usuário (para destravar áudio). */
  onGesture: () => void = () => undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    if (this.handlers.length > 0) return; // idempotente: nunca registra listeners duplicados
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.listen(this.canvas, 'pointerdown', (e) => this.onPointer(e as PointerEvent), { passive: false });
    this.listen(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'pointerdown', () => this.onGesture(), { capture: true });
  }

  detach(): void {
    for (const [target, type, fn, opts] of this.handlers) target.removeEventListener(type, fn, opts);
    this.handlers.length = 0;
  }

  get listenerCount(): number {
    return this.handlers.length;
  }

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.handlers.push([target, type, fn, opts]);
  }

  private onKey(e: KeyboardEvent): void {
    this.onGesture();
    if (PAUSE_KEYS.has(e.code)) {
      if (!e.repeat) this.onAction('pause');
      return;
    }
    if (!this.gameplayActive || !RELEASE_KEYS.has(e.code)) return;
    // Em jogo, Espaço/setas não devem rolar a página nem acionar um botão focado.
    e.preventDefault();
    if (e.repeat) return;
    this.releasePending = true;
  }

  private onPointer(e: PointerEvent): void {
    this.onGesture();
    if (!this.gameplayActive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.releasePending = true;
  }

  /** Lê e zera o pedido de soltura. */
  consumeRelease(): boolean {
    const r = this.releasePending;
    this.releasePending = false;
    return r;
  }

  clear(): void {
    this.releasePending = false;
  }
}

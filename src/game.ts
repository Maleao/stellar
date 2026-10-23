import { releaseSearch, type ReleasePlan } from './core/bot';
import { CONFIG, type GameMode } from './core/config';
import { sectorOf } from './core/difficulty';
import { PhaseMachine, type Phase } from './core/phase';
import { isInfiniteUnlocked, type Profile, type RunSummary, type Settings, type TrailId } from './core/progression';
import { freshSeed } from './core/rng';
import { createRun, step } from './core/simulation';
import type { RunState, SimEvent } from './core/types';
import type { InputManager } from './input/input';
import { FixedStepAccumulator } from './loop';
import type { Renderer } from './render/renderer';
import type { AudioManager } from './services/audio';
import { STORAGE_KEY, type PersistenceService } from './services/persistence';
import type { UI, UiAction } from './ui/ui';

const ENDING_TICKS = Math.round(1.1 / CONFIG.TICK);
const ATTRACT_RESTART_TICKS = Math.round(1.2 / CONFIG.TICK);
/** A demonstração planeja para daqui a N ticks e usa no máximo este orçamento de CPU por tick. */
const ATTRACT_LOOKAHEAD = 15;
const ATTRACT_BUDGET_MS = 1.5;
const PERF_SAMPLES = 600;

export interface GameDeps {
  persistence: PersistenceService;
  audio: AudioManager;
  ui: UI;
  renderer: Renderer;
  input: InputManager;
  initialSeed: number | null;
}

export class Game {
  readonly phases = new PhaseMachine();
  run: RunState | null = null;
  mode: GameMode = 'travessia';
  runId = '';
  runCount = 0;
  lastSeed = 0;
  lastResult: { summary: RunSummary; newRecord: boolean } | null = null;

  private attract: RunState;
  private attractPlan: ReleasePlan | null = null;
  private attractSearch: { gen: Generator<void, ReleasePlan | null, void>; startTick: number } | null = null;
  private attractRestart = 0;
  private committed = false;
  private endingTicks = 0;
  private readonly acc = new FixedStepAccumulator();
  private frozen = false;
  private lastFrame = 0;
  private rafId = 0;
  private stopped = false;
  private pendingSeed: number | null;
  private readonly sessionId = Math.random().toString(36).slice(2, 8);
  private tutorialActive = false;
  private tutorialSawWarn = false;
  private tutorialSawCapture = false;
  private readonly frameMs: number[] = [];
  private readonly renderMs: number[] = [];
  private readonly reducedMotionQuery: MediaQueryList | null;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly d: GameDeps) {
    this.pendingSeed = d.initialSeed;
    this.attract = this.newAttract();
    this.reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }

  get phase(): Phase {
    return this.phases.phase;
  }

  get profile(): Profile {
    return this.d.persistence.profile;
  }

  init(): void {
    const { ui, input, audio } = this.d;
    ui.onAction = (a) => this.onUiAction(a);
    ui.onSettings = (patch) => this.updateSettings(patch);
    ui.onTrail = (t) => this.setTrail(t);
    input.onAction = (a) => {
      if (a === 'pause') this.onPauseKey();
    };
    input.onGesture = () => {
      audio.unlock();
      audio.setMusic(true);
    };
    input.attach();

    this.on(window, 'resize', () => this.d.renderer.resize());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    this.on(window, 'blur', () => this.autoPause());
    // Outra aba gravou progresso: recarrega para o menu mostrar dados atuais.
    this.on(window, 'storage', (e) => {
      if ((e as StorageEvent).key !== null && (e as StorageEvent).key !== STORAGE_KEY) return;
      this.d.persistence.reload();
      if (this.phase === 'MENU') this.d.ui.renderMenu(this.profile, this.d.persistence.status);
      this.applyVisualOptions();
    });
    if (this.reducedMotionQuery) this.on(this.reducedMotionQuery, 'change', () => this.applyVisualOptions());

    this.phases.onChange((to) => {
      ui.showPhase(to);
      input.gameplayActive = to === 'PLAYING';
      input.clear();
      audio.setDucked(to === 'PAUSED' || to === 'RESULTS');
      if (to === 'MENU') ui.renderMenu(this.profile, this.d.persistence.status);
    });
    this.applySettings(this.profile.settings);
    this.phases.go('MENU');
    this.d.renderer.reset(this.attract);
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  /** Remove listeners e para o loop (usado em testes de vazamento). */
  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    this.d.input.detach();
    for (const c of this.cleanups.splice(0)) c();
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  get listenerCount(): number {
    return this.cleanups.length + this.d.input.listenerCount;
  }

  // ---------------------------------------------------------------- partida

  startRun(mode: GameMode, seed?: number): boolean {
    if (!(this.phase === 'MENU' || this.phase === 'PAUSED' || this.phase === 'RESULTS')) return false;
    if (mode === 'infinito' && !isInfiniteUnlocked(this.profile)) return false;
    const s = seed ?? this.pendingSeed ?? freshSeed();
    this.pendingSeed = null;
    this.mode = mode;
    this.lastSeed = s;
    this.run = createRun(s, mode);
    this.runCount += 1;
    this.runId = `${this.sessionId}-${this.runCount}`;
    this.committed = false;
    this.endingTicks = 0;
    this.acc.reset();
    this.d.renderer.reset(this.run);
    this.d.ui.resetHud();
    this.d.ui.updateHud(0, 1, 0, mode);
    this.tutorialActive = !this.profile.tutorialDone && mode === 'travessia';
    this.tutorialSawWarn = false;
    this.tutorialSawCapture = false;
    this.phases.go('PLAYING');
    this.applyVisualOptions();
    if (this.tutorialActive) this.d.ui.showHint('Toque, clique ou aperte Espaço para soltar');
    return true;
  }

  pause(): boolean {
    return this.phases.go('PAUSED');
  }

  resume(): boolean {
    if (this.d.ui.modalOpen) this.d.ui.closeModal();
    const ok = this.phases.go('PLAYING');
    if (ok) this.acc.reset(); // não "compensa" o tempo em pausa
    return ok;
  }

  private autoPause(): void {
    if (this.phase === 'PLAYING') this.pause();
  }

  private onPauseKey(): void {
    if (this.d.ui.modalOpen) {
      this.d.ui.closeModal();
      return;
    }
    if (this.phase === 'PLAYING') this.pause();
    else if (this.phase === 'PAUSED') this.resume();
  }

  goMenu(): boolean {
    if (this.d.ui.modalOpen) this.d.ui.closeModal();
    const ok = this.phases.go('MENU');
    if (ok) {
      this.run = null;
      this.attract = this.newAttract();
      this.attractPlan = null;
      this.attractSearch = null;
      this.d.renderer.reset(this.attract);
      this.applyVisualOptions();
    }
    return ok;
  }

  private onUiAction(a: UiAction): void {
    this.d.audio.play('ui');
    switch (a) {
      case 'play':
        this.startRun('travessia');
        break;
      case 'play-infinite':
        this.startRun('infinito');
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.startRun(this.mode, this.lastSeed);
        break;
      case 'play-again':
        this.startRun(this.mode);
        break;
      case 'same-seed':
        this.startRun(this.mode, this.lastSeed);
        break;
      case 'menu':
        this.goMenu();
        break;
      case 'settings':
        this.d.ui.openModal('settings', this.profile);
        break;
      case 'achievements':
        this.d.ui.openModal('achievements', this.profile);
        break;
      case 'help':
        this.d.ui.openModal('help', this.profile);
        break;
      case 'close-modal':
        this.d.ui.closeModal();
        break;
      case 'replay-tutorial':
        this.d.persistence.setTutorialDone(false);
        this.d.ui.announce('As dicas aparecerão na próxima partida.');
        break;
      case 'reset-progress':
        if (this.d.ui.armOrConfirmReset()) {
          this.d.persistence.resetProgress();
          this.d.ui.announce('Progresso apagado.');
          this.d.ui.renderMenu(this.profile, this.d.persistence.status);
        }
        break;
    }
  }

  private updateSettings(patch: Partial<Settings>): void {
    const p = this.d.persistence.updateSettings(patch);
    this.applySettings(p.settings);
  }

  private setTrail(t: TrailId): void {
    this.d.persistence.setTrail(t);
    this.d.ui.fillAchievements(this.profile);
    this.applyVisualOptions();
  }

  private applySettings(s: Settings): void {
    this.d.audio.setSettings(s);
    this.applyVisualOptions();
  }

  private reducedMotion(): boolean {
    const m = this.profile.settings.motion;
    return m === 'reduced' || (m === 'auto' && !!this.reducedMotionQuery?.matches);
  }

  private applyVisualOptions(): void {
    const run = this.run;
    const g = this.profile.settings.guide;
    this.d.renderer.options = {
      reducedMotion: this.reducedMotion(),
      trail: this.profile.trail,
      guide: !!run && (g === 'always' || (g === 'start' && run.depth < 4)),
      texts: !!run,
    };
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number): void {
    if (this.stopped) return;
    try {
      const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.frameMs.push(dt * 1000);
      if (this.frameMs.length > PERF_SAMPLES) this.frameMs.shift();
      if (!this.frozen) this.advanceTicks(this.acc.consume(dt));
      const visualDt = this.phase === 'PAUSED' || this.frozen ? 0 : dt;
      const shown = this.run ?? this.attract;
      this.d.renderer.render(shown, visualDt);
      this.renderMs.push(this.d.renderer.lastRenderMs);
      if (this.renderMs.length > PERF_SAMPLES) this.renderMs.shift();
      this.d.audio.update();
    } catch (err) {
      this.fail(err);
      return;
    }
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  fail(err: unknown): void {
    this.stopped = true;
    console.error('[Estilingue Estelar] erro fatal no loop', err);
    this.d.ui.showFatal('Ocorreu um erro inesperado. Seu progresso salvo está intacto — recarregue a página para continuar.');
  }

  /** Avança n ticks de jogo pelo mesmo caminho do loop real (usado também pela API de testes). */
  advanceTicks(n: number): void {
    for (let i = 0; i < n; i++) {
      switch (this.phase) {
        case 'PLAYING':
          this.tickPlaying();
          break;
        case 'ENDING':
          if (--this.endingTicks <= 0) this.finishRun();
          break;
        case 'MENU':
          this.tickAttract();
          break;
        default:
          return; // PAUSED / RESULTS: o tempo de jogo não anda
      }
    }
  }

  private tickPlaying(): void {
    const run = this.run;
    if (!run) return;
    const events = step(run, this.d.input.consumeRelease());
    if (events.length > 0) this.handleEvents(events, run);
    if (run.ended && this.phase === 'PLAYING') {
      this.endingTicks = ENDING_TICKS;
      this.phases.go('ENDING');
    }
  }

  private handleEvents(events: SimEvent[], run: RunState): void {
    const { audio, ui, renderer } = this.d;
    renderer.onEvents(events, run);
    for (const e of events) {
      switch (e.type) {
        case 'release':
          audio.play('release');
          if (this.tutorialActive) ui.hideHint();
          break;
        case 'capture':
          audio.play(e.perfect ? 'perfect' : 'capture', { combo: e.combo });
          if (e.skipped > 0) audio.play('skip');
          if (this.tutorialActive && !this.tutorialSawCapture) {
            this.tutorialSawCapture = true;
            ui.showHint('Passe rente ao núcleo (anel claro) para um PERFEITO e multiplique os pontos', 4.5);
          }
          this.applyVisualOptions();
          break;
        case 'mote':
          audio.play('mote');
          break;
        case 'collapseWarn':
          audio.play('warn');
          if (this.tutorialActive && !this.tutorialSawWarn) {
            this.tutorialSawWarn = true;
            ui.showHint('O anel está acabando — salte antes que a estrela colapse!', 3);
          }
          break;
        case 'death':
          audio.play('death');
          break;
        case 'victory':
          audio.play('victory');
          break;
      }
    }
    ui.updateHud(run.score, run.combo, run.depth, run.mode);
    audio.setIntensity((run.combo - 1) / (CONFIG.COMBO_MAX - 1) * 0.6 + Math.min(1, sectorOf(run.depth) / 5) * 0.4);
  }

  private finishRun(): void {
    const run = this.run;
    if (!run || this.committed) return;
    this.committed = true; // nunca processa o mesmo resultado duas vezes
    const summary: RunSummary = {
      runId: this.runId,
      mode: run.mode,
      seed: run.seed,
      score: run.score,
      depth: run.depth,
      victory: run.ended?.kind === 'victory',
      cause: run.ended?.kind === 'death' ? run.ended.cause : null,
      stats: { ...run.stats },
      ticks: run.tick,
    };
    const result = this.d.persistence.commitRun(summary);
    if (this.tutorialActive) {
      this.d.persistence.setTutorialDone(true);
      this.tutorialActive = false;
    }
    this.lastResult = { summary, newRecord: result.newRecord };
    this.d.ui.renderResults(summary, result.newRecord, result.newAchievements);
    this.phases.go('RESULTS');
  }

  // ---------------------------------------------------------------- demonstração do menu

  private newAttract(): RunState {
    return createRun(freshSeed(), 'travessia');
  }

  private tickAttract(): void {
    const run = this.attract;
    if (run.ended) {
      if (--this.attractRestart <= 0) {
        this.attract = this.newAttract();
        this.attractPlan = null;
        this.attractSearch = null;
        this.d.renderer.reset(this.attract);
      }
      return;
    }
    let release = false;
    if (run.player.kind === 'orbit') {
      if (!this.attractPlan && !this.attractSearch) {
        // Planeja a partir de um estado alguns ticks no futuro e reparte a busca entre quadros,
        // para que a demonstração nunca cause engasgos.
        const future = structuredClone(run);
        for (let i = 0; i < ATTRACT_LOOKAHEAD && !future.ended; i++) step(future, false);
        this.attractSearch = { gen: releaseSearch(future, { strategy: 'best', stride: 3, horizon: 140 }), startTick: run.tick };
      }
      const search = this.attractSearch;
      if (search) {
        const until = performance.now() + ATTRACT_BUDGET_MS;
        let r = search.gen.next();
        while (!r.done && performance.now() < until) r = search.gen.next();
        if (r.done) {
          this.attractSearch = null;
          const plan = r.value;
          if (plan) {
            plan.wait += ATTRACT_LOOKAHEAD - (run.tick - search.startTick);
            this.attractPlan = plan.wait >= 0 ? plan : null; // atrasou demais: planeja de novo
          }
        }
      }
      if (this.attractPlan) {
        if (this.attractPlan.wait <= 0) {
          release = true;
          this.attractPlan = null;
        } else this.attractPlan.wait -= 1;
      }
    }
    const events = step(run, release);
    if (events.length) this.d.renderer.onEvents(events, run);
    if (run.ended) this.attractRestart = ATTRACT_RESTART_TICKS;
  }

  // ---------------------------------------------------------------- diagnóstico

  setFrozen(f: boolean): void {
    this.frozen = f;
    this.acc.reset();
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  perfStats(): { frames: number; avgFrameMs: number; p95FrameMs: number; maxFrameMs: number; avgRenderMs: number; p95RenderMs: number } {
    const pct = (arr: number[], q: number): number => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
    };
    const avg = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const frames = this.frameMs.slice(5); // ignora os primeiros quadros (aquecimento)
    return {
      frames: frames.length,
      avgFrameMs: avg(frames),
      p95FrameMs: pct(frames, 0.95),
      maxFrameMs: Math.max(0, ...frames),
      avgRenderMs: avg(this.renderMs),
      p95RenderMs: pct(this.renderMs, 0.95),
    };
  }

  resetPerf(): void {
    this.frameMs.length = 0;
    this.renderMs.length = 0;
  }
}

/**
 * Áudio 100% sintetizado (Web Audio). Sem arquivos para carregar → sem falhas de carregamento.
 * Qualquer indisponibilidade (navegador sem Web Audio, autoplay bloqueado, erro) vira no-op:
 * o jogo continua funcionando em silêncio.
 */
export type SfxName = 'release' | 'capture' | 'perfect' | 'mote' | 'warn' | 'death' | 'victory' | 'ui' | 'skip';

const PENTA = [0, 3, 5, 7, 10]; // menor pentatônica
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const STEP = 0.25; // colcheia a 120 bpm
const MIN_INTERVAL: Partial<Record<SfxName, number>> = { mote: 0.03, ui: 0.05, capture: 0.06, warn: 0.3 };
const MAX_VOICES = 28;

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export interface AudioSettings {
  masterVolume: number;
  music: boolean;
  sfx: boolean;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private failed = false;
  private settings: AudioSettings = { masterVolume: 0.7, music: true, sfx: true };
  private lastPlayed = new Map<SfxName, number>();
  private voices = 0;
  private musicOn = false;
  private nextStepTime = 0;
  private stepIndex = 0;
  private intensity = 0;
  private ducked = false;
  private moteChain = 0;

  get available(): boolean {
    return !!this.ctx && !this.failed;
  }

  get state(): string {
    if (this.failed) return 'failed';
    return this.ctx ? this.ctx.state : 'locked';
  }

  /** Deve ser chamado dentro de um gesto do usuário (política de autoplay). */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        this.ctx = new Ctor();
        this.build();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 1400;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    const len = Math.floor(ctx.sampleRate * 0.6);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applySettings();
  }

  setSettings(s: AudioSettings): void {
    this.settings = { ...s, masterVolume: Math.min(1, Math.max(0, s.masterVolume)) };
    this.applySettings();
  }

  private applySettings(): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.settings.masterVolume;
    this.master.gain.setTargetAtTime(v * v, t, 0.03); // curva perceptual
    this.musicBus.gain.setTargetAtTime(this.settings.music ? 0.55 : 0, t, 0.08);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx ? 0.9 : 0, t, 0.03);
  }

  setMusic(on: boolean): void {
    if (on && !this.musicOn && this.ctx) {
      this.nextStepTime = this.ctx.currentTime + 0.1;
      this.stepIndex = 0;
    }
    this.musicOn = on;
  }

  /** 0..1 — densidade e brilho da música. */
  setIntensity(v: number): void {
    this.intensity = Math.min(1, Math.max(0, v));
  }

  /** Abafa a música (pausa, menus sobrepostos). */
  setDucked(d: boolean): void {
    this.ducked = d;
    if (this.ctx && this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(d ? 420 : 900 + this.intensity * 2600, this.ctx.currentTime, 0.15);
    }
  }

  /** Agenda notas com antecedência; chamado a cada quadro. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || this.failed || !this.musicOn || ctx.state !== 'running') return;
    if (this.musicFilter && !this.ducked) {
      this.musicFilter.frequency.setTargetAtTime(900 + this.intensity * 2600, ctx.currentTime, 0.5);
    }
    // Se a aba ficou parada, não tenta "recuperar" notas atrasadas.
    if (this.nextStepTime < ctx.currentTime - 0.5) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.2) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.stepIndex += 1;
      this.nextStepTime += STEP;
    }
  }

  private scheduleStep(i: number, t: number): void {
    const chord = CHORDS[Math.floor(i / 16) % CHORDS.length]!;
    if (i % 16 === 0) for (const n of chord) this.tone({ freq: midi(n - 12), type: 'triangle', t, attack: 1.2, hold: 2.6, release: 1.2, gain: 0.05, bus: 'music' });
    const density = 0.18 + this.intensity * 0.5;
    if (i % 2 === 0 || Math.random() < density * 0.6) {
      if (Math.random() < density) {
        const n = chord[Math.floor(Math.random() * chord.length)]! + (Math.random() < 0.35 ? 12 : 0);
        this.tone({ freq: midi(n), type: 'sine', t, attack: 0.01, hold: 0.02, release: 0.45, gain: 0.07, bus: 'music' });
      }
    }
    if (this.intensity > 0.35 && i % 4 === 0) {
      this.tone({ freq: midi(chord[0]! - 24), type: 'sine', t, attack: 0.01, hold: 0.05, release: 0.3, gain: 0.12 * this.intensity, bus: 'music' });
    }
    if (this.intensity > 0.6 && i % 2 === 1) this.noiseHit(t, 6000, 0.035, 0.03, 'music');
  }

  play(name: SfxName, opts: { combo?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || this.failed || !this.settings.sfx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < (MIN_INTERVAL[name] ?? 0.02)) return;
    this.lastPlayed.set(name, now);
    const t = now + 0.005;
    try {
      switch (name) {
        case 'release':
          this.moteChain = 0;
          this.noiseHit(t, 1800, 0.12, 0.14);
          this.tone({ freq: 380, to: 620, type: 'sine', t, attack: 0.005, hold: 0.02, release: 0.1, gain: 0.12 });
          break;
        case 'capture': {
          const deg = PENTA[(opts.combo ?? 1) % PENTA.length]! + 12 * Math.floor((opts.combo ?? 1) / PENTA.length);
          this.tone({ freq: midi(64 + deg), type: 'triangle', t, attack: 0.004, hold: 0.03, release: 0.3, gain: 0.22 });
          break;
        }
        case 'perfect': {
          const base = midi(76 + PENTA[(opts.combo ?? 1) % PENTA.length]!);
          this.tone({ freq: base, type: 'sine', t, attack: 0.003, hold: 0.02, release: 0.9, gain: 0.16 });
          this.tone({ freq: base * 2, type: 'sine', t, attack: 0.003, hold: 0.01, release: 0.6, gain: 0.08 });
          this.tone({ freq: base * 3, type: 'sine', t: t + 0.04, attack: 0.003, hold: 0.01, release: 0.4, gain: 0.05 });
          break;
        }
        case 'skip':
          [0, 4, 7].forEach((s, k) => this.tone({ freq: midi(72 + s), type: 'triangle', t: t + k * 0.06, attack: 0.004, hold: 0.02, release: 0.25, gain: 0.12 }));
          break;
        case 'mote':
          this.moteChain = Math.min(this.moteChain + 1, 10);
          this.tone({ freq: midi(84 + PENTA[this.moteChain % 5]! + 12 * Math.floor(this.moteChain / 5)), type: 'sine', t, attack: 0.002, hold: 0.01, release: 0.09, gain: 0.08 });
          break;
        case 'warn':
          for (const k of [0, 0.16]) this.tone({ freq: 110, type: 'square', t: t + k, attack: 0.005, hold: 0.05, release: 0.05, gain: 0.06 });
          break;
        case 'death':
          this.noiseHit(t, 900, 0.7, 0.3);
          this.tone({ freq: 220, to: 50, type: 'sawtooth', t, attack: 0.005, hold: 0.05, release: 0.6, gain: 0.12 });
          break;
        case 'victory':
          [57, 60, 64, 69, 72, 76, 81].forEach((n, k) =>
            this.tone({ freq: midi(n), type: 'triangle', t: t + k * 0.09, attack: 0.005, hold: 0.05, release: 0.8, gain: 0.13 }),
          );
          break;
        case 'ui':
          this.tone({ freq: 660, type: 'sine', t, attack: 0.002, hold: 0.01, release: 0.05, gain: 0.06 });
          break;
      }
    } catch {
      // Falha pontual de síntese não deve afetar o jogo.
    }
  }

  private tone(o: {
    freq: number;
    to?: number;
    type: OscillatorType;
    t: number;
    attack: number;
    hold: number;
    release: number;
    gain: number;
    bus?: 'sfx' | 'music';
  }): void {
    const ctx = this.ctx;
    const bus = o.bus === 'music' ? this.musicBus : this.sfxBus;
    if (!ctx || !bus || this.voices >= MAX_VOICES) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.t);
    const end = o.t + o.attack + o.hold + o.release;
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, end);
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.exponentialRampToValueAtTime(o.gain, o.t + o.attack);
    g.gain.setValueAtTime(o.gain, o.t + o.attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(bus);
    this.voices++;
    osc.onended = () => {
      this.voices--;
      osc.disconnect();
      g.disconnect();
    };
    osc.start(o.t);
    osc.stop(end + 0.02);
  }

  private noiseHit(t: number, freq: number, dur: number, gain: number, busName: 'sfx' | 'music' = 'sfx'): void {
    const ctx = this.ctx;
    const bus = busName === 'music' ? this.musicBus : this.sfxBus;
    if (!ctx || !bus || !this.noise || this.voices >= MAX_VOICES) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Para testes/diagnóstico. */
  get activeVoices(): number {
    return this.voices;
  }
}

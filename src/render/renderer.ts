import { CONFIG } from '../core/config';
import { difficultyAt } from '../core/difficulty';
import type { TrailId } from '../core/progression';
import { mulberry32 } from '../core/rng';
import { collapseRemaining, getAnchor } from '../core/simulation';
import type { Anchor, Debris, RunState, SimEvent } from '../core/types';
import { PALETTE, TRAIL_COLORS } from './palette';
import { Particles } from './particles';

export interface RenderOptions {
  reducedMotion: boolean;
  trail: TrailId;
  /** Mostrar a linha-guia de mira nesta situação. */
  guide: boolean;
  /** Textos flutuantes de pontuação (desligados na demonstração do menu). */
  texts: boolean;
}

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
}

const TRAIL_LEN = 26;
const VIEW_W = 680;
const VIEW_H = 820;
const FOCUS = 0.66;

function makeGlowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `${color}0.95)`);
  grad.addColorStop(0.25, `${color}0.45)`);
  grad.addColorStop(0.6, `${color}0.12)`);
  grad.addColorStop(1, `${color}0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 1;
  private offX = 0;
  private camY = 0;
  private camInit = false;
  private shake = 0;
  private flash = 0;
  private flashColor = '255,255,255';
  private time = 0;
  private bg: HTMLCanvasElement | null = null;
  private readonly stars: BgStar[][] = [];
  private readonly trail: { x: number; y: number }[] = [];
  private readonly glow: Record<string, HTMLCanvasElement> = {};
  private readonly debrisShapes = new Map<number, number[]>();
  private collapsedIndex = -1;
  readonly particles = new Particles();
  options: RenderOptions = { reducedMotion: false, trail: 'cometa', guide: false, texts: true };
  /** Tempo de CPU do último quadro de render (ms) — diagnóstico de desempenho. */
  lastRenderMs = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponível neste navegador.');
    this.ctx = ctx;
    const rng = mulberry32(20261023);
    for (const [count, size] of [[70, 0.9], [45, 1.4], [22, 2.0]] as const) {
      const layer: BgStar[] = [];
      for (let i = 0; i < count; i++) layer.push({ x: rng(), y: rng(), r: size * (0.6 + rng() * 0.6), a: 0.25 + rng() * 0.6, tw: rng() * 10 });
      this.stars.push(layer);
    }
    this.glow.star = makeGlowSprite(PALETTE.starGlow);
    this.glow.haven = makeGlowSprite(PALETTE.havenGlow);
    this.glow.beacon = makeGlowSprite(PALETTE.beaconGlow);
    this.glow.danger = makeGlowSprite('rgba(255, 80, 80, ');
    this.glow.mote = makeGlowSprite('rgba(143, 245, 255, ');
    for (const id of Object.keys(TRAIL_COLORS) as TrailId[]) this.glow[`p-${id}`] = makeGlowSprite(TRAIL_COLORS[id].glow);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = Math.min(2, Math.max(0.42, Math.min(w / VIEW_W, h / VIEW_H)));
    this.offX = (w - CONFIG.FIELD_WIDTH * this.scale) / 2;
    this.bg = this.buildBackground(w, h);
  }

  get viewport(): { width: number; height: number; scale: number; dpr: number } {
    return { width: this.width, height: this.height, scale: this.scale, dpr: this.dpr };
  }

  private buildBackground(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * this.dpr));
    c.height = Math.max(1, Math.round(h * this.dpr));
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, PALETTE.bgTop);
    grad.addColorStop(1, PALETTE.bgBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rng = mulberry32(7);
    for (let i = 0; i < 5; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = (0.35 + rng() * 0.5) * Math.max(w, h);
      const n = g.createRadialGradient(x, y, 0, x, y, r);
      n.addColorStop(0, i % 2 ? PALETTE.nebulaA : PALETTE.nebulaB);
      n.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = n;
      g.fillRect(0, 0, w, h);
    }
    return c;
  }

  /** Prepara para uma nova partida: câmera, rastro e efeitos limpos. */
  reset(run: RunState): void {
    this.trail.length = 0;
    this.particles.clear();
    this.debrisShapes.clear();
    this.collapsedIndex = -1;
    this.shake = 0;
    this.flash = 0;
    this.camInit = false;
    this.updateCamera(run, 0);
  }

  onEvents(events: SimEvent[], run: RunState): void {
    const rm = this.options.reducedMotion;
    this.particles.density = rm ? 0.35 : 1;
    const head = TRAIL_COLORS[this.options.trail].head;
    for (const e of events) {
      switch (e.type) {
        case 'release':
          this.particles.burst(e.x, e.y, 6, head, 90, 1.8, 0.35);
          break;
        case 'capture': {
          const a = getAnchor(run, e.anchorIndex);
          const color = a?.haven ? PALETTE.haven : PALETTE.star;
          this.particles.burst(e.x, e.y, e.perfect ? 26 : 12, e.perfect ? '#fff4d6' : color, e.perfect ? 220 : 140);
          if (e.perfect) {
            if (a) this.particles.ring(a.x, a.y, '#fff1c4', a.perfectRadius * 2.2, 0.6);
            this.particles.text(e.x, e.y - 22, `PERFEITO ×${e.combo}`, '#ffe9b0', 20);
            this.kick(rm ? 0 : 5, rm ? 0 : 0.18, '255,240,200');
          }
          if (e.skipped > 0) this.particles.text(e.x, e.y - 46, 'SALTO DUPLO!', '#8ff5ff', 18, 1.3);
          this.particles.text(e.x, e.y + 4, `+${e.points}`, '#ffffff', 16, 0.9);
          break;
        }
        case 'mote':
          this.particles.burst(e.x, e.y, 7, PALETTE.mote, 110, 1.8, 0.45);
          this.particles.text(e.x, e.y - 10, `+${e.points}`, PALETTE.mote, 13, 0.7);
          break;
        case 'collapseWarn':
          break;
        case 'death': {
          this.particles.burst(e.x, e.y, 46, PALETTE.danger, 260, 3, 1.0);
          this.particles.burst(e.x, e.y, 20, head, 160, 2, 0.8);
          this.particles.ring(e.x, e.y, PALETTE.danger, 90, 0.7);
          if (e.cause === 'collapse' && run.player.kind === 'dead') {
            this.collapsedIndex = run.depth;
            const a = getAnchor(run, run.depth);
            if (a) this.particles.ring(a.x, a.y, '#ffb36b', 140, 0.9);
          }
          this.kick(rm ? 0 : 14, rm ? 0 : 0.35, '255,80,80');
          break;
        }
        case 'victory':
          for (const c of ['#fff4d6', '#ffd27a', '#8ff5ff', '#ff8fd8']) this.particles.burst(e.x, e.y, 30, c, 300, 3, 1.4);
          this.particles.ring(e.x, e.y, '#fff4d6', 240, 1.2);
          this.particles.text(e.x, e.y - 40, 'O FAROL!', '#fff4d6', 26, 1.8);
          this.kick(rm ? 0 : 8, rm ? 0 : 0.45, '255,244,214');
          break;
      }
    }
  }

  private kick(shake: number, flash: number, color: string): void {
    this.shake = Math.max(this.shake, shake);
    if (flash > this.flash) {
      this.flash = flash;
      this.flashColor = color;
    }
  }

  private updateCamera(run: RunState, dt: number): void {
    const current = getAnchor(run, run.depth);
    let target = current ? current.y - 90 : run.y;
    if (run.player.kind === 'flight') target = Math.min(target, run.y - 40);
    if (!this.camInit || dt <= 0) {
      if (!this.camInit) {
        this.camY = target;
        this.camInit = true;
      }
      return;
    }
    // Salto grande (ex.: troca de partida): reposiciona em vez de deslizar por telas inteiras.
    if (Math.abs(target - this.camY) > (this.height / this.scale) * 1.2) {
      this.camY = target;
      return;
    }
    const k = 1 - Math.exp(-dt * (run.player.kind === 'flight' ? 5 : 3.5));
    this.camY += (target - this.camY) * k;
  }

  /**
   * Desenha um quadro. `dt` = tempo real desde o último quadro (0 quando pausado),
   * usado só para efeitos visuais — nunca para regras de jogo.
   */
  render(run: RunState, dt: number): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    const rm = this.options.reducedMotion;
    this.time += dt;
    this.updateCamera(run, dt);
    this.particles.update(dt);
    this.shake *= Math.exp(-dt * 9);
    this.flash *= Math.exp(-dt * 5);
    if (this.shake < 0.05) this.shake = 0;

    if (run.player.kind !== 'dead') {
      const last = this.trail[this.trail.length - 1];
      if (!last || last.x !== run.x || last.y !== run.y) {
        this.trail.push({ x: run.x, y: run.y });
        if (this.trail.length > TRAIL_LEN) this.trail.shift();
      }
    } else if (dt > 0 && this.trail.length > 0) {
      this.trail.shift();
    }

    // Fundo
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawStarfield(rm);

    const s = this.scale;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const focusY = this.height * FOCUS;
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.offX + sx), this.dpr * (focusY - this.camY * s + sy));

    const viewTop = this.camY - focusY / s - 60;
    const viewBottom = this.camY + (this.height - focusY) / s + 60;

    this.drawEdges(viewTop, viewBottom);
    const visible = run.anchors.filter((a) => a.y + a.captureRadius > viewTop && a.y - a.captureRadius < viewBottom);
    for (const a of visible) this.drawZone(a, run);
    for (const d of run.debris) if (d.y > viewTop && d.y < viewBottom) this.drawDebris(d);
    for (const m of run.motes) if (m.alive && m.y > viewTop && m.y < viewBottom) this.drawMote(m.x, m.y, m.id);
    for (const a of visible) this.drawAnchor(a, run);
    this.drawTimer(run);
    this.drawGuide(run);
    this.drawPlayer(run);
    this.drawParticlesWorld();

    // Textos e sobreposições em espaço de tela
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels(visible, s, focusY, sx, sy);
    if (this.options.texts) this.drawParticleTexts(s, focusY);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash.toFixed(3)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    this.lastRenderMs = performance.now() - t0;
  }

  private toScreenY(y: number, s: number, focusY: number): number {
    return focusY + (y - this.camY) * s;
  }

  private drawStarfield(rm: boolean): void {
    const ctx = this.ctx;
    const factors = [0.08, 0.18, 0.32];
    ctx.fillStyle = '#ffffff';
    this.stars.forEach((layer, li) => {
      const shift = -this.camY * this.scale * factors[li]!;
      for (const st of layer) {
        let y = (st.y * this.height + shift) % this.height;
        if (y < 0) y += this.height;
        const tw = rm ? 1 : 0.75 + 0.25 * Math.sin(this.time * 1.7 + st.tw);
        ctx.globalAlpha = st.a * tw;
        ctx.fillRect(st.x * this.width, y, st.r, st.r);
      }
    });
    ctx.globalAlpha = 1;
  }

  private drawEdges(top: number, bottom: number): void {
    const ctx = this.ctx;
    const w = 26;
    for (const [x, dir] of [[0, -1], [CONFIG.FIELD_WIDTH, 1]] as const) {
      const g = ctx.createLinearGradient(x, 0, x + dir * w, 0);
      g.addColorStop(0, `${PALETTE.edge}0.0)`);
      g.addColorStop(1, `${PALETTE.edge}0.22)`);
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x, x + dir * w), top, w, bottom - top);
    }
  }

  private anchorState(a: Anchor, run: RunState): 'spent' | 'current' | 'leaving' | 'ahead' | 'collapsed' {
    if (a.index === this.collapsedIndex) return 'collapsed';
    if (a.index < run.depth) return 'spent';
    if (a.index === run.depth) return run.player.kind === 'orbit' || run.player.kind === 'dead' ? 'current' : 'leaving';
    return 'ahead';
  }

  private drawZone(a: Anchor, run: RunState): void {
    const st = this.anchorState(a, run);
    if (st !== 'ahead') return;
    const ctx = this.ctx;
    const s = this.scale;
    const next = a.index === run.depth + 1;
    const color = a.haven ? PALETTE.haven : a.final ? PALETTE.beacon : PALETTE.star;
    // Trilho de movimento: mostra antecipadamente para onde a estrela vai.
    if (a.move) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.baseX - a.move.amplitude, a.y);
      ctx.lineTo(a.baseX + a.move.amplitude, a.y);
      ctx.stroke();
    }
    ctx.globalAlpha = next ? 0.1 : 0.05;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.captureRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = next ? 0.55 : 0.28;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([7 / s, 9 / s]);
    ctx.lineDashOffset = this.options.reducedMotion ? 0 : -this.time * 14 / s;
    ctx.stroke();
    ctx.setLineDash([]);
    // Anel do Perfeito
    ctx.globalAlpha = next ? 0.6 : 0.3;
    ctx.strokeStyle = '#fff1c4';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.perfectRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawAnchor(a: Anchor, run: RunState): void {
    const ctx = this.ctx;
    const st = this.anchorState(a, run);
    if (st === 'collapsed') {
      ctx.fillStyle = '#1a1030';
      ctx.strokeStyle = 'rgba(255,120,80,0.5)';
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.coreRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    const remaining = st === 'current' ? collapseRemaining(run) : null;
    const warning = remaining !== null && remaining <= CONFIG.COLLAPSE_WARNING && run.player.kind === 'orbit';
    const sprite = warning ? this.glow.danger! : a.haven ? this.glow.haven! : a.final ? this.glow.beacon! : this.glow.star!;
    const dim = st === 'spent' ? 0.25 : st === 'leaving' ? 0.55 : 1;
    const flicker = warning && !this.options.reducedMotion ? 0.65 + 0.35 * Math.sin(this.time * 30) : 1;
    const pulse = a.final && !this.options.reducedMotion ? 1 + 0.12 * Math.sin(this.time * 3) : 1;
    const g = a.coreRadius * (a.final ? 6.5 : 4.6) * pulse;
    ctx.globalAlpha = dim * flicker;
    ctx.drawImage(sprite, a.x - g, a.y - g, g * 2, g * 2);
    if (a.final && !this.options.reducedMotion) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(this.time * 0.25);
      ctx.strokeStyle = 'rgba(255,244,214,0.25)';
      ctx.lineWidth = 2 / this.scale;
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(a.coreRadius * 1.6, 0);
        ctx.lineTo(a.coreRadius * 4.2, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = st === 'spent' ? PALETTE.spent : warning ? '#ffb0a0' : a.haven ? PALETTE.haven : a.final ? PALETTE.beacon : PALETTE.star;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.coreRadius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawTimer(run: RunState): void {
    if (run.player.kind !== 'orbit') return;
    const a = getAnchor(run, run.player.anchorIndex);
    const remaining = collapseRemaining(run);
    if (!a || remaining === null) return;
    const ctx = this.ctx;
    const frac = Math.max(0, Math.min(1, remaining / a.collapseTime));
    const warning = remaining <= CONFIG.COLLAPSE_WARNING;
    const r = CONFIG.ORBIT_RADIUS + 13;
    ctx.lineWidth = 4 / this.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const blink = warning && !this.options.reducedMotion ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 9)) : 1;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = warning ? PALETTE.danger : a.haven ? PALETTE.haven : PALETTE.star;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  private drawGuide(run: RunState): void {
    const p = run.player;
    if (!this.options.guide || p.kind !== 'orbit') return;
    const ux = -Math.sin(p.angle) * p.dir;
    const uy = Math.cos(p.angle) * p.dir;
    const ctx = this.ctx;
    const len = difficultyAt(run.depth).flightSpeed * 0.42;
    ctx.fillStyle = TRAIL_COLORS[this.options.trail].head;
    for (let d = 14; d < len; d += 11) {
      ctx.globalAlpha = 0.55 * (1 - d / len);
      ctx.beginPath();
      ctx.arc(run.x + ux * d, run.y + uy * d, 1.8 / this.scale + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(run: RunState): void {
    const ctx = this.ctx;
    const colors = TRAIL_COLORS[this.options.trail];
    const n = this.trail.length;
    if (n > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < n; i++) {
        const a = this.trail[i - 1]!;
        const b = this.trail[i]!;
        const f = i / n;
        ctx.globalAlpha = f * 0.75;
        ctx.strokeStyle = f > 0.55 ? colors.head : colors.tail;
        ctx.lineWidth = 1 + f * 8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
    if (run.player.kind === 'dead') return;
    const g = 30;
    ctx.drawImage(this.glow[`p-${this.options.trail}`]!, run.x - g, run.y - g, g * 2, g * 2);
    ctx.fillStyle = colors.head;
    ctx.beginPath();
    ctx.arc(run.x, run.y, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(run.x, run.y, CONFIG.PLAYER_RADIUS * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMote(x: number, y: number, id: number): void {
    const ctx = this.ctx;
    const g = 16;
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.glow.mote!, x - g, y - g, g * 2, g * 2);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((this.options.reducedMotion ? 0 : this.time * 2) + id);
    ctx.fillStyle = PALETTE.mote;
    const r = CONFIG.MOTE_RADIUS * 0.85;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.7, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawDebris(d: Debris): void {
    let shape = this.debrisShapes.get(d.id);
    if (!shape) {
      const rng = mulberry32(d.shapeSeed);
      shape = Array.from({ length: 9 }, () => 0.72 + rng() * 0.38);
      this.debrisShapes.set(d.id, shape);
      if (this.debrisShapes.size > 400) this.debrisShapes.delete(this.debrisShapes.keys().next().value!);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(this.time * d.spin);
    ctx.fillStyle = PALETTE.debris;
    ctx.strokeStyle = PALETTE.debrisRim;
    ctx.lineWidth = 2 / this.scale;
    ctx.beginPath();
    shape.forEach((k, i) => {
      const ang = (i / shape!.length) * Math.PI * 2;
      const px = Math.cos(ang) * d.radius * k;
      const py = Math.sin(ang) * d.radius * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Rastro de direção: legibilidade do perigo em movimento
    ctx.strokeStyle = 'rgba(154,143,196,0.25)';
    ctx.lineWidth = 2 / this.scale;
    ctx.beginPath();
    const dir = Math.sign(d.vx) || 1;
    ctx.moveTo(d.x - dir * d.radius * 1.2, d.y);
    ctx.lineTo(d.x - dir * d.radius * 2.6, d.y);
    ctx.stroke();
  }

  private drawParticlesWorld(): void {
    const ctx = this.ctx;
    for (const p of this.particles.list) {
      const f = Math.max(0, p.life / p.max);
      if (p.kind === 'spark') {
        ctx.globalAlpha = f;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = f * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = (3 * f + 0.5) / this.scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - f * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawParticleTexts(s: number, focusY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.particles.list) {
      if (p.kind !== 'text' || !p.text) continue;
      const f = Math.max(0, p.life / p.max);
      ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = `800 ${Math.round(p.size)}px ui-rounded, 'Segoe UI', system-ui, sans-serif`;
      const x = this.offX + p.x * s;
      const y = this.toScreenY(p.y, s, focusY);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5,8,23,0.8)';
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels(anchors: Anchor[], s: number, focusY: number, sx: number, sy: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(11 + 3 * Math.min(1, s))}px ui-rounded, 'Segoe UI', system-ui, sans-serif`;
    for (const a of anchors) {
      if (!a.haven && !a.final) continue;
      const x = this.offX + a.x * s + sx;
      const y = this.toScreenY(a.y - a.captureRadius - 14, s, focusY) + sy;
      ctx.fillStyle = a.final ? PALETTE.beacon : PALETTE.haven;
      ctx.globalAlpha = 0.9;
      ctx.fillText(a.final ? 'FAROL' : 'REFÚGIO', x, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Sistema de partículas com teto fixo (sem crescimento ilimitado de memória). */
export interface Particle {
  kind: 'spark' | 'ring' | 'text';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  text?: string;
}

export const MAX_PARTICLES = 600;

export class Particles {
  readonly list: Particle[] = [];
  /** 0..1 — reduzido com "movimento reduzido". */
  density = 1;

  private push(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  burst(x: number, y: number, count: number, color: string, speed = 160, size = 2.4, life = 0.7): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.5), max: life, size: size * (0.6 + Math.random() * 0.8), color });
    }
  }

  ring(x: number, y: number, color: string, size = 60, life = 0.55): void {
    this.push({ kind: 'ring', x, y, vx: 0, vy: 0, life, max: life, size, color });
  }

  text(x: number, y: number, text: string, color: string, size = 18, life = 1.1): void {
    this.push({ kind: 'text', x, y, vx: 0, vy: -38, life, max: life, size, color, text });
  }

  update(dt: number): void {
    const damp = Math.exp(-2.2 * dt);
    let w = 0;
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'spark') {
        p.vx *= damp;
        p.vy *= damp;
      }
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  clear(): void {
    this.list.length = 0;
  }
}

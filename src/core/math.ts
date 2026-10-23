export interface Vec {
  x: number;
  y: number;
}

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

export interface SegmentClosest {
  /** Parâmetro 0..1 ao longo do segmento. */
  t: number;
  /** Distância do ponto ao segmento nesse parâmetro. */
  distance: number;
  x: number;
  y: number;
}

/** Ponto do segmento P0→P1 mais próximo de C. Para segmento degenerado retorna P0. */
export function closestOnSegment(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  cx: number,
  cy: number,
): SegmentClosest {
  const dx = p1x - p0x;
  const dy = p1y - p0y;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-12) t = clamp(((cx - p0x) * dx + (cy - p0y) * dy) / len2, 0, 1);
  const x = p0x + dx * t;
  const y = p0y + dy * t;
  return { t, distance: Math.hypot(cx - x, cy - y), x, y };
}

/** Normaliza ângulo para (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** PRNG determinístico (mulberry32). Nunca usar Math.random no core. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combina semente e índice num inteiro de 32 bits bem distribuído. */
export function hashSeed(seed: number, index: number, salt = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13) ^ (salt * 0x27d4eb2f), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export const rngFor = (seed: number, index: number, salt = 0): Rng => mulberry32(hashSeed(seed, index, salt));

export const range = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

export const intRange = (rng: Rng, min: number, maxInclusive: number): number =>
  Math.floor(range(rng, min, maxInclusive + 1));

/** Semente "nova" para a camada de app (fora do core). */
export function freshSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** Valida/normaliza uma semente vinda de fora (URL, armazenamento). */
export function normalizeSeed(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
  return n >>> 0;
}

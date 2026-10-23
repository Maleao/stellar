import type { TrailId } from '../core/progression';

export const PALETTE = {
  bgTop: '#050817',
  bgBottom: '#121a44',
  nebulaA: 'rgba(120, 70, 200, 0.16)',
  nebulaB: 'rgba(30, 140, 170, 0.13)',
  star: '#ffd27a',
  starGlow: 'rgba(255, 155, 61, ',
  haven: '#7cf2d0',
  havenGlow: 'rgba(80, 230, 190, ',
  beacon: '#fff4d6',
  beaconGlow: 'rgba(255, 236, 190, ',
  spent: 'rgba(150, 160, 200, 0.35)',
  danger: '#ff5a5a',
  mote: '#8ff5ff',
  debris: '#2d2944',
  debrisRim: '#9a8fc4',
  edge: 'rgba(150, 90, 255, ',
  text: '#eef1ff',
} as const;

export const TRAIL_COLORS: Record<TrailId, { head: string; tail: string; glow: string }> = {
  cometa: { head: '#c9f6ff', tail: '#3a7bff', glow: 'rgba(127, 231, 255, ' },
  ambar: { head: '#fff1c9', tail: '#ff7a3d', glow: 'rgba(255, 190, 90, ' },
  aurora: { head: '#d9ffd6', tail: '#b07cff', glow: 'rgba(157, 255, 154, ' },
  supernova: { head: '#ffffff', tail: '#ff4fd8', glow: 'rgba(255, 140, 230, ' },
};

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/core/config';
import { difficultyAt } from '../../src/core/difficulty';
import { createRun, getAnchor, stateHash, step } from '../../src/core/simulation';
import { stepUntil, straightUpScenario, ticks } from './helpers';

describe('soltura', () => {
  it('lança pela tangente com a velocidade de voo do nível', () => {
    const run = straightUpScenario(60);
    const ev = step(run, true);
    expect(ev.map((e) => e.type)).toContain('release');
    expect(run.player.kind).toBe('flight');
    if (run.player.kind !== 'flight') return;
    expect(run.player.vx).toBeCloseTo(0, 6);
    expect(run.player.vy).toBeCloseTo(-difficultyAt(0).flightSpeed, 6);
    expect(run.x).toBeCloseTo(250, 6);
  });

  it('soltar durante o voo é ignorado', () => {
    const run = straightUpScenario(60);
    step(run, true);
    const before = run.player.kind === 'flight' ? { vx: run.player.vx, vy: run.player.vy } : null;
    const ev = step(run, true);
    expect(ev.some((e) => e.type === 'release')).toBe(false);
    expect(run.player.kind === 'flight' && { vx: run.player.vx, vy: run.player.vy }).toEqual(before);
  });
});

describe('captura', () => {
  it('captura normal no periastro: +100, multiplicador volta a ×1', () => {
    const run = straightUpScenario(60);
    step(run, true);
    const ev = stepUntil(run, 'capture');
    expect(ev).toMatchObject({ type: 'capture', anchorIndex: 1, perfect: false, skipped: 0, points: 100, combo: 1 });
    expect(run.depth).toBe(1);
    expect(run.score).toBe(100);
    // Capturado exatamente no periastro: mesma altura do centro da estrela.
    expect(run.y).toBeCloseTo(-250, 0);
    expect(run.x).toBeCloseTo(250, 6);
  });

  it('Perfeito rente ao núcleo aumenta o multiplicador e a pontuação', () => {
    const run = straightUpScenario(25);
    step(run, true);
    const ev = stepUntil(run, 'capture');
    expect(ev).toMatchObject({ perfect: true, combo: 2, points: 200 });
    expect(run.stats.perfects).toBe(1);
    expect(run.stats.maxCombo).toBe(2);
  });

  it('sentido de giro preserva o sentido do movimento e o raio converge para a órbita estável', () => {
    const run = straightUpScenario(30); // estrela à direita, jogador subindo → giro horário (dir = +1)
    step(run, true);
    stepUntil(run, 'capture');
    expect(run.player.kind === 'orbit' && run.player.dir).toBe(1);
    for (let i = 0; i < ticks(CONFIG.ORBIT_SETTLE_TIME) + 2; i++) step(run, false);
    const a = getAnchor(run, 1)!;
    expect(Math.hypot(run.x - a.x, run.y - a.y)).toBeCloseTo(CONFIG.ORBIT_RADIUS, 6);

    const left = straightUpScenario(-30); // estrela à esquerda → anti-horário
    step(left, true);
    stepUntil(left, 'capture');
    expect(left.player.kind === 'orbit' && left.player.dir).toBe(-1);
  });

  it('periastro dentro do núcleo mata (atingiu o núcleo)', () => {
    const run = straightUpScenario(5);
    step(run, true);
    const ev = stepUntil(run, 'death');
    expect(ev).toMatchObject({ type: 'death', cause: 'core' });
    expect(run.ended).toEqual({ kind: 'death', cause: 'core' });
  });

  it('não atravessa o núcleo mesmo em velocidade absurda (teste por segmento)', () => {
    const run = straightUpScenario(0);
    step(run, true);
    if (run.player.kind !== 'flight') throw new Error('esperava voo');
    run.player.vy = -60_000; // 500 u por tick: cruzaria o núcleo inteiro num passo
    const ev = step(run, false);
    expect(ev.find((e) => e.type === 'death')).toMatchObject({ cause: 'core' });
  });

  it('errar a estrela leva ao vazio', () => {
    const run = straightUpScenario(200);
    step(run, true);
    const ev = stepUntil(run, 'death');
    expect(ev).toMatchObject({ cause: 'void' });
    expect(run.score).toBe(0);
  });

  it('sair pela lateral do campo leva ao vazio rapidamente', () => {
    const run = straightUpScenario(200);
    step(run, true);
    if (run.player.kind !== 'flight') throw new Error('esperava voo');
    run.player.vx = -600;
    run.player.vy = 0;
    const ev = stepUntil(run, 'death', 200);
    expect(ev).toMatchObject({ cause: 'void' });
    expect(run.x).toBeLessThan(-CONFIG.VOID_MARGIN + 6);
  });

  it('salto duplo: pular a estrela 1 e capturar a 2 dá bônus', () => {
    const run = straightUpScenario(400);
    const a2 = run.anchors[2]!;
    Object.assign(a2, { baseX: 250 + 60, x: 250 + 60, y: -440 });
    step(run, true);
    const ev = stepUntil(run, 'capture');
    expect(ev).toMatchObject({ anchorIndex: 2, skipped: 1, points: 100 + 150 });
    expect(run.stats.skips).toBe(1);
  });

  it('capturar o Farol vence a partida com bônus', () => {
    const run = straightUpScenario(60, 250, { final: true });
    step(run, true);
    stepUntil(run, 'capture');
    expect(run.ended).toEqual({ kind: 'victory' });
    expect(run.score).toBe(100 + CONFIG.SCORE_VICTORY);
  });

  it('multiplicador tem teto em ×8', () => {
    const run = straightUpScenario(25);
    run.combo = CONFIG.COMBO_MAX;
    step(run, true);
    stepUntil(run, 'capture');
    expect(run.combo).toBe(CONFIG.COMBO_MAX);
  });
});

describe('colapso', () => {
  it('avisa uma única vez e mata exatamente no tempo da estrela', () => {
    const run = createRun(99);
    const types: string[] = [];
    let deathTick = -1;
    for (let i = 0; i < ticks(CONFIG.FIRST_ANCHOR_TIMER) + 10; i++) {
      for (const e of step(run, false)) {
        types.push(e.type);
        if (e.type === 'death') deathTick = run.tick;
      }
    }
    expect(types.filter((t) => t === 'collapseWarn')).toHaveLength(1);
    expect(run.ended).toEqual({ kind: 'death', cause: 'collapse' });
    expect(Math.abs(deathTick - ticks(CONFIG.FIRST_ANCHOR_TIMER))).toBeLessThanOrEqual(1);
  });
});

describe('fim de partida', () => {
  it('nenhum ponto, tick ou movimento após o fim', () => {
    const run = straightUpScenario(5);
    step(run, true);
    stepUntil(run, 'death');
    const frozen = stateHash(run);
    for (let i = 0; i < 500; i++) expect(step(run, i % 2 === 0)).toEqual([]);
    expect(stateHash(run)).toBe(frozen);
  });
});

describe('fragmentos e detritos', () => {
  it('fragmento no caminho é coletado uma única vez, valendo 25 × multiplicador', () => {
    const run = straightUpScenario(60);
    run.combo = 3;
    run.motes = [{ id: 1, x: 252, y: -120, alive: true }];
    step(run, true);
    const ev = stepUntil(run, 'mote');
    expect(ev).toMatchObject({ points: 75 });
    expect(run.stats.motes).toBe(1);
    stepUntil(run, 'capture');
    expect(run.stats.motes).toBe(1);
  });

  it('detrito no caminho mata o jogador em voo', () => {
    const run = straightUpScenario(60);
    run.debris = [{ id: 1, x0: 250, x: 250, y: -130, radius: 12, vx: 0, minX: 250, maxX: 250, spin: 0, shapeSeed: 1 }];
    step(run, true);
    const ev = stepUntil(run, 'death');
    expect(ev).toMatchObject({ cause: 'debris' });
    expect(run.y).toBeGreaterThan(-130);
  });
});

describe('estrelas móveis', () => {
  it('a órbita acompanha o centro da estrela em movimento', () => {
    const run = createRun(5);
    const a0 = run.anchors[0]!;
    a0.move = { amplitude: 40, period: 2, phase: 0 };
    for (let i = 0; i < 90; i++) {
      step(run, false);
      expect(Math.hypot(run.x - a0.x, run.y - a0.y)).toBeCloseTo(CONFIG.ORBIT_RADIUS, 6);
    }
    expect(a0.x).not.toBeCloseTo(a0.baseX, 1);
  });
});

describe('determinismo', () => {
  it('mesma semente + mesmas entradas = mesmo estado; sementes diferentes = mundos diferentes', () => {
    const inputs = new Set([30, 200, 410, 777, 1000, 1300]);
    const play = (seed: number): string[] => {
      const run = createRun(seed);
      const hashes: string[] = [];
      for (let t = 1; t <= 1500; t++) {
        step(run, inputs.has(t));
        if (t % 100 === 0) hashes.push(stateHash(run));
      }
      return hashes;
    };
    expect(play(424242)).toEqual(play(424242));
    const a = createRun(1).anchors.map((x) => x.baseX);
    const b = createRun(2).anchors.map((x) => x.baseX);
    expect(a.slice(1)).not.toEqual(b.slice(1));
  });

  it('estados finitos em 100 000 ticks de órbita/voo alternados', () => {
    const run = createRun(77, 'infinito');
    run.anchors[0]!.collapseTime = 1e9;
    for (let i = 0; i < 100_000 && !run.ended; i++) {
      step(run, false);
      expect(Number.isFinite(run.x) && Number.isFinite(run.y)).toBe(true);
    }
    expect(run.player.kind === 'orbit' && Math.abs(run.player.angle)).toBeLessThan(Math.PI * 4 + 1);
  });
});

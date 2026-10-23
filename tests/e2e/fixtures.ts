import { expect, test as base, type Page } from '@playwright/test';

export interface Snapshot {
  phase: string;
  runId: string;
  runCount: number;
  mode: string;
  seed: number | null;
  tick: number;
  depth: number;
  score: number;
  combo: number;
  player: string | null;
  ended: unknown;
  stats: { perfects: number; maxCombo: number; motes: number; skips: number } | null;
  frozen: boolean;
  storage: string;
  profile: {
    best: { travessia: number; infinito: number };
    totals: { runs: number; victories: number; motes: number };
    achievements: string[];
    settings: { music: boolean; sfx: boolean; guide: string; masterVolume: number; motion: string };
    tutorialDone: boolean;
  };
  lastResult: { summary: { score: number; depth: number; victory: boolean } } | null;
  listeners: number;
  audio: string;
}

/** Erros de console/página coletados durante o teste — o teste falha se houver algum. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    await use(errors);
    expect(errors, 'erros de console/página').toEqual([]);
  },
});
export { expect };

export async function openGame(page: Page, query = 'seed=4242'): Promise<void> {
  await page.goto(`/?debug=1&${query}`);
  await page.waitForFunction(() => 'window' in globalThis && (window as unknown as { __stellar?: unknown }).__stellar !== undefined);
  await expect(page.locator('#screen-menu')).toBeVisible();
}

export const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __stellar: { snapshot(): Snapshot } }).__stellar.snapshot());

export const freeze = (page: Page, on = true): Promise<void> =>
  page.evaluate((v) => (window as unknown as { __stellar: { freeze(v: boolean): void } }).__stellar.freeze(v), on);

export const advance = (page: Page, ticks: number): Promise<void> =>
  page.evaluate((n) => (window as unknown as { __stellar: { advance(n: number): void } }).__stellar.advance(n), ticks);

export const botPlan = (page: Page, strategy: 'first' | 'best' = 'first'): Promise<{ wait: number; targetIndex: number; perfect: boolean; flightTicks: number } | null> =>
  page.evaluate((s) => (window as unknown as { __stellar: { botPlan(s: string): never } }).__stellar.botPlan(s), strategy);

/**
 * Captura a próxima estrela usando a entrada REAL (tecla ou toque): o bot só diz QUANDO apertar.
 * Requer o relógio congelado.
 */
export async function captureNext(page: Page, press: () => Promise<void> = () => page.keyboard.press('Space'), strategy: 'first' | 'best' = 'first'): Promise<number> {
  const before = await snap(page);
  const plan = await botPlan(page, strategy);
  if (!plan) throw new Error(`bot sem plano na estrela ${before.depth}`);
  await advance(page, plan.wait);
  await press();
  await advance(page, plan.flightTicks + 1);
  const after = await snap(page);
  expect(after.depth, 'capturou a estrela planejada').toBe(plan.targetIndex);
  return after.depth;
}

/** Avança sem soltar até a partida acabar (colapso) e os resultados aparecerem. */
export async function waitOutRun(page: Page): Promise<Snapshot> {
  for (let i = 0; i < 40; i++) {
    await advance(page, 60);
    const s = await snap(page);
    if (s.phase === 'RESULTS') return s;
  }
  throw new Error('partida não terminou');
}

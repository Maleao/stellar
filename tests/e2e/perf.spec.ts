import fs from 'node:fs';
import { expect, openGame, test } from './fixtures';

/**
 * Mede tempo de quadro com o relógio real. O Chromium headless deste ambiente usa renderização
 * por software, então os números são um limite inferior de desempenho, não de um dispositivo real.
 */
interface Perf {
  frames: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  avgRenderMs: number;
  p95RenderMs: number;
}

const perf = (page: import('@playwright/test').Page): Promise<Perf> =>
  page.evaluate(() => (window as unknown as { __stellar: { perf(): Perf } }).__stellar.perf());
const resetPerf = (page: import('@playwright/test').Page): Promise<void> =>
  page.evaluate(() => (window as unknown as { __stellar: { resetPerf(): void } }).__stellar.resetPerf());

test('desempenho: menu com demonstração (bot + render) e partida', async ({ page }) => {
  test.setTimeout(60_000);
  const t0 = Date.now();
  await openGame(page);
  const loadMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav ? nav.loadEventEnd - nav.startTime : -1;
  });
  await resetPerf(page);
  await page.waitForTimeout(8000);
  const menu = await perf(page);

  await page.click('[data-action="play"]');
  await resetPerf(page);
  await page.waitForTimeout(6000);
  const play = await perf(page);
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1);

  const result = { loadMs, menu, play, heapMB: heap > 0 ? +(heap / 1048576).toFixed(1) : null, wallMs: Date.now() - t0 };
  console.log('PERF', JSON.stringify(result));
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/perf.json', JSON.stringify(result, null, 2));

  // Limites folgados para headless com software rendering; o objetivo é pegar regressões graves.
  expect(menu.frames).toBeGreaterThan(100);
  expect(menu.p95RenderMs).toBeLessThan(16);
  expect(play.p95RenderMs).toBeLessThan(16);
  expect(play.p95FrameMs).toBeLessThan(50);
});

test.describe('celular (DPR 3) em setor avançado', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('desempenho com detritos, estrelas móveis e partículas', async ({ page }) => {
    await openGame(page, 'seed=8080');
    await page.click('[data-action="play"]');
    await page.evaluate(async () => {
      const api = (window as unknown as { __stellar: { freeze(v: boolean): void; advance(n: number): void; botPlan(s: string): { wait: number; flightTicks: number } | null; snapshot(): { depth: number } } }).__stellar;
      api.freeze(true);
      // Chega ao setor 5: o bot diz quando soltar e a soltura entra como evento de teclado (pipeline real de entrada).
      while (api.snapshot().depth < 44) {
        const plan = api.botPlan('best');
        if (!plan) break;
        api.advance(plan.wait);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
        api.advance(plan.flightTicks + 1);
      }
      api.freeze(false);
    });
    await resetPerf(page);
    await page.waitForTimeout(2500);
    const late = await perf(page);
    console.log('PERF_MOBILE_LATE', JSON.stringify(late));
    fs.writeFileSync('test-results/perf-mobile.json', JSON.stringify(late, null, 2));
    expect(late.p95RenderMs).toBeLessThan(16);
  });
});

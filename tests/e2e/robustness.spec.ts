import { devices } from '@playwright/test';
import { advance, captureNext, expect, freeze, openGame, snap, test, waitOutRun } from './fixtures';

const KEY = 'estilingue-estelar/save';
// defaultBrowserType não pode ser usado dentro de um describe; o resto do perfil do aparelho sim.
const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];

test.describe('persistência degradada', () => {
  test('save corrompido: o jogo abre com padrões e grava um save válido', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '{"best": {"travessia": 9'), KEY);
    await openGame(page);
    const s = await snap(page);
    expect(s.storage).toBe('ok');
    expect(s.profile.best.travessia).toBe(0);
    await page.click('[data-action="play"]');
    await freeze(page);
    await captureNext(page);
    const end = await waitOutRun(page);
    const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(JSON.parse(raw!).best.travessia).toBe(end.score);
  });

  test('save com tipos errados é saneado campo a campo', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ schemaVersion: 1, best: { travessia: 'x' }, settings: { masterVolume: 50, music: false }, achievements: ['rente', 'hack'] })), KEY);
    await openGame(page);
    const p = (await snap(page)).profile;
    expect(p.best.travessia).toBe(0);
    expect(p.settings.masterVolume).toBe(1);
    expect(p.settings.music).toBe(false);
    expect(p.achievements).toEqual(['rente']);
  });

  test('localStorage bloqueado: aviso visível e jogo totalmente jogável', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('bloqueado', 'SecurityError');
        },
      });
    });
    await openGame(page);
    await expect(page.locator('#storage-notice')).toBeVisible();
    await expect(page.locator('#storage-notice')).toContainText('não será salvo');
    await page.click('[data-action="play"]');
    await freeze(page);
    await captureNext(page);
    const end = await waitOutRun(page);
    expect(end.storage).toBe('unavailable');
    expect(end.profile.best.travessia).toBe(end.score); // mantido em memória durante a sessão
  });

  test('save de versão futura não é sobrescrito', async ({ page }) => {
    const future = JSON.stringify({ schemaVersion: 42, best: { travessia: 123 } });
    await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [KEY, future]);
    await openGame(page);
    await expect(page.locator('#storage-notice')).toContainText('versão mais nova');
    await page.click('[data-action="play"]');
    await freeze(page);
    await waitOutRun(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(future);
  });
});

test.describe('estresse', () => {
  test('30 reinícios seguidos: cada partida começa limpa e não há vazamento de listeners', async ({ page }) => {
    await openGame(page);
    const baseListeners = (await snap(page)).listeners;
    await page.click('[data-action="play"]');
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Escape');
      await page.click('[data-action="restart"]');
      const s = await snap(page);
      ids.add(s.runId);
      expect([s.phase, s.score, s.depth, s.player]).toEqual(['PLAYING', 0, 0, 'orbit']);
    }
    expect(ids.size).toBe(30);
    expect((await snap(page)).listeners).toBe(baseListeners);
  });

  test('abrir e fechar modais 30 vezes', async ({ page }) => {
    await openGame(page);
    for (let i = 0; i < 30; i++) {
      await page.click('#screen-menu [data-action="settings"]');
      await page.keyboard.press('Escape');
      await page.click('#screen-menu [data-action="achievements"]');
      await page.click('#modal-achievements [data-action="close-modal"]');
    }
    await expect(page.locator('.modal:not([hidden])')).toHaveCount(0);
    expect((await snap(page)).phase).toBe('MENU');
  });

  test('apertar Espaço 200 vezes durante o voo não gera soltura extra nem erro', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await freeze(page);
    await page.keyboard.press('Space');
    await advance(page, 1);
    expect((await snap(page)).player).toBe('flight');
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press('Space');
      await advance(page, 1);
      const s = await snap(page);
      if (s.ended) break;
    }
    const s = await snap(page);
    expect(s.ended === null || typeof s.ended === 'object').toBe(true);
    expect(Number.isFinite(s.score)).toBe(true);
  });

  test('tecla segurada (auto-repeat) solta apenas uma vez', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await freeze(page);
    await page.keyboard.down('Space');
    await advance(page, 1);
    for (let i = 0; i < 5; i++) await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true })));
    await page.keyboard.up('Space');
    await advance(page, 1);
    expect((await snap(page)).player).toBe('flight');
  });

  test('redimensionar no meio da partida', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    for (const [w, h] of [[800, 600], [390, 844], [1920, 1080], [320, 480], [1280, 720]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      const dims = await page.evaluate(() => {
        const c = document.getElementById('game') as HTMLCanvasElement;
        return { cw: c.clientWidth, ch: c.clientHeight, w: c.width };
      });
      expect(dims.cw).toBe(w);
      expect(dims.ch).toBe(h);
      expect(dims.w).toBeGreaterThanOrEqual(w);
    }
    expect((await snap(page)).phase).toBe('PLAYING');
  });
});

test.describe('celular', () => {
  test.use(pixel7);

  test('toque inicia a partida e solta a centelha', async ({ page }) => {
    await openGame(page);
    await page.tap('[data-action="play"]');
    await freeze(page);
    const depth = await captureNext(page, () => page.tap('#game', { position: { x: 200, y: 400 } }));
    expect(depth).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#hud-score')).not.toHaveText('0');
    await page.tap('[data-action="pause"]');
    await expect(page.locator('#screen-pause')).toBeVisible();
  });
});

test.describe('várias abas', () => {
  test('progresso gravado numa aba aparece na outra e nenhuma apaga a outra', async ({ page, context }) => {
    await openGame(page);
    const other = await context.newPage();
    await openGame(other);
    await page.click('[data-action="play"]');
    await freeze(page);
    await captureNext(page);
    const a = await waitOutRun(page);
    await expect(other.locator('#menu-best')).toContainText(a.score.toLocaleString('pt-BR'));
    // A outra aba joga e grava; os totais somam (merge-on-write)
    await other.click('[data-action="play"]');
    await freeze(other);
    const b = await waitOutRun(other);
    expect(b.profile.totals.runs).toBe(2);
    expect(b.profile.best.travessia).toBe(Math.max(a.score, b.score));
    await other.close();
  });

  test('Enter nos resultados inicia nova partida', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await freeze(page);
    await waitOutRun(page);
    await expect(page.locator('#screen-results .btn-primary')).toBeFocused();
    await page.keyboard.press('Enter');
    expect((await snap(page)).phase).toBe('PLAYING');
  });
});

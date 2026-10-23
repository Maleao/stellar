import { advance, captureNext, expect, freeze, openGame, snap, test, waitOutRun } from './fixtures';

test.describe('fluxo crítico', () => {
  test('menu → jogar → capturar → colapso → resultados → reiniciar limpo → recarregar mantém recorde', async ({ page, errors }) => {
    await openGame(page);
    await expect(page.locator('h1')).toContainText('Estilingue');
    expect((await snap(page)).phase).toBe('MENU');

    await page.click('[data-action="play"]');
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#hint')).toHaveClass(/show/); // tutorial contextual na 1ª partida
    let s = await snap(page);
    expect(s.phase).toBe('PLAYING');
    expect(s.seed).toBe(4242);
    const firstRunId = s.runId;

    await freeze(page);
    await captureNext(page);
    await captureNext(page);
    s = await snap(page);
    expect(s.depth).toBeGreaterThanOrEqual(2);
    expect(s.score).toBeGreaterThan(0);
    await expect(page.locator('#hud-score')).toHaveText(s.score.toLocaleString('pt-BR'));
    await expect(page.locator('#hud-star')).toHaveText(`Estrela ${s.depth}/50`);

    // Sem soltar: a estrela colapsa → ENDING → RESULTS
    const end = await waitOutRun(page);
    expect(end.ended).toEqual({ kind: 'death', cause: 'collapse' });
    await expect(page.locator('#screen-results')).toBeVisible();
    await expect(page.locator('#res-cause')).toHaveText('A estrela colapsou com você em órbita.');
    await expect(page.locator('#res-score')).toHaveText(end.score.toLocaleString('pt-BR'));
    await expect(page.locator('#res-record')).toBeVisible();
    await expect(page.locator('#res-seed')).toHaveText('4242');
    expect(end.profile.best.travessia).toBe(end.score);
    expect(end.profile.totals.runs).toBe(1);
    expect(end.profile.tutorialDone).toBe(true);
    expect(end.profile.achievements).toContain('primeiro-salto');

    // Resultado gravado uma única vez, mesmo com o tempo passando nos resultados
    await advance(page, 600);
    expect((await snap(page)).profile.totals.runs).toBe(1);

    // Reiniciar: partida nova e limpa
    await page.click('[data-action="play-again"]');
    s = await snap(page);
    expect(s.phase).toBe('PLAYING');
    expect(s.runId).not.toBe(firstRunId);
    expect([s.tick, s.depth, s.score, s.combo, s.player, s.ended]).toEqual([0, 0, 0, 1, 'orbit', null]);
    await expect(page.locator('#hud-score')).toHaveText('0');
    await expect(page.locator('#hud-combo')).toHaveText('×1');
    await expect(page.locator('#hint')).not.toHaveClass(/show/); // tutorial não repete

    // Recarregar: recorde e progresso persistem
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __stellar?: unknown }).__stellar !== undefined);
    const after = await snap(page);
    expect(after.profile.best.travessia).toBe(end.score);
    await expect(page.locator('#menu-best')).toContainText(end.score.toLocaleString('pt-BR'));
    expect(errors).toEqual([]);
  });

  test('"Mesma semente" repete o mapa e "Menu" volta ao início', async ({ page }) => {
    await openGame(page, 'seed=99');
    await page.click('[data-action="play"]');
    await freeze(page);
    await waitOutRun(page);
    await page.click('[data-action="same-seed"]');
    expect((await snap(page)).seed).toBe(99);
    await advance(page, 2000);
    await expect(page.locator('#screen-results')).toBeVisible();
    await page.click('#screen-results [data-action="menu"]');
    await expect(page.locator('#screen-menu')).toBeVisible();
    expect((await snap(page)).profile.totals.runs).toBe(2);
  });

  test('vitória completa na Travessia pela entrada real libera o Modo Infinito', async ({ page }) => {
    test.setTimeout(120_000);
    await openGame(page, 'seed=31337');
    await expect(page.locator('#btn-infinite')).toHaveAttribute('aria-disabled', 'true');
    await page.click('[data-action="play-infinite"]', { force: true }); // bloqueado: nada acontece
    expect((await snap(page)).phase).toBe('MENU');

    await page.click('[data-action="play"]');
    await freeze(page);
    let depth = 0;
    while (depth < 50) depth = await captureNext(page, undefined, 'best');
    const s = await snap(page);
    expect(s.ended).toEqual({ kind: 'victory' });
    await advance(page, 200);
    await expect(page.locator('#res-title')).toHaveText('Travessia completa!');
    const p = (await snap(page)).profile;
    expect(p.totals.victories).toBe(1);
    expect(p.achievements).toEqual(expect.arrayContaining(['travessia', 'setor-3', 'em-chamas']));

    await page.click('#screen-results [data-action="menu"]');
    await expect(page.locator('#btn-infinite')).toHaveAttribute('aria-disabled', 'false');
    await page.click('[data-action="play-infinite"]');
    const inf = await snap(page);
    expect(inf.mode).toBe('infinito');
    await expect(page.locator('#hud-star')).toHaveText('Estrela 0 · Infinito');

    // Rastro desbloqueado pode ser escolhido nas Conquistas
    await page.keyboard.press('Escape');
    await page.click('#screen-pause [data-action="menu"]');
    await page.click('[data-action="achievements"]');
    await page.click('[data-trail="supernova"]');
    await expect(page.locator('[data-trail="supernova"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('[data-trail="aurora"]', { force: true }); // ainda bloqueado
    await expect(page.locator('[data-trail="supernova"]')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('estados', () => {
  test('pausa congela o jogo, descarta entradas e retoma', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen-pause')).toBeVisible();
    const t1 = (await snap(page)).tick;
    await page.waitForTimeout(500);
    expect((await snap(page)).tick).toBe(t1);

    // Espaço sem botão focado durante a pausa: ignorado e não "vaza" para depois da retomada
    await page.locator('#screen-pause .btn-primary').evaluate((b) => (b as HTMLElement).blur());
    await page.keyboard.press('Space');
    expect((await snap(page)).phase).toBe('PAUSED');
    await freeze(page); // congela antes de retomar para medir ticks exatos
    await page.click('[data-action="resume"]');
    await advance(page, 2);
    const s = await snap(page);
    expect(s.phase).toBe('PLAYING');
    expect(s.player).toBe('orbit');
    expect(s.tick).toBe(t1 + 2);

    // Espaço com "Continuar" focado ativa o botão (padrão de acessibilidade) — retoma sem soltar
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen-pause .btn-primary')).toBeFocused();
    await page.keyboard.press('Space');
    await advance(page, 2);
    const r = await snap(page);
    expect([r.phase, r.player]).toEqual(['PLAYING', 'orbit']);

    // Esc alterna pausa; P também
    await page.keyboard.press('KeyP');
    expect((await snap(page)).phase).toBe('PAUSED');
    await page.keyboard.press('KeyP');
    expect((await snap(page)).phase).toBe('PLAYING');
  });

  test('aba oculta e perda de foco pausam automaticamente', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await snap(page)).phase).toBe('PAUSED');
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: false, configurable: true }));
    await page.click('[data-action="resume"]');
    expect((await snap(page)).phase).toBe('PLAYING');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect((await snap(page)).phase).toBe('PAUSED');
  });

  test('reiniciar pela pausa repete a semente e começa limpo', async ({ page }) => {
    await openGame(page, 'seed=555');
    await page.click('[data-action="play"]');
    await freeze(page);
    await captureNext(page);
    await page.keyboard.press('Escape');
    await page.click('[data-action="restart"]');
    const s = await snap(page);
    expect([s.phase, s.seed, s.depth, s.score, s.tick]).toEqual(['PLAYING', 555, 0, 0, 0]);
    expect(s.profile.totals.runs).toBe(0); // partida abandonada não conta como resultado
  });
});

test.describe('interface e acessibilidade', () => {
  test('somente teclado: Tab/Enter para jogar, Esc fecha modal e devolve o foco', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('[data-action="play"]')).toBeFocused();
    await page.keyboard.press('Tab'); // Infinito (bloqueado)
    await page.keyboard.press('Tab'); // Conquistas
    await page.keyboard.press('Tab'); // Configurações
    await expect(page.locator('#screen-menu [data-action="settings"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modal-settings')).toBeVisible();
    await expect(page.locator('#set-volume')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-settings')).toBeHidden();
    await expect(page.locator('#screen-menu [data-action="settings"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    expect((await snap(page)).phase).toBe('PLAYING');
    // Espaço em jogo não aciona botões (nenhum foco em botão)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  });

  test('configurações persistem após recarregar', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="settings"]');
    await page.uncheck('#set-music');
    await page.selectOption('#set-guide', 'never');
    await page.selectOption('#set-motion', 'reduced');
    await page.locator('#set-volume').fill('30');
    await page.click('#modal-settings [data-action="close-modal"]');
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __stellar?: unknown }).__stellar !== undefined);
    const st = (await snap(page)).profile.settings;
    expect(st).toMatchObject({ music: false, guide: 'never', motion: 'reduced', masterVolume: 0.3 });
    await page.click('[data-action="settings"]');
    await expect(page.locator('#set-music')).not.toBeChecked();
    await expect(page.locator('#set-guide')).toHaveValue('never');
    await expect(page.locator('#vol-out')).toHaveText('30%');
  });

  test('apagar progresso exige confirmação', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="play"]');
    await freeze(page);
    await captureNext(page);
    await waitOutRun(page);
    await page.click('#screen-results [data-action="menu"]');
    await page.click('[data-action="settings"]');
    await page.click('[data-action="reset-progress"]');
    await expect(page.locator('#btn-reset')).toHaveText('Clique de novo para confirmar');
    expect((await snap(page)).profile.totals.runs).toBe(1);
    await page.click('[data-action="reset-progress"]');
    expect((await snap(page)).profile.totals.runs).toBe(0);
  });

  test('conquistas e ajuda abrem e fecham', async ({ page }) => {
    await openGame(page);
    await page.click('[data-action="achievements"]');
    await expect(page.locator('#ach-list li')).toHaveCount(8);
    await expect(page.locator('#trail-list [role="radio"]')).toHaveCount(4);
    await page.click('#modal-achievements [data-action="close-modal"]');
    await page.click('[data-action="help"]');
    await expect(page.locator('#modal-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-help')).toBeHidden();
  });
});

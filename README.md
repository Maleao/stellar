# Estilingue Estelar

Jogo de navegador de **um botão**: você orbita uma estrela sozinho e, no momento certo, **solta** — seguindo em linha reta pela tangente até ser capturado pela próxima estrela. Passar **rente ao núcleo** dá um *Perfeito* e multiplica os pontos; tocar o núcleo destrói você. Suba pelas 50 estrelas da **Travessia** até o **Farol**.

- TypeScript estrito, Canvas 2D, Web Audio sintetizado — **zero dependências de produção** (≈ 58 KB de JS, 20 KB gzip).
- Funciona offline após carregar, em desktop (teclado/mouse) e celular (toque).
- Lógica de jogo pura e determinística (semente + passo fixo de 1/120 s), coberta por testes unitários, de integração e E2E.

## Controles

| Ação | Teclas / gestos |
|---|---|
| Soltar | `Espaço`, `↑`, `W`, clique ou toque na tela |
| Pausar / continuar | `Esc` ou `P`, botão ⏸ |
| Confirmar em menus | `Enter`, `Tab` para navegar |

## Requisitos

- Node.js 20+ (testado com 22.22) e npm 10+
- Para E2E: Chromium do Playwright 1.63 (`npx playwright install chromium` se não estiver instalado)

## Desenvolvimento

```bash
npm install
npm run dev          # servidor de desenvolvimento (http://localhost:5173)
```

## Testes

```bash
npm run typecheck    # TypeScript estrito
npm test             # 60 testes unitários e de integração (Vitest)
npm run build        # build de produção em dist/
npm run test:e2e     # 24 testes E2E no Chromium (Playwright) — usa o build via `vite preview`
npm run test:all     # tudo acima, em ordem
```

Os testes E2E gravam medições de desempenho em `test-results/perf.json` e `test-results/perf-mobile.json`.

## Produção

```bash
npm run build        # gera dist/ estático (caminhos relativos)
npm run preview      # serve dist/ em http://localhost:4173 para conferência
```

`npm run build:single` gera também `dist-single/estilingue-estelar.html`, o jogo inteiro num único arquivo HTML (≈ 75 KB) que abre direto do disco, sem servidor.

`dist/` pode ser publicado em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare Pages, S3, itch.io como jogo HTML). Não há backend, variáveis de ambiente nem segredos.

## Parâmetros de URL

| Parâmetro | Efeito |
|---|---|
| `?seed=123` | A primeira partida usa essa semente (compartilhe mapas; reproduza bugs) |
| `?debug=1` | Expõe `window.__stellar` (instantâneo de estado, congelar relógio, avançar ticks, plano do bot, métricas de quadro) — usado pelos testes E2E |

## Estrutura

```
src/core/        regras puras e determinísticas (simulação, geração, dificuldade, bot, progressão, fases)
src/services/    persistência versionada e áudio sintetizado
src/render/      renderer Canvas 2D, partículas, paleta
src/input/       teclado/ponteiro → ações
src/ui/          telas DOM (menu, HUD, pausa, resultados, modais)
src/game.ts      orquestrador; src/loop.ts acumulador de passo fixo; src/debug.ts API de testes
tests/unit/      Vitest
tests/e2e/       Playwright
docs/            análise, design de jogo, design técnico, QA, limitações
```

## Documentação

- [Análise do projeto](docs/PROJECT_ANALYSIS.md)
- [Game design](docs/GAME_DESIGN.md)
- [Design técnico](docs/TECHNICAL_DESIGN.md)
- [Relatório de QA](docs/QA_REPORT.md)
- [Limitações conhecidas](docs/KNOWN_LIMITATIONS.md)

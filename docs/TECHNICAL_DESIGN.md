# Design Técnico

## Princípio

Toda regra de jogo vive em `src/core/` — **TypeScript puro, sem DOM, sem `Math.random`, sem relógio**. A camada de navegador (render, áudio, entrada, interface, armazenamento) só lê o estado e reage a eventos. Isso permite testar o jogo inteiro em Node e reproduzir qualquer partida pela semente.

## Módulos

```
src/
  core/                 ← puro, determinístico, 100% testável em Node
    config.ts           balanceamento centralizado (todos os números do jogo)
    rng.ts              PRNG mulberry32 + hash(semente, índice)
    math.ts             vetores, ponto mais próximo em segmento
    types.ts            tipos de estado e eventos
    difficulty.ts       parâmetros em função do nº da estrela
    world.ts            geração procedural (por índice → ordem de geração irrelevante)
    simulation.ts       createRun() / step(run, input) → eventos
    bot.ts              procura um instante de soltura que captura (usa a própria simulação)
    phase.ts            máquina de estados da aplicação (transições válidas)
    progression.ts      conquistas, desbloqueios, aplicação idempotente do resultado
  services/
    persistence.ts      esquema versionado, validação, migração, merge-on-write, fallback em memória
    audio.ts            síntese Web Audio (efeitos + música generativa), tolerante a falhas
  render/
    camera.ts, renderer.ts, particles.ts, palette.ts
  input/input.ts        teclado / ponteiro / toque → fila de ações (ignora auto-repeat)
  ui/ui.ts              telas DOM (menu, HUD, pausa, resultados, modais)
  loop.ts               acumulador de passo fixo, limite de delta
  game.ts               orquestrador (fase, partida, ligações entre sistemas)
  debug.ts              API de testes (somente com ?debug=1)
  main.ts               bootstrap
```

## Loop

- Passo fixo `TICK = 1/120 s`. A cada `requestAnimationFrame`, o delta real é limitado a 0,25 s e convertido em ticks pelo acumulador (no máximo 30 ticks por quadro → sem "espiral da morte" após perda de foco).
- O render interpola nada: com 120 Hz de lógica o erro visual é ≤ 1 tick; manter render = último estado evita estado duplicado.
- `visibilitychange` (aba oculta) → pausa automática.

## Máquina de estados (fase da aplicação)

```
BOOT → MENU → PLAYING ⇄ PAUSED
               PLAYING → ENDING (animação de morte/vitória, entrada ignorada) → RESULTS
               RESULTS → PLAYING (nova partida) | MENU
               PAUSED  → PLAYING (reiniciar) | MENU
```
Qualquer transição fora da tabela é rejeitada (retorna `false`, registra aviso em dev) e coberta por teste.

## Simulação

`step(run, releasePressed)` avança exatamente 1 tick e devolve eventos (`release`, `capture`, `mote`, `collapseWarn`, `death`, `victory`). Após `run.ended` estar definido, `step` não altera nada — nenhum ponto após o fim.

- **Órbita**: ângulo += ω·dir·dt; raio converge para `orbitRadius` em 0,25 s após a captura.
- **Soltura**: velocidade = tangente × velocidade de voo do nível.
- **Voo**: para cada estrela à frente, o ponto mais próximo **no segmento** percorrido neste tick é calculado analiticamente → impossível atravessar um núcleo, e a captura ocorre exatamente no periastro.
- **Detritos**: também por segmento; faixas geradas longe de órbitas e zonas de captura.
- Fragmentos têm flag `alive` → coletados uma única vez.

## Geração

`anchorAt(seed, i)` usa `rng(hash(seed, i))`, portanto a estrela 37 é idêntica quer seja gerada na ordem ou isolada. A geração é preguiçosa (mantém ~8 estrelas à frente) e poda entidades muito abaixo.

## Bot

`releaseSearch(run)` (generator) clona o estado e testa soltar em cada tick até o colapso, simulando o voo até captura/morte; um pré-filtro geométrico descarta retas que não passam perto de nenhuma estrela. `findRelease` executa a busca inteira; a demonstração do menu a reparte entre quadros (orçamento de 1,5 ms por tick, planejando 15 ticks à frente). Usos: (1) **teste de solvabilidade** do gerador; (2) partidas completas automatizadas (integração); (3) demonstração no menu; (4) E2E determinístico.

## Persistência

- Chave `estilingue-estelar/save`, `schemaVersion: 1`. Leitura → `JSON.parse` em try/catch → `sanitize` campo a campo (tipo errado → padrão) → `migrate` se versão antiga → versão futura desconhecida é preservada intacta (não sobrescrita) e o jogo roda em modo somente leitura de memória.
- **Merge-on-write**: toda gravação é "ler fresco → aplicar a mudança → gravar", logo duas abas não apagam o progresso uma da outra; o evento `storage` atualiza o menu da outra aba.
- **Idempotência**: cada resultado carrega `runId`; aplicar duas vezes não duplica totais.
- Falha de armazenamento nunca interrompe o jogo; a interface avisa que o progresso não será salvo.

## Estratégia de testes

| Nível | Ferramenta | Foco |
|---|---|---|
| Unitário | Vitest | rng, geometria, regras de captura/morte/pontuação, máquina de estados, dificuldade, progressão, persistência, loop |
| Integração (core) | Vitest | solvabilidade em várias sementes; bot vence travessias completas; determinismo por hash do estado |
| E2E | Playwright | fluxo completo menu→jogo→captura→morte→resultados→reinício→recarregar; pausa; aba oculta; resize; toque; armazenamento corrompido/indisponível |
| Estresse | Playwright + Vitest | 30 reinícios, 200 toques seguidos, abrir/fechar modais, 10⁵ ticks, partidas longas no Infinito |
| Desempenho | Playwright | tempo de quadro medido com demonstração rodando |

## Riscos remanescentes aceitos
- Renderização de Canvas em dispositivos muito antigos não foi medida em hardware real.
- Áudio verificado quanto a não quebrar o jogo; a qualidade sonora não é testável automaticamente.

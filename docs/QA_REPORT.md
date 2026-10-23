# Relatório de QA — Estilingue Estelar v1.0.0

Data da execução: 23/10/2026 · Ambiente: Linux, Node 22.22, Chromium headless 1243 (Playwright 1.63), renderização por software.

## Resumo

| Suíte | Comando | Resultado |
|---|---|---|
| Tipos (strict, `noUnused*`, `noUncheckedIndexedAccess`) | `npm run typecheck` | **Aprovado** — 0 erros |
| Unitários + integração | `npm test` | **Aprovado** — 60/60 (6 arquivos) |
| Build de produção | `npm run build` | **Aprovado** — JS 58 KB (20 KB gzip), CSS 9,6 KB |
| E2E Chromium | `npm run test:e2e` | **Aprovado** — 24/24, 0 instáveis, 0 erros de console |

Todos os números abaixo vêm de execuções reais desta sessão; nada foi estimado.

## Cobertura por critério da Definição de Pronto

| Critério | Status | Evidência |
|---|---|---|
| Inicialização | Testado e aprovado | `npm run build` + `vite preview`; todo E2E começa pelo procedimento documentado |
| Gameplay (ciclo completo) | Testado e aprovado | E2E "vitória completa na Travessia pela entrada real" (50 estrelas com `Espaço` real); unit: 24 sementes vencidas pelo bot |
| Controles | Testado e aprovado | E2E teclado, toque (Pixel 7), auto-repeat ignorado, 200 toques em voo, Espaço na pausa |
| Estados | Testado e aprovado | Pausa/retomar (Esc, P, botão), aba oculta, perda de foco, reinício, ENDING→RESULTS; unit da máquina de estados com transições inválidas |
| Regras | Testado e aprovado | Unit: captura no periastro, Perfeito/multiplicador/teto, núcleo, vazio, colapso exato, detrito, fragmento único, salto duplo, Farol, nada muda após o fim |
| Interface | Testado e aprovado | E2E de todos os botões dos menus, modais, foco, Enter/Tab/Esc |
| Persistência | Testado e aprovado | Recarregar mantém recorde e configurações; save corrompido, tipos errados, versão futura, `localStorage` bloqueado, duas abas (merge-on-write), idempotência por `runId` |
| Testes | Testado e aprovado | 60 unit + 24 E2E executados |
| Build | Testado e aprovado | `tsc --noEmit && vite build` |
| Console | Testado e aprovado | Fixture E2E falha o teste em qualquer `console.error` ou exceção de página — nenhum ocorreu |
| Desempenho | Testado e aprovado (headless) | Ver medições abaixo |
| Acessibilidade | Avaliado parcialmente | Navegação só por teclado testada; foco visível; Esc fecha modais e devolve o foco; `aria-live` para resultados; movimento reduzido. Sem auditoria com leitor de tela real |
| Documentação | Testado e aprovado | Comandos do README executados nesta sessão |

## O que os testes provam

### Núcleo (Vitest)
- **Solvabilidade do gerador**: o bot, usando a mesma simulação do jogador e só capturando a *próxima* estrela, vence a Travessia em **24 de 24 sementes** e passa de **120 estrelas** no Modo Infinito em 4 sementes. Se a geração criar um trecho impossível, o teste falha.
- **Partidas completas pontuando**: 3 sementes vencidas com Perfeitos, multiplicador ×8 e > 10 000 pontos.
- **Determinismo**: mesma semente + mesmas entradas ⇒ hash de estado idêntico a cada 100 ticks; 30 fps vs 120 fps ⇒ mesmo número de ticks e mesmo estado.
- **Anti-atravessamento**: núcleo detectado mesmo a 500 u/tick (teste por segmento).
- **Justiça**: em 60 sementes × 120 estrelas, nenhum detrito cruza uma órbita estável; nenhum fragmento nasce dentro de órbita; a órbita de uma estrela nunca toca a zona de captura da seguinte.
- **Estabilidade numérica**: 100 000 ticks sem valores não finitos; ângulo limitado.
- **Memória em partidas longas**: após 120 estrelas, ≤ 12 estrelas, < 80 fragmentos e < 40 detritos em memória.
- **Persistência**: validação campo a campo, migração v0→v1, versão futura preservada, cota cheia, armazenamento que lança, duas abas, apagar progresso.
- **Áudio indisponível**: nenhuma chamada lança sem Web Audio.

### Navegador (Playwright)
- Fluxo crítico completo, incluindo resultado gravado **uma única vez** e partida reiniciada **limpa**.
- 30 reinícios seguidos sem vazamento de listeners; 30 aberturas/fechamentos de modais; redimensionamento para 5 tamanhos durante a partida.

## Desempenho medido

Chromium headless, renderização por software, 1280×720 (DPR 1) e 390×844 (DPR 3). Limite inferior; hardware real com GPU tende a ser melhor.

| Cenário | Quadros | Quadro médio | p95 quadro | Pior quadro | Render médio | Render p95 |
|---|---|---|---|---|---|---|
| Menu com demonstração (bot jogando) 8 s | 477 | 16,67 ms | 16,7 ms | 16,8 ms | 0,47 ms | 0,7 ms |
| Partida 6 s | 354 | 16,81 ms | 16,8 ms | 49,9 ms (1 quadro) | 0,41 ms | 0,8 ms |
| Celular DPR 3, estrela 44 (detritos, estrelas móveis) | 147 | 16,67 ms | 16,7 ms | 16,8 ms | 0,68 ms | 1,3 ms |

- Carregamento (navegação → `load`): **52 ms** (servidor local).
- Heap JS: **9,5 MB**.
- Pior quadro isolado variou entre execuções (16,8–50 ms, 0–1 ocorrência por medição); compatível com coleta de lixo do navegador. p95 sempre ≤ 16,8 ms.

## Problemas encontrados e corrigidos

| # | Problema | Causa raiz | Correção |
|---|---|---|---|
| 1 | Saltos duplos em ~35% das estrelas (bot) | Voo de até 2,2 s alcançava a estrela i+2 com facilidade; estrelas alinhadas | Voo máximo 1,35 s e zigue-zague preferencial na geração |
| 2 | Teste de solvabilidade levava > 60 s | Bot simulava centenas de voos obviamente perdidos | Pré-filtro geométrico conservador da reta de soltura (40× mais rápido) |
| 3 | `normalizeSeed('')` aceitava `''` como semente 0 | `Number('') === 0` | String vazia rejeitada explicitamente |
| 4 | Engasgo de até 44 ms na demonstração do menu | Busca do bot inteira dentro de um quadro | Busca incremental (generator) com orçamento de 1,5 ms/tick e planejamento 15 ticks à frente; pior quadro do menu caiu de 33 ms para 16,8 ms |
| 5 | Textos flutuantes da demonstração sobrepondo botões do menu | Mesma camada de efeitos da partida | Textos desativados na demonstração; vinheta do menu reforçada |
| 6 | Painel de resultados cortado em 720 px de altura | Lista vertical longa | Estatísticas em duas colunas, ações em grade |
| 7 | Câmera deslizando por telas inteiras após saltos grandes de estado | Suavização sem limite | Reposiciona quando o alvo está a mais de 1,2 tela |
| 8 | Modal de configurações deixava a tela de pausa visível por trás | Fundo do modal translúcido demais | Fundo 93% opaco |
| 9 | Dica do tutorial "Perfeito" não aparecia se a 1ª captura fosse um salto duplo | Condição presa à estrela 1 | Condição "primeira captura da partida" |
| 10 | Menu de outra aba mostrava recorde desatualizado | Sem escuta de `storage` | Recarrega o perfil no evento `storage` (E2E com duas abas) |

## Status por funcionalidade

| Funcionalidade | Status |
|---|---|
| Órbita, soltura, voo, captura no periastro, Perfeito, multiplicador, salto duplo | Implementado · testado e aprovado |
| Colapso, núcleo, vazio, detritos, estrelas móveis, refúgios, Farol | Implementado · testado e aprovado |
| Modo Infinito (desbloqueio por vitória) | Implementado · testado e aprovado |
| Conquistas (8) e rastros (4) | Implementado · testado e aprovado |
| Persistência versionada | Implementado · testado e aprovado |
| Configurações (volume, música, efeitos, movimento, linha-guia, dicas, apagar) | Implementado · testado e aprovado |
| Tutorial contextual | Implementado · testado (1ª dica e não repetição) |
| Áudio sintetizado (efeitos + música generativa) | Implementado · testado só quanto a não quebrar o jogo; qualidade sonora **não testada** automaticamente |
| Movimento reduzido | Implementado · **não testado** visualmente por automação (inspeção de código) |
| Leitor de tela | **Não testado** com tecnologia assistiva real |
| Safari / Firefox / iOS | **Não testado** (apenas Chromium disponível) |

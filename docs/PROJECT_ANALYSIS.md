# Análise do Projeto — Fase 1 (Descoberta)

## Estado encontrado

| Item | Situação |
|---|---|
| Repositório | Diretório vazio, sem git, sem `CLAUDE.md`, README, código ou dependências |
| Código a preservar | Nenhum |
| Runtime | Node.js 22.22, npm 10.9 |
| Navegador para testes | Chromium (build 1243) pré-instalado em `/opt/pw-browsers`, compatível com Playwright 1.63 |
| Rede | Apenas o registro npm e GitHub; nenhum asset externo (fontes, imagens, áudio) pode ser baixado em tempo de execução |
| Arte / áudio | Nenhum arquivo disponível |

## Restrições que moldam as decisões

1. **Sem assets externos** → toda a arte é desenhada em Canvas 2D (formas vetoriais e gradientes procedurais) e todo o áudio é sintetizado com Web Audio.
2. **Sem backend** → jogo 100% local; persistência em `localStorage` com fallback em memória.
3. **Validação automatizada obrigatória** → a lógica de jogo precisa ser pura e determinística (semente + passo fixo), para ser testada em Node (Vitest) e controlada quadro a quadro no navegador (Playwright).
4. **Ambiente headless** → as medições de desempenho deste ambiente usam renderização por software; elas servem como limite inferior, não como número de dispositivo real.

## Stack escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript 5 (strict) | Tipos explícitos, erros pegos em build |
| Engine | Nenhuma — Canvas 2D próprio | Jogo 2D de poucas entidades; uma engine (Phaser ≈ 1 MB) acrescentaria peso sem resolver nada que o jogo precisa e dificultaria a simulação pura testável |
| Build / dev server | Vite 8 | Build estático rápido, sem configuração |
| Testes unitários/integração | Vitest 5 | Mesmo pipeline de TS do Vite |
| Testes E2E | Playwright 1.63 (fixado na versão do Chromium instalado) | Fluxos reais no navegador, teclado, toque, viewport |

Dependências de produção: **zero**.

## Riscos técnicos identificados

| Risco | Mitigação |
|---|---|
| Dependência da taxa de quadros | Simulação em passo fixo de 1/120 s com acumulador limitado |
| Atravessamento em alta velocidade | Testes de colisão por segmento (ponto mais próximo no deslocamento do passo), não por posição final |
| Fases geradas impossíveis | Um "bot" usa a própria simulação para provar que cada estrela gerada é alcançável; testado em dezenas de sementes |
| Teste E2E de jogo de timing ser instável | API de depuração (`?debug=1`) congela o relógio e avança ticks; as teclas passam pelo pipeline real de entrada |
| Autoplay de áudio bloqueado | `AudioContext` só é retomado após o primeiro gesto; jogo funciona sem áudio |
| `localStorage` indisponível ou corrompido | Adaptador com try/catch, validação campo a campo, fallback em memória e aviso na interface |

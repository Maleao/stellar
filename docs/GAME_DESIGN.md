# Estilingue Estelar — Documento de Game Design

## 1. Avaliação de conceitos

Três conceitos foram avaliados (nota 1–5; maior é melhor).

| Critério | A. Estilingue Estelar (salto entre órbitas, 1 botão) | B. Arena de pulso (mover + carregar onda) | C. Ritmo de portais |
|---|---|---|---|
| Diversão imediata | 5 | 4 | 4 |
| Fácil de entender | 5 (um botão) | 3 (dois eixos + carga) | 3 |
| Profundidade / domínio | 4 (mira, risco do "perfeito", saltos duplos) | 4 | 3 |
| Partidas rápidas | 5 | 4 | 4 |
| Progressão | 4 | 4 | 3 |
| Viabilidade técnica | 5 | 4 | 3 (sincronia de áudio frágil) |
| Custo de conteúdo | 5 (geração procedural) | 4 | 2 (fases manuais) |
| Testabilidade | 5 (determinístico, bot verificável) | 3 | 2 |
| Diferenciação | 4 | 3 | 3 |
| Sem backend | 5 | 5 | 5 |
| **Total** | **47** | **38** | **32** |

**Escolhido: A — Estilingue Estelar.**

## 2. Definição

| Item | Decisão |
|---|---|
| Nome provisório | **Estilingue Estelar** |
| Fantasia central | Ser uma centelha de luz que se lança de estrela em estrela, usando cada órbita como um estilingue |
| Público-alvo | Jogadores casuais e de "mais uma partida" (12+), em desktop e celular |
| Plataforma principal | Navegador (desktop e mobile), offline após carregar |
| Mecânica principal | Você orbita uma estrela automaticamente. **Uma única ação — soltar —** lança você em linha reta pela tangente. Passe perto o bastante de uma estrela à frente e ela o captura |
| Objetivo da partida | Subir pelas 50 estrelas da Travessia (5 setores) com a maior pontuação |
| Vitória | Ser capturado pelo **Farol**, a 50ª estrela |
| Derrota | Bater num núcleo, ficar numa estrela até ela colapsar, perder-se no vazio ou ser atingido por detrito |
| Duração | 2–5 min numa travessia completa; derrotas iniciais em 20–60 s |
| Diferencial | Risco/recompensa num único botão: mirar *rente* ao núcleo dá "Perfeito" e multiplicador, mas mirar *no* núcleo mata |
| Por que jogar de novo | Recorde, multiplicador, saltos duplos, conquistas que desbloqueiam rastros, sementes repetíveis, Modo Infinito |
| Escopo v1 | Travessia, Modo Infinito (desbloqueado ao vencer), 4 tipos de perigo, 8 conquistas, 4 rastros, configurações, tutorial contextual, áudio sintetizado |

## 3. Ciclo principal

```
ORBITAR (ação: esperar o ângulo) → SOLTAR (feedback: estalo, rastro)
→ VOO (consequência: linha reta, perigos) → CAPTURA (recompensa: pontos, Perfeito, combo)
→ NOVA DECISÃO (o relógio da estrela já corre)
```

## 4. Regras

### Captura
- Em voo, a centelha é capturada pela primeira estrela à frente cujo **ponto de maior aproximação** (periastro) fique dentro do raio de captura.
- Periastro **menor que o núcleo** → morte ("Atingiu o núcleo").
- Periastro **até o anel de Perfeito** → **Perfeito**: multiplicador +1 (máx. ×8). Captura normal reinicia o multiplicador para ×1.
- Estrelas para trás (já visitadas) se apagam e não capturam.
- Capturar uma estrela pulando outra = **Salto duplo**.

### Pontuação
| Evento | Pontos |
|---|---|
| Nova estrela | 100 × multiplicador (após atualizar o multiplicador) |
| Salto duplo | +150 × estrelas puladas × multiplicador |
| Fragmento coletado | 25 × multiplicador |
| Vitória (Farol) | +2000 |

### Perigos
| Perigo | Introduzido em | Regra de justiça |
|---|---|---|
| Colapso | Toda estrela tem um relógio (anel que se esvazia); aviso visual/sonoro a 1,5 s | Primeira estrela tem relógio longo |
| Núcleo | Sempre | O anel de Perfeito fica visível fora do núcleo |
| Detritos | Estrela 6+ | Faixas de detrito nunca cruzam uma órbita nem a zona de captura |
| Estrelas móveis | Estrela 20+ | Ficam dentro da área jogável |
| Vazio | Sempre | Sair da área lateral ou voar > 1,35 s (alcance suficiente para a próxima estrela, curto demais para atalhos triviais) |

### Dificuldade (transparente)
A dificuldade depende **somente do número da estrela**, nunca do desempenho ou de sorteio oculto. Cresce suavemente de 0 a 60: velocidade de rotação e de voo, distância entre estrelas, raio de captura menor, relógio de colapso menor, mais detritos. **A cada 10 estrelas há um Refúgio**: raio grande, relógio longo, sem detritos (intervalo de recuperação). O setor atual aparece no HUD.

#### Janelas de mira resultantes (calculadas a partir de `src/core/config.ts`)

Tempo, por volta, em que soltar leva a uma captura (somando os dois lados do núcleo), para a distância média entre estrelas:

| Estrela | Rotação (rad/s) | Raio de captura | Distância média | Janela de captura | Janela de Perfeito | Relógio de colapso | Detritos por trecho |
|---|---|---|---|---|---|---|---|
| 0 | 2.20 | 100 | 253 | ~313 ms | ~90 ms | 7.0 s (2.5 voltas) | 0.00 |
| 10 | 2.27 | 99 | 258 | ~291 ms | ~85 ms | 6.8 s (2.5 voltas) | 0.15 |
| 20 | 2.46 | 95 | 273 | ~244 ms | ~74 ms | 6.2 s (2.4 voltas) | 0.52 |
| 30 | 2.70 | 90 | 292 | ~195 ms | ~63 ms | 5.5 s (2.4 voltas) | 1.00 |
| 40 | 2.94 | 85 | 311 | ~158 ms | ~55 ms | 4.8 s (2.2 voltas) | 1.48 |
| 50 | 3.13 | 81 | 325 | ~135 ms | ~49 ms | 4.2 s (2.1 voltas) | 1.85 |

Sempre há pelo menos duas voltas — duas chances — antes do colapso. Valores não validados com jogadores humanos (ver KNOWN_LIMITATIONS).

### Rejogabilidade
Cada partida tem uma semente (mostrada nos resultados). "Mesma semente" repete o mapa — e qualquer bug pode ser reproduzido pela semente.

## 5. Progressão

| Conquista | Condição | Desbloqueia |
|---|---|---|
| Primeiro Salto | Alcançar a estrela 2 | — |
| Rente ao Núcleo | Primeiro Perfeito | — |
| Em Chamas | Multiplicador ×5 | — |
| Salto Duplo | Pular uma estrela | — |
| Setor 3 | Alcançar a estrela 21 | Rastro **Âmbar** |
| Colecionador | 200 fragmentos (total) | Rastro **Aurora** |
| Supernova | Multiplicador ×8 | — |
| Travessia | Vencer | Rastro **Supernova** + **Modo Infinito** |

Persistem: recordes por modo, maior estrela, totais, conquistas, rastro selecionado, configurações, tutorial visto.

## 6. Interface

Menu (com demonstração automática ao fundo) → HUD (pontos, multiplicador, estrela/setor, pausa) → Pausa → Resultados (causa, estatísticas, recorde, conquistas novas, semente) → Configurações, Conquistas, Como jogar.

Controles: **Espaço / ↑ / W / clique / toque** = soltar · **Esc / P** = pausar · **Enter** = jogar novamente nos resultados.

### Tutorial contextual (primeira partida, reexibível)
1. Orbitando a 1ª estrela: "Toque, clique ou Espaço para soltar".
2. Após a 1ª captura: "Passe rente ao núcleo para um PERFEITO".
3. No primeiro aviso de colapso: "A estrela vai colapsar — salte!".

### Acessibilidade
Botões HTML reais com foco visível, navegação por teclado, Esc fecha modais, contraste ≥ 4,5:1 no texto, opção **Movimento reduzido** (sem tremor/flash, menos partículas — também segue `prefers-reduced-motion`), **Linha-guia** (sempre / início / nunca).

## 7. Critérios de aceitação
- Uma partida pode ser vencida (verificado por bot em várias sementes) e perdida pelas 4 causas.
- Toda estrela gerada é alcançável a partir da anterior (verificado por bot).
- Mesma semente + mesmas entradas = mesmo resultado.
- Pausa congela a simulação; nenhuma pontuação após o fim; resultados gravados uma única vez por partida.
- O jogo funciona sem áudio e sem armazenamento.

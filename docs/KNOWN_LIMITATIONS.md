# Limitações conhecidas

Nenhum defeito crítico ou bloqueador conhecido. Os itens abaixo são limites de validação ou de escopo.

## Validação
- **Navegadores**: apenas Chromium foi testado. Safari (incl. iOS) e Firefox não foram executados neste ambiente. Riscos prováveis: política de áudio do iOS (o áudio só inicia após o primeiro toque, já tratado) e `backdrop-filter` (puramente estético).
- **Desempenho em hardware real**: as medições foram feitas em Chromium headless com renderização por software. Não houve medição em celulares reais de baixo custo.
- **Áudio**: verificado apenas que o jogo não quebra com ou sem Web Audio. Mixagem e volume relativos foram ajustados por inspeção, não por escuta.
- **Acessibilidade**: navegação por teclado e foco foram testados; leitores de tela não. O próprio jogo é visual e baseado em timing — não há modo de jogo para pessoas cegas.
- **Balanceamento**: as janelas de mira (tabela no GAME_DESIGN) foram calculadas e a solvabilidade provada por bot, mas não houve teste com jogadores humanos. A curva tardia (setores 4–5) pode estar difícil demais ou fácil demais para o público real.

## Comportamentos intencionais que podem surpreender
- `Espaço` com o botão "Continuar" focado na pausa **retoma** a partida (ativação padrão de botões); a soltura nunca é aplicada nesse caso.
- "Reiniciar" na pausa repete a **mesma semente**; "Jogar de novo" nos resultados usa semente nova; "Mesma semente" repete a anterior.
- Partidas abandonadas (Reiniciar/Menu durante a pausa) não contam como partidas jogadas.
- Ao perder o foco da janela ou ocultar a aba, o jogo pausa automaticamente.
- Um save gravado por uma versão mais nova do jogo é preservado e não é sobrescrito; nesse caso o progresso da sessão fica só em memória e a interface avisa.

## Escopo não implementado
- Placar online, contas, nuvem (desnecessários para a v1; exigiriam backend com validação de pontuação no servidor).
- Remapeamento de teclas e suporte a gamepad.
- Tradução para outros idiomas (interface só em pt-BR).
- Semente diária.

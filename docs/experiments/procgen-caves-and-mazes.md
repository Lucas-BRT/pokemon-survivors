# Cavernas e labirintos gerados: plano de implementação e experimentação

Branch privada: `exp/procgen-places` (local, a partir da `main` do mantenedor em `d26e2aea`; o `pushRemote` aponta para um remoto inexistente de propósito, então `git push` falha). Nada aqui é para PR enquanto não houver uma issue combinada (CONTRIBUTING: "anything bigger than a bug fix, open an issue first").

## 1. Por que hoje é chato (medido no código)

### Caverna (`src/game/cave.ts`, `src/game/dungeon.ts`, `CAVE` e `PLACES.cave` em `src/data/places.ts`)

| O que | Hoje | Efeito no jogador |
|---|---|---|
| Andares | `CAVE.floors = 2` mais uma câmara do tesouro | Três "telas" e acabou |
| Planta do andar | Grade fixa: B1F 3×2 salas, B2F 3×3, salas de 92×74 px a 154×124 px, células de 190×160 px | Sempre o mesmo desenho, só muda o tamanho das salas |
| Conexões | Árvore geradora por busca em profundidade; laços: 0 no B1F (sempre 5 corredores para 6 salas), 1 no B2F (sempre 9 para 9) | Quase sem escolha de rota |
| Escada | Na sala mais distante em saltos de corredor | Medido em 500 sementes: B1F 2 a 5 saltos (média 3,7), B2F 3 a 7 (média 4,5) |
| Itens | 2 por andar (uma pilha de ₽ e uma bola de item) | Nada para procurar |
| Escuridão | Luz de 72 px (104 para Fogo, 96 para Elétrico), cristais | É o único elemento de tensão |
| Tempo | `PLACES.cave.time = 100` s; o "vento" avisa em 40/20/8 s e expulsa | Quase não dá tempo de explorar, e o relógio é curto demais para andar maior |
| Fim | Uma câmara redonda de 120 px de raio, um baú, "Monster House" de 6 + 1 a cada 2 min | Um único pico de dificuldade, no final |
| Frequência | A primeira entrada de lugar (caverna, cemitério ou céu) aos 1:40, depois uma a cada 250 s ± 20; a caverna pesa 3 no bioma caverna e 1,5 no prado | Raro: cada caverna precisa valer a pena |

### Labirinto (`src/game/landmarkLayout.ts`, `MAZE` em `src/data/landmarks.ts`)

| O que | Hoje | Efeito |
|---|---|---|
| Tamanho | 5×5 células de 32 px (160 px de lado) | Cabe numa tela: dá para ver a saída de fora |
| Algoritmo | Backtracker (busca em profundidade) **a partir do centro**, labirinto perfeito | Caminho único; de 3 a 7 becos por labirinto |
| Entrada e baú | Entrada no meio do lado sul, baú no **centro** | Medido nos 6 padrões: **2, 4, 10, 10, 12 e 16 passos** da entrada ao baú (média 9) para um diâmetro de 18 a 23; um padrão tem o baú a 2 passos |
| Variação | `MAZE.patterns = 6` fixos (sementes 7001 + 31·i), esculpidos uma vez | Só 6 labirintos diferentes no jogo todo; dá para decorar |
| Perigo | Nenhum inimigo, armadilha ou tempo dentro | Zero desafio |
| Prêmio | 5×₽, 2 bolas de item, chance de ovo (`LANDMARK_LOOT.maze`) | Generoso demais para o esforço |

## 2. Restrições do projeto que valem para qualquer solução

Tiradas do CLAUDE.md e do código; todas viram critério de aceite.

1. **Determinismo.** A geração roda na simulação (`generateFloor(g.rng, …)`) e o servidor refaz as partidas ranqueadas. Só rng semeado (`g.rng`, `createRng`), `engine/dmath` no lugar de `Math.sin/cos/...`, nenhum `Math.random`/relógio. Preferir **aritmética inteira** em automatos celulares, BFS e Dijkstra. `npm run determinism` confere o mesmo hash em Node, Chromium, Firefox e WebKit.
2. **`RULES_VERSION` (43 hoje, em `replay.ts`) e `rulesGuard.test.ts`.** Mudar a geração muda os bits de uma partida: subir a versão e fixar os digests novos.
3. **Estado só de dados simples** (snapshot de co-op): grades como `number[]`/strings, nada de classes, caches em `DERIVED`. O `CaveState.plan` já é dado simples.
4. **Co-op e jogador.** Código por jogador usa `g.player`; "mundo" usa `players.ts` (`nearestPlayer`, `anchorPlayer`…). A luz da caverna já considera todos os jogadores (`inLight`).
5. **Simulação ≠ apresentação.** `src/game/*` não toca DOM nem áudio; avisos via `GameEvent`. Arte nova é código (`render/art.ts`, `render/places.ts`, `render/landmarkPieces.ts`).
6. **Pixel-perfect e celular.** Posições inteiras; toda UI nova funciona com toque, em pé e deitado. Cuidado com o custo de desenho (`render/quality.ts` tem um governador de qualidade para celulares fracos).
7. **i18n em cinco idiomas** para qualquer texto novo (`pt.ts` de referência).
8. **Testes só de regra pura** (`*.test.ts`), nada de snapshot/smoke.
9. **Laços quentes sem alocação** (`retain`, grade espacial).

## 3. Limites técnicos descobertos que moldam o desenho

- **O piso de um lugar é uma lista de formas convexas** (`FloorPlan.floor: ArenaShape[]`, só `circle` e `poly` convexo, `data/arenas.ts`), com colisão em `arenaFloor.ts` e arte assada por `rasterize`/`bakeCave` (`render/places.ts`). Cavernas orgânicas (automato celular) não são convexas: precisam virar **muitos retângulos** (fusão gulosa de células) ou ganhar um tipo novo de forma, `grid`, com consulta O(1). Decidir por medição (item 6.2).
- **A navegação dos inimigos é por grafo de salas** (`dungeonNav`, `roomDistances`). Uma caverna sem "salas" precisa de um **campo de distância** (BFS sobre a grade a partir do jogador), guardado em `DERIVED`.
- **O labirinto é um monumento do mapa** (`Landmark` em `terrain.ts`), com colisão por elipses (`hedgeRow`) e arte assada **por padrão e por linha** (`render/landmarkPieces.ts`). Um labirinto único por monumento (uma semente por local) pede arte por **autotile** (bitmask de paredes em 16 peças) em vez de assar um padrão por vez.
- **O tempo da caverna (100 s) manda.** Andares maiores precisam de mais tempo, ou de um relógio por andar, ou de um vento que avisa mais tarde. Isso é decisão de design, não de algoritmo.
- **Mapas pequenos importam.** O minimapa (`render/minimap.ts`) mostra o labirinto; qualquer labirinto novo precisa de uma versão leve no minimapa ou de névoa que se revela.

## 4. Algoritmos candidatos

### Labirintos

| Algoritmo | O que dá | Uso |
|---|---|---|
| Backtracker (o atual) | Corredores longos, poucas bifurcações | Referência (baseline) |
| Árvore em crescimento (Growing Tree), mistura de "último" e "aleatório" | Dial contínuo entre longo e ramificado | Principal candidato: um parâmetro afina o estilo |
| Prim ou Kruskal com pesos | Muitos becos curtos, difícil de seguir | Variante "emaranhada" |
| Wilson | Uniforme: sem viés de textura | Para comparar viés |
| Braid (remover becos) | Laços: escolha de rota, menos frustração | Camada por cima |
| Entrada e saída pelo diâmetro | Par de pontos mais distantes na árvore | **Corrige o maior defeito de hoje** (baú perto da entrada) |
| Tamanhos 7×7 a 11×11, não quadrado (retangular) | Mais que uma tela | Combina com névoa |

### Cavernas

| Algoritmo | O que dá | Uso |
|---|---|---|
| Salas e corredores por BSP | Plantas variadas, salas de tamanhos diferentes | Substitui a grade fixa 3×N |
| Automato celular (regra 4-5 ou B678/S345678) | Cavernas orgânicas | Andares "naturais" |
| Passeio do bêbado (drunkard's walk) | Túneis irregulares | Ligar regiões isoladas |
| Preenchimento (flood fill) + escavação | Garante conectividade das regiões | Obrigatório depois do automato |
| Voronoi/Delaunay + MST | Grafo de salas com laços escolhidos | Posicionar salas temáticas |
| Mapas de Dijkstra | Distância à entrada e à saída | Colocar escada, chaves, tesouros, becos |

## 5. Camada de jogo: o que torna interessante, usando o que já existe

Os algoritmos só dão a planta. O desafio vem de pôr coisas nela, com sistemas que o jogo já tem:

- **Caverna:** de 3 a 5 andares, com mais tempo/aviso do vento por andar. Salas temáticas (cristal, lava, poça com escorregão, "Monster House" no meio do andar, depósito de itens). Ramos com becos que escondem loot (usar `dropItem`, `dropCoins`, `awardEgg`). Atalho escondido ou porta de chave, em que a chave é um cristal carregado até a porta. Um desafio no final além do Monster House (ondas, mini-chefe). Recompensa crescente com a profundidade; risco opcional (cofre pago com HP ou tempo).
- **Labirinto:** inimigos de emboscada em becos (`spawnEnemy` com gatilho por proximidade), armadilhas (`spikes`, `bomb` dos `mapEvents`), um segundo baú falso ou lateral, névoa que se revela, relógio opcional. Saída diferente da entrada; o baú só aparece depois de passar por 2 ou 3 pontos de passagem.
- **Tudo dirigido por dados:** `src/data/places.ts`, `src/data/landmarks.ts`, com `as const satisfies`.

## 6. Experimentação: o laboratório

### 6.1 Laboratório de geração (sem mexer no jogo)
- `src/game/procgen/` com funções **puras** (grade, flood fill, Dijkstra, fusão de retângulos, os algoritmos acima). Cada uma recebe `rng` e devolve dados simples.
- Um **laboratório** que gera N sementes e imprime ASCII e métricas. Como não há `vite-node` instalado, ele roda como um teste do vitest protegido por variável de ambiente (`LAB=1 npx vitest run src/game/procgen/lab.test.ts`), fora da suíte normal.
- **Métricas de "interessante"** (para comparar geradores, não para gosto):
  - comprimento do caminho entrada→saída / diâmetro do labirinto;
  - número de becos e de laços;
  - número de curvas no caminho;
  - fração de área que o jogador precisa ver para achar o tesouro;
  - variância do tamanho das salas e nº de regiões;
  - distância (em saltos) entre a escada e o tesouro, e o "desvio" para o loot opcional.
- Também: tempo de geração e **contagem de formas** (para o piso da caverna).

### 6.2 Piso das cavernas: decidir por medição
Dois caminhos para a caverna orgânica; implementar os dois no laboratório e medir:
1. **Fusão de retângulos** (guloso): sem mudar `arenaFloor.ts`; custo = nº de formas × entidades por tick.
2. **Nova forma `grid`** no `ArenaShape`: consulta O(1) e arte direta; mexe em `data/arenas.ts`, `arenaFloor.ts` e no `rasterize`. Orçamento: ≤ N formas, ou geração + consulta dentro de X ms em celular.

### 6.3 Dentro do jogo
- Ajudantes de dev (`ps.cave(seed)`, `ps.maze(seed)`) que imprimem o ASCII e abrem o lugar, e um `ps.floor(n)` que já existe.
- Depois de aprovados nas métricas, ligar o gerador novo no `layFloor`/`maze` **atrás de uma constante** (`PROCGEN.cave`, `PROCGEN.maze`) para comparar com o antigo na mesma semente.

## 7. Fases e critérios de saída

| Fase | Entrega | Critério de saída |
|---|---|---|
| 0. Linha de base | Laboratório medindo os geradores atuais | Números das tabelas da seção 1 reproduzidos pelo laboratório |
| 1. Labirinto | Growing Tree, entrada/saída pelo diâmetro, braid, 7×7 a 9×9, semente por monumento, autotile | Caminho entrada→saída ≥ 60% do diâmetro; ≥ 3 variações de estilo; mesma semente = mesmo labirinto; arte por autotile sem assar por padrão |
| 2. Piso da caverna | Salas por BSP e/ou automato com conectividade garantida | Sempre conexo; escada alcançável; medidas de 6.2 dentro do orçamento |
| 3. Navegação | Campo de distância para inimigos em planta sem "salas" | Inimigos chegam ao jogador por qualquer planta; custo por tick medido |
| 4. Jogo | Salas temáticas, becos com loot, chave/porta, desafio final, relógio | Tempo médio de caverna e taxa de baú aberto por bots de teste dentro da faixa combinada |
| 5. Arte, minimapa, i18n | Peças novas, minimapa, textos nos cinco idiomas | Celular em pé e deitado, 60 fps nos aparelhos de referência |
| 6. Regras | `RULES_VERSION` +1, digests do `rulesGuard`, `npm run determinism` | Verde nos quatro motores |

## 8. Testes (todos de regra pura)

- Conectividade: toda célula livre alcançável a partir da entrada; escada e baú alcançáveis.
- Mesma semente, mesmo resultado; sementes diferentes, resultados diferentes (centenas de sementes).
- Limites: tudo dentro da área, nada sobreposto, corredor com folga para o jogador (como o teste atual).
- Propriedade: métricas mínimas (diâmetro, caminho, becos) para um conjunto de sementes.
- Orçamentos: nº de formas e tempo de geração.

## 9. Riscos e perguntas para o mantenedor

- **Ranqueado e justiça:** lugares aparecem em partidas ranqueadas; mudar o desafio muda o equilíbrio. Precisa de aval, `RULES_VERSION` novo e talvez atualizar o placar de tiers.
- **Desempenho em celular:** nº de formas do piso, arte por autotile, campo de distância por tick.
- **Tamanho do snapshot de co-op:** a grade do andar entra no estado; manter pequena (bytes por célula).
- **Escopo de design:** quanto de jogo novo (chaves, desafios) vale a pena, e se o mantenedor quer isso ou só plantas mais variadas.
- **Relógio da caverna:** manter 100 s ou dar tempo por andar?

## 10. Como isso viraria PRs (se o mantenedor topar)

1. Issue "Cavernas e labirintos gerados" (texto próprio, com as tabelas da seção 1).
2. PR sem mudança de comportamento: `procgen/` puro, o laboratório e os testes.
3. PR do labirinto (fase 1) com `RULES_VERSION` +1.
4. PR do piso da caverna e navegação (fases 2 e 3).
5. PR da camada de jogo e arte (fases 4 e 5).

Cada PR com prints e clipe (CONTRIBUTING), `npm test` e `npm run build` passando.

## 11. Próximo passo imediato (nesta branch)

1. Fase 0: escrever `src/game/procgen/` mínimo (grade, BFS) e o laboratório; reproduzir as métricas da seção 1.
2. Fase 1: Growing Tree + diâmetro, ver no laboratório antes de tocar no jogo.

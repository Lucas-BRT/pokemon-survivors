# Explorers: modo de jogo só de Dungeons

Documento de design. Estado: **decisões tomadas (seção 9 respondida, resumo na seção 10)**; implementação por fases (seção 11).

## 1. Resumo

Uma opção nova no menu inicial (o lobby), **Explorers**, que começa uma run que acontece **inteira dentro de Dungeons**: sem o mapa aberto, sem hordas na superfície. O jogador desce andar após andar. **A cada 20 andares há um chefe, e o tema da Dungeon muda.** Antes de entrar, uma tela explica como o modo funciona, como a tela do Arena (`src/ui/arena.ts`) faz com o seu "Como jogar".

## 2. Objetivos

- Um modo de profundidade: "até onde você chega" em vez de "sobreviva 20 minutos".
- Reaproveitar a Dungeon que já existe (andares gerados, luz, grafo de navegação, fontes de luz, Monster House, armadilhas) em vez de criar um segundo sistema.
- Ritmo claro: 19 andares de descida, o chefe no 20º, e então um tema novo.
- Funcionar em celular (toque, retrato e paisagem), nos 5 idiomas, e **determinístico** (ver seção 7).

Fora do escopo desta primeira versão: ranking online, missões/conquistas/títulos do modo, eventos de Halloween e do festival, lendas como parceiro. **Co-op está no escopo** (ver 7.1).

## 3. O que já existe e se reaproveita

(Verificado no código desta branch; confirmar os números ao implementar.)

- **Dungeon**: `src/game/cave.ts` (`CaveState`, `buildCave`, `layFloor`, `descendCave`), andares gerados por `generateFloorV2` (`src/game/dungeon.ts`), níveis 1 a 5 em `src/data/caveLevels.ts`, relógio por andar (`floorClock`), vento que expulsa o jogador, armadilhas, Monster House, câmara do tesouro.
- **Luz**: `src/game/lightSources.ts`, `src/render/caveDark.ts`, luz por Pokémon em `src/data/pokemonLight.ts` (perfis `plain`, `ember`, `blaze`, `spark`, `sonar`; alcance e intensidade por espécie, emissores selvagens). Está nesta branch como mudança ainda não commitada (RULES_VERSION 46).
- **Salas não retangulares**: `DungeonFloor.shapes` (`src/game/dungeon.ts`), peças convexas por sala (círculo, hexágono, triângulo, L, cruz, U…), já tratadas por andar, parede, luz, névoa e área (`spaces.ts`, `caveSight.ts`). Hoje só os AltCaves (`src/game/altCaves.ts`, andares `shapes` e `equal`) as usam; o gerador `generateFloorV2` só faz retângulos.
- **Navegação**: `src/game/dungeonGraph.ts` (os inimigos andam por um grafo de caminho mínimo).
- **Andares de teste**: `src/game/altCaves.ts` (`tour`, `sources`, `dark`, `shapes`, `equal`).
- **Lugares**: `PLACES`/`PLACE_RULES` em `src/data/places.ts` e `enterPlace` em `src/game/placeInterior.ts`. Hoje a caverna é um lugar que se entra a partir da run normal; `setAside` guarda o mundo e `exitPlace` devolve.
- **Precedentes de modo**: o Dojo (`Game.training`, `src/game/training.ts`, run que nunca é ranqueada) e o modo Lenda (`src/game/legend.ts`). Ambos mostram como um modo se pendura em `Game` e em `src/ui/title.ts`.
- **Menu inicial**: tiles do lobby em `src/ui/title.ts` (`dockTile`, `HOTKEYS`, tag NOVO). O Arena é o modelo de tile com tela de explicação.
- **Chefes**: `src/data/bosses.ts` (primitivas de padrão), `src/data/legendBosses.ts`, domínios em `src/data/domains/`.

## 3.0 Princípio: regras próprias, mecânicas compartilhadas

A caverna do modo normal e o Explorers **não têm as mesmas regras**. A caverna normal é um *lugar* de uma run aberta (`PLACE_RULES.cave`, `updateCave`, `enterPlace`/`exitPlace`): entra-se pela boca, o vento expulsa, o desmaio resgata na porta, foes nascem do escuro (`spawnInPlace`), há câmara do tesouro e Monster House. Explorers é uma run inteira com regras próprias. Por isso **não se pendura no lugar `cave`** nem se mexe em `updateCave`: o modo segue o padrão do **Versus** (`g.versus`, `stepVersus` no lugar de `stepTeam`, o mapa como um `Room` em `roomOf`), com `g.explorers`, o seu `stepExplorers` e o seu estado de andar.

| Compartilhado (biblioteca, extraída se precisar) | Só do Explorers | Só da caverna normal (não muda) |
|---|---|---|
| geração de andar (`generateFloorV2`, `DungeonFloor.shapes`, `floorShapes`) | população fixa por andar, sem spawn | `updateCave`, `spawnInPlace` do escuro |
| luz (`spaces.ts`, `lightSources.ts`, `pokemonLight.ts`, `lightRange`) | escada sempre disponível | vento que expulsa, resgate na porta |
| grafo de navegação (`dungeonGraph.ts`) | relógio por tema (vento/desabamento) e fim de run | câmara do tesouro, Monster House, baú |
| desenho do escuro (`render/caveDark.ts`, `caveSight.ts`) | profundidade, temas, subchefes, chefes, andares especiais | níveis de caverna 1 a 5 (`caveLevels.ts`) |
| colisão (`keepOnFloor`, `floorShapes`), HP, XP, golpes, itens | derrota (fim da run; Revive levanta no co-op) | |

Consequência: o que o modo precisar de uma peça compartilhada que hoje está presa à caverna (por exemplo `drawCaveDark`, que recebe `PlaceInteriorOf<'cave'>`) é **generalizado por tipo estrutural** (só o que a peça lê: `x`, `y`, `layout`, plano, fontes, visitadas), sem mudar o comportamento da caverna normal. Os digests da caverna normal em `rulesGuard.test.ts` não devem mudar por causa do Explorers.

**Como foi feito (fase 1):** o desenho (chão, escuro, minimapa, olhos) depende de `g.place.inside`, então o Explorers usa o **contêiner** de uma caverna (`id: 'cave'`) só para a apresentação; as **regras** são as dele: `stepExplorers` (`src/game/explorersRun.ts`) substitui `stepTeam` (solo em `main.ts`, co-op no `lockstep.ts`) e nunca chama `updateCave`, o vento que expulsa, o spawn do escuro nem o resgate na porta (`combat.ts` pula `fallInPlace` quando `g.explorers` está ligado). Só `litSources` foi extraída de `updateCave` (mesmo comportamento), mais `stateOf`/`Floor` exportados.

**Chefes e formas (fase 2):** o chefe de cada bloco é um chefe de verdade (`BOSS_PATTERNS`: Snorlax no campo, Trevenant na floresta, Onix na caverna) e o subchefe é um Alpha da espécie do tema (Butterfree, Pinsir, Golem). Os andares sorteiam formas de sala por tema (`shapeShare` e `shapes` em `EXPLORER_THEMES`) em `src/game/roomShapes.ts`: cada sala escolhida vira círculo, hexágono, losango, L, cruz ou U **dentro da sua própria caixa**, com sobreposição de 44 px nas emendas; o retângulo da sala encolhe para o que cabe na forma, os corredores são religados a ele e luzes, pedras, itens, prêmios e armadilhas são trazidos para dentro do chão. A sala de início e a da escada ficam retangulares.

**UI (fase 3, parcial):** tile **Explorers** no lobby (tecla `K`, NOVO até abrir; na dock em telas largas e na lateral em celular em pé, como o Dojo), tela de entrada `src/ui/explorers.ts` (regras, parceiro do lobby e a luz que ele dá, recorde em `ps:explorersBest`), tela de fim da descida e a ligação em `main.ts` (`startExplorersRun`, sem banco, ranking nem relatório; as folhas das espécies do andar e do próximo carregam a cada andar). Textos nos 5 idiomas em `explorers`. Parceiro: o do lobby (sem lendas); escolher outro na tela fica para depois.

## 3.1 O que falta (a construir)

1. Um **modo de run** que vive só em Dungeons (sem superfície).
2. Uma **sequência infinita de andares** com contador de profundidade (hoje a caverna tem de 2 a 4 andares mais a câmara).
3. **Temas de Dungeon** (aparência, espécies, regras) e a troca a cada 20 andares.
4. **Chefes de profundidade** (um por tema, no andar 20, 40, 60…).
5. A tela de entrada (explicação) e o tile do lobby.

## 4. Regras propostas

### 4.1 Estrutura da run

- A run começa no **andar 1** do tema 1. Cada andar tem escadas para baixo, como hoje.
- **Andares 1 a 19 do bloco**: andares normais do tema. **Andar 20 do bloco**: arena do chefe do tema. Ao vencê-lo, o bloco seguinte começa com **outro tema** e a dificuldade sobe.
- **Sem spawn**: nenhum Pokémon nasce durante o andar. Cada andar é povoado **uma vez**, ao ser gerado (os grupos de cada sala, as emboscadas e o **Monster House**, que o Explorers também tem: uma sala cheia de Pokémon com um baú de prêmio, de `generateFloorV2`/`springHouse`), e depois só diminui. **A escada para baixo está sempre disponível**, desde o início do andar: limpar o andar não a abre, só deixa o jogador sem o que fazer ali (não há o que farmar, então ele desce). Cada andar tem então um custo/benefício: matar dá XP, itens e prêmios; descer logo poupa o relógio. Isso troca o `spawnInPlace` contínuo de `cave.ts` por uma população fixa por andar.
- **Subchefes**: a cada **5 andares** (5, 10, 15; o 20 é o chefe), um subchefe guarda a escada do andar. Menor que o chefe (um padrão a menos, menos vida), é um Pokémon do tema que já existe em `BOSS_PATTERNS`/`bosses.ts` ou uma entrada nova de dados. Derrotá-lo dá uma recompensa fixa. Como a escada está sempre disponível, pular o subchefe (e o chefe) é possível; **a confirmar** se nos andares de chefe a escada só existe depois dele (ver 9, pergunta 10).
- A run **acaba** quando o jogador cai (ou foge, ver 4.4). O resultado é a **profundidade máxima** atingida.
- **Relógio por andar, com a pressão estilizada pelo tema** (ver 4.2): o `floorClock` continua a existir, mas o que o jogador vê muda. Campo e floresta usam o vento (o PMD wind atual); a caverna usa desabamento (tremor de tela, poeira, rochas) em vez de vento. Mesma regra por baixo, apresentação própria.

### 4.2 Temas

Um tema é dado, não código novo: uma entrada em uma tabela, por exemplo `EXPLORER_THEMES` em `src/data/explorers.ts`, com:

- nome (`i18n`), paleta/arte das paredes e do chão (o que `PlaceTheme` já faz para a caverna);
- espécies que povoam o tema (por faixa de profundidade, como `PLACES.cave.species`);
- regra própria opcional (por exemplo gelo que escorrega, escuridão maior, lava), pelas mesmas costuras do terreno e do clima;
- o chefe do tema (4.3) e a música.

**Primeira entrega: 3 temas**, nesta ordem, e depois o ciclo repete com dificuldade maior:

1. **Campo**: Pokémon iniciais (insetos, Rattata, Pidgey…), salas abertas, pressão pelo vento.
2. **Floresta**: Pokémon mais fortes, mais árvores/rochas como cobertura, pressão pelo vento.
3. **Caverna**: o escuro, a luz por Pokémon e as formas de sala valem o máximo aqui; a pressão é o desabamento (tremor, poeira, rochas caindo).

Campo e floresta são "andares" no sentido do modo (salas e corredores gerados, escadas), com arte de ar livre; confirmar na implementação se reaproveitam `generateFloorV2` com outra paleta ou ganham um gerador próprio.

### 4.3 Chefes

- Um chefe a cada 20 andares, escolhido pelo **tema**: o mesmo tema, o mesmo chefe, mais forte a cada ciclo (escala de `difficulty`).
- Reaproveitar `BOSS_PATTERNS` e as primitivas de `src/data/bosses.ts`; chefes novos são entradas de dados (`src/data/explorers.ts`), não código.
- Vencer o chefe dá recompensa garantida (item de evolução, TM, moedas) e abre o próximo tema.

### 4.4 Entrada, saída e recompensas

- O jogador escolhe o parceiro (como no lobby) e entra pela tela de explicação.
- Cair no andar N paga recompensas proporcionais a N.
- **Saída segura**: um item raro (Escape Rope), vendido só por NPCs especiais, tira o jogador da run guardando as recompensas. Sem ele, a única saída é cair.
- Missões, conquistas, títulos e ranking **não** ligam ao modo por enquanto.
- **Parceiro**: só os iniciais e os chocados (`PLAYABLE_IDS`), sem lendas.

### 4.5 Progressão dentro da run

Mantém o que a run normal tem: XP e nível, golpes com forks, itens, evolução. O XP é entregue por andar e por inimigo. Os pickups (Poké Balls, TMs, curses) já existem no lugar Caverna e ficam.

### 4.6 Mecânicas essenciais: forma da sala e luz do Pokémon

Estas duas coisas **são** a mecânica do modo, não enfeite. A ideia: o Pokémon que você leva decide como você enxerga e se move pela Dungeon, e a forma das salas decide o quanto isso importa.

- **Luz do Pokémon**: quem emite luz (Charmander, Pikachu, Chandelure) vê pouco e forte; quem enxerga sem luz (Zubat e outros) vê muito e fraco, e não ilumina nada para os outros. Inimigos emissores iluminam o seu canto, o que os entrega de longe. Isso muda como cada Pokémon encara o mesmo andar.
- **Forma da sala**: a luz de uma sala depende da área e das fontes dentro dela (`L = L0 + (Lmax − L0)(1 − exp(−E/(E0 (A/Aref)^γ)))`). Salas redondas, em L, em cruz ou em U mudam onde há cantos escuros, onde dá para se esconder e por onde os inimigos chegam.
- **Gerador**: `generateFloorV2` precisa passar a sortear formas (um `shapes` por sala, com a sobreposição de 44 px nas emendas, ver `shaped()` em `altCaves.ts`). O conjunto de formas e a frequência de cada uma por tema/profundidade é dado em `src/data/explorers.ts`.
- **Temas**: cada tema pode ter o seu repertório de formas (cavernas redondas; ruínas em L e cruz; vulcão em triângulo) e perfis de luz próprios do ambiente.
- **Dívidas conhecidas** (listadas na análise de colisão): as portas ficam na parede do retângulo inscrito, não na borda real da forma; o grafo de navegação só tem nós no retângulo inscrito; `keepOn` deixa até 0,25 px de corpo na parede; corpos de raio maior que 22 não passam por corredores nem emendas. Antes de gerar formas aleatórias, tratar ao menos o grafo de navegação e as portas.
- **Duplo uso do alcance**: o alcance de luz por Pokémon entra na simulação (`inLight` em `cave.ts` decide o que está iluminado e onde os inimigos nascem), então já pesa na determinismo e no `RULES_VERSION`.

## 5. Interface

### 5.1 Lobby

- Novo tile **Explorers** ao lado do Arena e do Co-op, com ícone próprio (`src/render/art.ts`, arte em string de pixels), tecla de atalho própria em `HOTKEYS` (livre: `KeyE`? conferir conflitos) e tag **NOVO** até o jogador abri-lo (mesmo padrão de `ARENA_SEEN`).
- Em celular, entra na barra de abas do lobby como os outros (ver `style.css`).

### 5.2 Tela de entrada (explicação)

Mesmo desenho da tela do Arena: o parceiro escolhido, uma faixa **Como jogar** (descer, achar as escadas, o vento, o chefe a cada 20 andares, os temas), o recorde pessoal, e o botão **Jogar**. Todas as strings em `src/i18n` (`pt.ts` de referência; `en`, `es`, `fr`, `zh` iguais chave a chave).

### 5.3 Na run

HUD mostra o **andar** (`B12F`), o tema e a distância até o chefe. A tela de fim mostra profundidade, tema, chefes vencidos e recompensas.

## 6. Dados e código (plano de arquivos)

- `src/data/explorers.ts`: `EXPLORERS` (`bossEvery: 20`, escalas), `EXPLORER_THEMES`, chefes. `as const satisfies`.
- `src/game/explorers.ts`: regras do modo (profundidade, tema por andar, chefe), funções puras. Sem DOM nem áudio.
- `Game.explorers: ExplorersRun | null` (padrão do `Game.training`): estado em dados puros, entra no `DERIVED`/snapshot conforme as regras de `game/snapshot.ts`.
- `Game.explorers` com o seu `room: Room`, e `roomOf` ganha `?? g.explorers?.room` (como o Versus). Um `layExplorerFloor(g, depth)` **novo** gera o andar a partir de **(tema, profundidade)** chamando `generateFloorV2`; `cave.ts`/`placeInterior.ts` **não mudam**.
- `stepExplorers` (no lockstep, no lugar de `stepTeam`): população, escada, relógio, subchefes/chefes, andares especiais. Só os sistemas que o modo precisa.
- Extrair/generalizar o que for preso à caverna só por tipo (ver 3.0).
- `src/ui/explorers.ts` (tela de entrada), tile e atalho em `src/ui/title.ts`, ligação em `src/main.ts`.
- Textos em `src/i18n/*.ts`; entrada no `src/site/changelog.ts`; Pokédex/guia do site se algo novo for catalogado.

## 7. Determinismo e replay

O servidor re-simula runs ranqueadas a partir do replay (`src/game/replay.ts`). Portanto:

- Em `src/game`: só o rng semeado e `engine/dmath`; nada de `Math.random`, relógio, `Math.sin/cos` etc. (`dmathGuard.test.ts` falha se houver).
- Qualquer ação do shell no modo (escolher o parceiro, descer, fugir) passa por `recordEvent` e ganha um caso em `resimulate`.
- Um modo novo muda o que as mesmas entradas produzem: **bump de `RULES_VERSION`** e fixar os digests em `rulesGuard.test.ts`.
- O modo **não tem ranking**, mas o co-op roda no lockstep (`src/game/lockstep.ts`), que exige simulação idêntica em todos os clientes; então o determinismo vale igual, mesmo sem replay no servidor.

### 7.1 Co-op

- O co-op de hoje trava lugares (`COOP_LOCKS`: as cavernas são só cenário). Explorers precisa entrar no lockstep com `g.coop` e os jogadores em `Game.players`, mesmo padrão do Versus (`stepVersus` no lugar de `stepTeam`): um `stepExplorers` que roda só o que o modo precisa.
- Estado do modo em dados puros (snapshots serializam), `TickEntry` para toda ação nova do shell (descer, usar o Escape Rope), guardas `g.coop !== null` para o solo seguir bit a bit igual.
- A sala (`coop/start.ts`) ganha `mode: 'explorers'`. Todos descem juntos; a luz de cada jogador é a do seu Pokémon (`lightRange(g, p)`, já por jogador).

## 8. Testes

- Funções puras de `src/game/explorers.ts`: profundidade → tema/chefe, ciclo de temas, recompensa por profundidade.
- Teste de dados: todo tema tem espécies, chefe e textos nos 5 idiomas; nenhum andar de chefe cai em um número que não seja múltiplo de 20.
- `altCaves`-style: um andar de cada tema gerado é conectado e andável (o teste de conectividade que já existe).
- Nada de testes de fumaça ou de snapshot.

## 9. Perguntas em aberto

Estas decidem o escopo. Marque a opção ou escreva a sua.

1. **Estrutura do andar**: andares gerados como hoje (salas e corredores) ou também andares especiais (só sala grande, só corredor, andar de descanso/loja)?
   R: também andares especiais.
2. **Ranqueado**: o modo tem ranking online e replay (mais trabalho: servidor, `resimulate`, anti-cheat) ou é local/não ranqueado como o Dojo na primeira versão?
   R: pode ser COOP. mas não precisa de rankings.
3. **Relógio**: continua o vento por andar (pressão de tempo) ou sem tempo, com a pressão vindo só dos inimigos?
   com relógio, mas vamos estilizar a mecanica, em primeiras fases, como campos e florestas, iremos usar o vento mesmo, mas caso estejamos em cavernas podemos usar outros textos como deslisamento ou mesmo efeitos como screenshake e afins para melhorar a imersão.
4. **Temas**: a lista e a ordem da seção 4.2 servem? Quantos temas na primeira entrega (sugestão: 3) e o que faz cada um de diferente?
   vamos fazer 3 temas, um "campo" com pokemons mais inicias como insetos e afins, outro em uma floresta, incluindo pokemons mais fortes, e finalmente uma caverna.
5. **Fim e fuga**: cair acaba a run; existe uma saída segura (escada de volta, item "Escape Rope") que guarda as recompensas?
   sim. mas deve ser um item raro vendido por NPCs especiais.
6. **Metajogo**: recompensas, missões, conquistas, títulos e o ranking pessoal ligam ao modo? Que moeda o modo paga?
   de inicio, não.
7. **Parceiro**: qualquer Pokémon jogável, inclusive lendas? Ou só os iniciais e chocados?
   só iniciais e chocados.
8. **Co-op**: fora desta versão (como as Cavernas, que estão em `COOP_LOCKS`)?
   deve haver coop.
9. **Formas e luz**: o jogador deve ver a luz de cada Pokémon como parte da escolha do parceiro (um aviso "luz" na tela de entrada)? As formas sorteiam por andar ou cada tema tem o seu repertório fixo?
   não entendi, implemente e veremos.
10. **Escada nos andares de guarda**: nos andares de subchefe e de chefe a escada fica disponível desde o início também (dá para pular a luta), ou só aparece depois que o guarda cai?
11. **Dificuldade**: a escala por profundidade segue a dos andares (`CAVE_GEN.packs`, `caveLevels`) ou ganha uma curva própria, e há seleção de dificuldade antes de entrar?
    tem curva própria seguindo os andares.

## 10. Decisões (resumo da seção 9)

| # | Decisão |
|---|---|
| 1 | Andares gerados **e** andares especiais (descanso, loja, sala grande). |
| 2 | Sem ranking; **co-op sim**. |
| 3 | Relógio por andar, estilizado por tema (vento em campo e floresta, desabamento em caverna). |
| 4 | 3 temas: campo, floresta, caverna. |
| 5 | Saída segura = item raro (Escape Rope), vendido só por NPCs especiais. |
| 6 | Sem metajogo (missões, conquistas, títulos) por enquanto. |
| 7 | Só iniciais e chocados. |
| 8 | Co-op incluso. |
| 9 | Formas e luz: implementar e avaliar; sem aviso na tela de entrada por ora. |
| 10 | Curva de dificuldade própria, seguindo os andares. |
| + | **Relógio zerado** (vento ou desabamento): a run acaba, valendo a profundidade atingida. |
| + | **Derrota**: HP 0 tira o jogador da run (solo e co-op); no co-op, um colega com **Revive** pode levantá-lo; o co-op segue com quem resta. |
| + | **Andares especiais** (primeira entrega): descanso (cura parcial, NPC do Escape Rope), sala grande (Monster House de andar inteiro), corredor, e **mercado** (NPC que vende itens comuns). |
| + | **Subchefes** a cada 5 andares; chefe a cada 20 (o tema troca). |
| + | **Sem spawn**: população fixa por andar; escada sempre disponível; Monster House também existe no Explorers. |

## 11. Fases sugeridas

1. **Fundação**: `g.explorers` e `stepExplorers` (padrão Versus, sem tocar a caverna normal), população fixa sem spawn contínuo, escada sempre disponível, Monster House, `src/data/explorers.ts`, `src/game/explorers.ts`, uma run que desce andares do tema 1 com contador de profundidade, sem UI nova (acessível por `?debug=explorers`).
2. **Subchefes e chefe**: o andar 5, 10, 15, o andar 20 e a troca de tema.
3. **Co-op e UI**: `stepExplorers` no lockstep, tile do lobby, tela de explicação, HUD de andar, tela de fim, textos em 5 idiomas.
4. **Temas restantes e balanceamento** (menu de debug, `DEBUG_TUNE`).
5. **Site e polimento**: changelog, Pokédex/guia, `llms.txt` e as seis páginas estáticas se o modo mudar "o que o jogo é".

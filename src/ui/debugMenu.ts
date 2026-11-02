import { BIOMES, WEATHER_IDS, type BiomeId, type WeatherId } from '../data/biomes'
import { CAVE_LEVEL_COUNT, caveLevel } from '../data/caveLevels'
import { ENEMIES, type EnemyId } from '../data/enemies'
import { MAZE_CAST, MAZE_DEBUG, MAZE_RUN } from '../data/mazeEvents'
import { setBiome } from '../game/biomes'
import { descendCave, relayCave, springAmbush, springHouse } from '../game/cave'
import { applyLab, goToMaze, type Lab } from '../game/debugStart'
import { DEBUG_RUN, DEBUG_STATS, DEBUG_TUNE, resetTune, TUNED_STATS, type TunedStat } from '../game/debugTune'
import { gainXp, recomputeStats } from '../game/leveling'
import { MOVES, type MoveId } from '../game/moves'
import { createRng } from '../engine/rng'
import { roomAt } from '../game/dungeon'
import { killEnemy } from '../game/combat'
import { enterPlace, exitPlace } from '../game/placeInterior'
import { mazeTheme } from '../data/mazeEvents'
import { mazeSiteAtPoint } from '../game/grandMaze'
import { placeTeam } from '../game/players'
import { setWeather } from '../game/weather'
import type { Game } from '../game/types'
import { LIT_DEFAULTS, lit, retune, roomLevel, type Lit } from '../render/caveSight'
import { DEBUG_VIEW } from '../render/debugOverlay'
import { copyText, renderData } from './debugData'
import { h } from './dom'

/**
 * Dev-only debug menu (F4, or `ps.debug()`): a panel with a tab for each part of the game a developer wants to stage or tune while a
 * run plays: the cave's light, the cave itself (level, floors, rooms, traps), the spawns (rates and caps, summoning, clearing), the
 * hedge maze, the world (biome, weather, clock, hazards, bosses) and the player (god mode, ₽, level-ups). Every control is a small
 * record (`Ctl`) drawn by one function, so a new knob is a line in its tab. The simulation knobs live in `game/debugTune.ts`; everything
 * else changes the running game's state directly (debug runs are never ranked). Never in a production build.
 */

type Ctl =
  | { t: 'title'; label: string }
  | { t: 'info'; text: () => string }
  | { t: 'slider'; label: string; min: number; max: number; step: number; get: () => number; set: (n: number) => void }
  | { t: 'toggle'; label: string; get: () => boolean; set: (on: boolean) => void }
  | { t: 'select'; label: string; options: readonly string[]; get: () => string; set: (v: string) => void }
  | { t: 'number'; label: string; get: () => number; set: (n: number) => void }
  | { t: 'custom'; render: (into: HTMLElement, say: (text: string) => void) => void }
  | { t: 'buttons'; items: ReadonlyArray<{ label: string; run: () => string | void }> }

type Tab = { id: string; label: string; controls: (g: Game | undefined) => Ctl[] }

type PsCall = (...args: unknown[]) => unknown

/** The dev console's tools (`window.ps`, see `main.ts`): the menu's buttons for things the console already stages. */
const ps = (name: string, ...args: unknown[]): string | void => {
  const tools = (window as unknown as { ps?: Record<string, PsCall> }).ps
  const fn = tools?.[name]
  if (!fn) return `ps.${name} não existe`
  const out = fn(...args)
  return typeof out === 'string' ? out : undefined
}

/** Things kept up while on: god mode and a frozen simulation, redone on a timer. */
const holds = { god: false, freeze: false, wind: false, windAt: 0 }

const NEED_RUN = 'Comece uma run primeiro.'
const NEED_CAVE = 'Entre na caverna primeiro.'

/* ---------------- Tabs ---------------- */

type LightControl = { key: keyof Lit; label: string; min: number; max: number; step: number }

/** The cave's light numbers by what they act on: each group is a collapsible section of the tab. */
const LIGHT: ReadonlyArray<{ group: string; controls: readonly LightControl[]; extra?: () => Ctl[] }> = [
  {
    group: 'Escuridão geral',
    controls: [
      { key: 'black', label: 'Escuridão (alpha do preto)', min: 0.5, max: 1, step: 0.005 },
      { key: 'fade', label: 'Velocidade da transição (1/s)', min: 0.5, max: 12, step: 0.5 },
    ],
  },
  {
    group: 'Jogador',
    controls: [{ key: 'playerScale', label: 'Luz do jogador (escala)', min: 0.2, max: 2, step: 0.05 }],
  },
  {
    group: 'Salas',
    controls: [
      { key: 'floor', label: 'L0: piso da sala visitada', min: 0, max: 0.6, step: 0.01 },
      { key: 'max', label: 'Teto de luz de uma sala (L máx)', min: 0.1, max: 1, step: 0.05 },
      { key: 'e0', label: 'E0: energia p/ 63% (sala média)', min: 0.1, max: 3, step: 0.05 },
      { key: 'gamma', label: 'γ: diluição por tamanho', min: 0, max: 1.5, step: 0.05 },
      { key: 'aref', label: 'Área de referência (px²)', min: 4000, max: 30000, step: 500 },
    ],
  },
  {
    group: 'Cristal ativo (aceso)',
    controls: [
      { key: 'allOn', label: 'Todos os cristais ativos (0/1, lab)', min: 0, max: 1, step: 1 },
      { key: 'auraGain', label: 'Força da luz', min: 0, max: 1, step: 0.05 },
      { key: 'aura', label: 'Raio da luz (px)', min: 10, max: 120, step: 2 },
      { key: 'auraFoot', label: 'Raio do chão iluminado no pé (px)', min: 0, max: 80, step: 2 },
      { key: 'auraEase', label: 'Tempo para acender (s)', min: 0, max: 3, step: 0.05 },
      { key: 'auraWaver', label: 'Oscilação do raio (px)', min: 0, max: 8, step: 0.25 },
      { key: 'auraBlink', label: 'Luz ao piscar antes de apagar', min: 0, max: 1, step: 0.05 },
    ],
    extra: () => [{ t: 'slider', label: 'Duração acesa (x 25 s)', min: 0.1, max: 8, step: 0.1, get: () => DEBUG_TUNE.crystal, set: (n) => (DEBUG_TUNE.crystal = n) }],
  },
  {
    group: 'Cristal inativo (apagado)',
    controls: [
      { key: 'glint', label: 'Brilho fraco ligado (0/1)', min: 0, max: 1, step: 1 },
      { key: 'glintGain', label: 'Força do brilho', min: 0, max: 1, step: 0.05 },
      { key: 'glintR', label: 'Raio do brilho (px)', min: 2, max: 40, step: 1 },
      { key: 'glintNear', label: 'Distância do brilho total (px)', min: 0, max: 300, step: 5 },
      { key: 'glintFade', label: 'Distância até sumir (px)', min: 5, max: 300, step: 5 },
    ],
  },
  {
    group: 'Portas e corredores',
    controls: [
      { key: 'door', label: 'Peso do cristal de porta', min: 0, max: 1, step: 0.05 },
      { key: 'reach', label: 'Alcance do cristal de porta (px)', min: 20, max: 240, step: 4 },
      { key: 'spill', label: 'Alcance da luz que sai da porta (px)', min: 0, max: 160, step: 4 },
    ],
  },
  {
    group: 'Paredes',
    controls: [{ key: 'rim', label: 'Luz na borda da rocha (px)', min: 0, max: 24, step: 1 }],
  },
]

const lab: Lab = { size: 4, inside: 1, doors: 0, vertical: 0 }

const lightTab: Tab = {
  id: 'light',
  label: 'Luz',
  controls: (g) => [
    { t: 'info', text: () => `L de uma sala média com 1 cristal: ${roomLevel(1, lit.aref).toFixed(2)} · com 0: ${roomLevel(0, lit.aref).toFixed(2)}` },
    ...LIGHT.flatMap((grp): Ctl[] => [
      { t: 'title', label: grp.group },
      ...grp.controls.map((c): Ctl => ({ t: 'slider', label: c.label, min: c.min, max: c.max, step: c.step, get: () => lit[c.key], set: (n) => { lit[c.key] = n; retune() } })),
      ...(grp.extra?.() ?? []),
    ]),
    { t: 'title', label: 'Sala do laboratório' },
    { t: 'slider', label: 'Tamanho (x sala média)', min: 0.5, max: 12, step: 0.5, get: () => lab.size, set: (n) => (lab.size = n) },
    { t: 'slider', label: 'Cristais dentro', min: 0, max: 12, step: 1, get: () => lab.inside, set: (n) => (lab.inside = n) },
    { t: 'slider', label: 'Cristais na porta', min: 0, max: 6, step: 1, get: () => lab.doors, set: (n) => (lab.doors = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Aplicar sala', run: () => (g && applyLab(g, { ...lab, size: lab.size || 1 }) ? 'Sala aplicada (B2F do laboratório).' : NEED_CAVE) },
        { label: 'Restaurar', run: () => { Object.assign(lit, LIT_DEFAULTS); retune(); return 'Luz restaurada.' } },
        { label: 'Copiar', run: () => { const text = JSON.stringify(lit, null, 2); console.log(text); copyText(text); return 'Valores copiados (e no console).' } },
      ],
    },
  ],
}

let caveLevelPick = 3
let caveSeed = 1
let worldSeed = 1

/** The cave the team is in, if any. */
const caveOf = (g: Game | undefined) => (g?.place.inside?.id === 'cave' ? g.place.inside : null)

const caveTab: Tab = {
  id: 'cave',
  label: 'Caverna',
  controls: (g) => {
    const goto = (label: string, at: (g: Game, inside: NonNullable<ReturnType<typeof caveOf>>) => readonly [number, number] | null): { label: string; run: () => string | void } => ({
      label,
      run: () => {
        const inside = caveOf(g)
        if (!g || !inside) return NEED_CAVE
        const to = at(g, inside)
        if (!to) return 'Nada disso neste andar.'
        placeTeam(g, inside.x + to[0], inside.y + to[1])
      },
    })
    return [
      {
        t: 'info',
        text: () => {
          const inside = caveOf(g)
          if (!g || !inside) return 'Fora da caverna.'
          const s = inside.state
          const lv = caveLevel(s.level)
          return `Nv ${s.level} · andar ${s.floor + 1}/${lv.floors}${s.plan ? '' : ' (baú)'} · vento ${inside.left.toFixed(0)}s · salas ${s.plan?.rooms.length ?? 0} (vistas ${s.visited.length}) · emboscadas ${s.sprung.length}/${s.ambush.length} · armadilhas ${s.traps.filter((t) => !t.done).length}/${s.traps.length} · inimigos ${g.enemies.length}`
        },
      },
      { t: 'title', label: 'Entrar' },
      { t: 'slider', label: 'Nível da caverna', min: 1, max: CAVE_LEVEL_COUNT, step: 1, get: () => caveLevelPick, set: (n) => (caveLevelPick = n) },
      {
        t: 'buttons',
        items: [
          {
            label: 'Entrar neste nível',
            run: () => {
              if (!g) return NEED_RUN
              if (g.place.inside) return 'Saia antes (botão ao lado).'
              enterPlace(g, 'cave', Math.round(g.player.x), Math.round(g.player.y), caveLevelPick)
            },
          },
          { label: 'Sair', run: () => (g?.place.inside ? void exitPlace(g, 'done') : 'Não está em um lugar.') },
          { label: 'Descer andar', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; if (inside.state.floor >= caveLevel(inside.state.level).floors) return 'Já é o baú.'; descendCave(g, inside) } },
        ],
      },
      { t: 'title', label: 'Ir para' },
      {
        t: 'buttons',
        items: [
          goto('Escadas', (_, i) => i.state.stairs),
          goto('Baú', (_, i) => (i.state.chest ? [i.state.chest.x, i.state.chest.y + 30] : null)),
          goto('Cristalário', (_, i) => (i.state.shop ? [i.state.shop.x, i.state.shop.y + 24] : null)),
          goto('Emboscada', (_, i) => { const r = i.state.ambush.find((a) => !i.state.sprung.includes(a)); const room = r === undefined ? null : i.state.plan?.rooms[r]; return room ? [room.x + 8, room.y + room.h / 2] : null }),
          goto('Armadilha', (_, i) => { const t = i.state.traps.find((x) => !x.done); return t ? [t.x - 30, t.y] : null }),
        ],
      },
      { t: 'title', label: 'Estado do andar' },
      { t: 'slider', label: 'Vento: segundos restantes', min: 0, max: 150, step: 1, get: () => caveOf(g)?.left ?? 0, set: (n) => { const inside = caveOf(g); if (inside) inside.left = n } },
      { t: 'toggle', label: 'Segurar o vento (relógio parado)', get: () => holds.wind, set: (on) => { holds.wind = on; holds.windAt = caveOf(g)?.left ?? 0 } },
      {
        t: 'buttons',
        items: [
          { label: 'Revelar andar', run: () => { const inside = caveOf(g); if (!g || !inside?.state.plan) return NEED_CAVE; inside.state.visited = inside.state.plan.rooms.map((_, i) => i) } },
          { label: 'Acender cristais', run: () => { const inside = caveOf(g); if (!inside) return NEED_CAVE; inside.state.touched = inside.state.lights.map((_, i) => ({ i, left: 999, age: 99 })) } },
          { label: 'Apagar cristais', run: () => { const inside = caveOf(g); if (!inside) return NEED_CAVE; inside.state.touched = [] } },
        ],
      },
      { t: 'title', label: 'Geração' },
      { t: 'number', label: 'Seed do sorteio (rng da run)', get: () => caveSeed, set: (n) => (caveSeed = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Regerar andar', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; relayCave(g, inside) } },
          { label: 'Aplicar seed e regerar', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; g.rng = createRng(caveSeed); relayCave(g, inside); return `seed ${caveSeed}` } },
        ],
      },
      { t: 'title', label: 'Perigos' },
      {
        t: 'buttons',
        items: [
          {
            label: 'Emboscada na sala atual',
            run: () => {
              const inside = caveOf(g)
              const plan = inside?.state.plan
              if (!g || !inside || !plan) return NEED_CAVE
              const room = roomAt(plan, g.player.x - inside.x, g.player.y - inside.y)
              if (room < 0) return 'Fique dentro de uma sala.'
              springAmbush(g, inside, plan.rooms[room]!, plan.sizes[room]!, g.player)
            },
          },
          { label: 'Monster House', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; springHouse(g, inside) } },
          { label: 'Disparar armadilhas', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; for (const t of inside.state.traps) if (!t.done) { t.done = true; g.player.x = inside.x + t.x; g.player.y = inside.y + t.y; break } } },
        ],
      },
    ]
  },
}

let spawnKind: EnemyId = 'geodude'
let spawnCount = 5
let spawnShiny = false

const spawnTab: Tab = {
  id: 'spawn',
  label: 'Spawn',
  controls: (g) => [
    { t: 'info', text: () => (g ? `inimigos ${g.enemies.length} (do labirinto ${g.enemies.filter((e) => e.home !== undefined).length}) · orçamento ${g.spawnBudget.toFixed(2)} · tensão ${g.tension.level.toFixed(2)}` : NEED_RUN) },
    { t: 'title', label: 'Taxas e tetos (1 = normal, 0 = parado)' },
    { t: 'slider', label: 'Horda do mapa: taxa', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.world, set: (n) => (DEBUG_TUNE.world = n) },
    { t: 'slider', label: 'Horda do mapa: teto', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.cap, set: (n) => (DEBUG_TUNE.cap = n) },
    { t: 'slider', label: 'Lugares (caverna): taxa', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.place, set: (n) => (DEBUG_TUNE.place = n) },
    { t: 'slider', label: 'Lugares (caverna): teto', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.placeCap, set: (n) => (DEBUG_TUNE.placeCap = n) },
    { t: 'slider', label: 'Labirinto: taxa e teto', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.maze, set: (n) => (DEBUG_TUNE.maze = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Parar tudo', run: () => { DEBUG_TUNE.world = DEBUG_TUNE.place = DEBUG_TUNE.maze = 0 } },
        { label: 'Normal', run: () => resetTune() },
      ],
    },
    { t: 'title', label: 'Chamar' },
    { t: 'select', label: 'Pokémon', options: (Object.keys(ENEMIES) as EnemyId[]).sort(), get: () => spawnKind, set: (v) => (spawnKind = v as EnemyId) },
    { t: 'slider', label: 'Quantos', min: 1, max: 60, step: 1, get: () => spawnCount, set: (n) => (spawnCount = n) },
    { t: 'toggle', label: 'Brilhantes', get: () => spawnShiny, set: (on) => (spawnShiny = on) },
    {
      t: 'buttons',
      items: [
        { label: 'Spawn', run: () => ps('spawn', spawnKind, spawnCount, spawnShiny) },
        { label: 'Alpha', run: () => ps('alpha', spawnKind) },
        { label: 'Chefe', run: () => ps('boss', spawnKind) },
      ],
    },
    { t: 'title', label: 'Limpar' },
    {
      t: 'buttons',
      items: [
        { label: 'Derrubar todos', run: () => { if (!g) return NEED_RUN; for (const e of [...g.enemies]) if (e.dying < 0) killEnemy(g, e) } },
        { label: 'Sumir com todos', run: () => { if (!g) return NEED_RUN; g.enemies.length = 0 } },
      ],
    },
  ],
}

const mazeTab: Tab = {
  id: 'maze',
  label: 'Labirinto',
  controls: (g) => {
    const run = () => {
      const site = g ? mazeSiteAtPoint(g.terrain.seed, g.player.x, g.player.y) : null
      return site && g ? { site, run: g.mazes.get(site.key) ?? null } : null
    }
    return [
      {
        t: 'info',
        text: () => {
          const here = run()
          if (!g || !here) return 'Fora de um labirinto.'
          const r = here.run
          const theme = mazeTheme(g.biome.id, here.site.seed).id
          const live = g.enemies.filter((e) => e.home === here.site.key && e.dying < 0).length
          return `tema ${theme} · alas ${here.site.wings.map((w) => w.kind).join('/')} · moradores ${live} · chaves ${r ? r.keys.filter((k) => !k.taken).length : '?'}/${r?.keys.length ?? '?'} · baús ${r ? r.caches.filter((c) => !c.open).length : '?'} · armadilhas ${r ? r.traps.filter((t) => !t.done).length : '?'}`
        },
      },
      {
        t: 'buttons',
        items: [
          { label: 'Ir à entrada', run: () => (g ? (goToMaze(g, false) ? undefined : 'Nenhum labirinto.') : NEED_RUN) },
          { label: 'Entrar', run: () => (g ? (goToMaze(g, true) ? undefined : 'Nenhum labirinto.') : NEED_RUN) },
        ],
      },
      { t: 'title', label: 'Conteúdo' },
      {
        t: 'buttons',
        items: [
          { label: 'Ir ao coração', run: () => { const r = run()?.run; if (!g || !r) return 'Entre num labirinto.'; placeTeam(g, r.heart.x, r.heart.y + 26) } },
          { label: 'Pegar chaves', run: () => { const r = run()?.run; if (!r) return 'Entre num labirinto.'; for (const k of r.keys) k.taken = true } },
          { label: 'Ir a um baú', run: () => { const r = run()?.run; const c = r?.caches.find((x) => !x.open); if (!g || !c) return 'Nenhum baú fechado.'; placeTeam(g, c.x, c.y + 26) } },
          { label: 'Ir a uma armadilha', run: () => { const r = run()?.run; const t = r?.traps.find((x) => !x.done); if (!g || !t) return 'Nenhuma armadilha.'; placeTeam(g, t.x, t.y + 40) } },
        ],
      },
      { t: 'title', label: 'Tema e geração' },
      { t: 'select', label: 'Tema forçado', options: ['', ...[...new Set(Object.values(MAZE_CAST).flatMap((k) => k.themes.map((t) => t.id)))]], get: () => MAZE_DEBUG.theme, set: (v) => (MAZE_DEBUG.theme = v) },
      { t: 'number', label: 'Seed do mundo (muda o terreno)', get: () => worldSeed, set: (n) => (worldSeed = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Reconstruir conteúdo', run: () => { const here = run(); if (!g || !here) return 'Entre num labirinto.'; g.mazes.delete(here.site.key); for (const e of [...g.enemies]) if (e.home === here.site.key) e.dying < 0 && killEnemy(g, e) } },
          { label: 'Novo mundo e ir ao labirinto', run: () => { if (!g) return NEED_RUN; g.terrain.seed = worldSeed; g.mazes.clear(); g.enemies.length = 0; return goToMaze(g, false) ? `seed ${worldSeed}` : 'Nenhum labirinto.' } },
        ],
      },
      { t: 'title', label: 'Moradores' },
      { t: 'slider', label: 'Taxa e teto dos moradores', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.maze, set: (n) => (DEBUG_TUNE.maze = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Spawn agora', run: () => { const r = run()?.run; if (!r) return 'Entre num labirinto.'; r.spawnIn = 0 } },
          { label: 'Derrubar moradores', run: () => { const here = run(); if (!g || !here) return 'Entre num labirinto.'; for (const e of [...g.enemies]) if (e.home === here.site.key && e.dying < 0) killEnemy(g, e) } },
        ],
      },
      { t: 'info', text: () => `Base ${MAZE_RUN.live.base}, +1 a cada ${MAZE_RUN.live.perMinutes} min, máx ${MAZE_RUN.live.max}, um novo a cada ${MAZE_RUN.live.every}s.` },
    ]
  },
}

const HAZARDS = ['volley', 'line', 'zone'] as const

const worldTab: Tab = {
  id: 'world',
  label: 'Mundo',
  controls: (g) => [
    { t: 'info', text: () => (g ? `${g.biome.id} · ${g.weather.id} · ${(g.time / 60).toFixed(1)} min · dificuldade ${g.difficulty}` : NEED_RUN) },
    { t: 'select', label: 'Bioma', options: Object.keys(BIOMES), get: () => g?.biome.id ?? 'meadow', set: (v) => g && setBiome(g, v as BiomeId) },
    { t: 'select', label: 'Clima', options: WEATHER_IDS, get: () => g?.weather.id ?? 'clear', set: (v) => g && setWeather(g, v as WeatherId) },
    { t: 'slider', label: 'Relógio da run (min)', min: 0, max: 30, step: 0.5, get: () => (g ? g.time / 60 : 0), set: (n) => { if (g) g.time = n * 60 } },
    { t: 'slider', label: 'Tensão (0 a 1)', min: 0, max: 1, step: 0.05, get: () => g?.tension.level ?? 0, set: (n) => void ps('tension', n) },
    { t: 'title', label: 'Perigos do mundo' },
    { t: 'buttons', items: HAZARDS.map((id) => ({ label: id, run: () => ps('hazard', id) })) },
    { t: 'title', label: 'Lugares e eventos' },
    {
      t: 'buttons',
      items: [
        { label: 'Abrir caverna', run: () => ps('place', 'cave', caveLevelPick) },
        { label: 'Cemitério', run: () => ps('place', 'graveyard') },
        { label: 'Portal', run: () => ps('portal') },
        { label: 'Baú', run: () => ps('event', 'chest') },
        { label: 'Altar', run: () => ps('event', 'altar') },
      ],
    },
  ],
}

let coinsStep = 1000
let moveId: MoveId = 'ember' as MoveId
let moveLevel = 5
let xpAmount = 200

/** Slider range and step of each stat the menu adds to. */
const STAT_RANGE: Record<TunedStat, readonly [number, number, number]> = {
  maxHp: [-90, 600, 5],
  speed: [-50, 120, 1],
  might: [-0.9, 5, 0.05],
  area: [-0.8, 3, 0.05],
  cooldown: [-0.8, 1, 0.05],
  duration: [-0.8, 3, 0.05],
  amount: [0, 10, 1],
  projectileSpeed: [-0.8, 3, 0.05],
  magnet: [-40, 400, 5],
  regen: [0, 30, 0.5],
  armor: [0, 40, 1],
  growth: [-0.8, 5, 0.1],
  greed: [-0.8, 5, 0.1],
  statusChance: [0, 1, 0.05],
  statusDamage: [0, 3, 0.1],
}

const playerTab: Tab = {
  id: 'player',
  label: 'Jogador',
  controls: (g) => [
    { t: 'info', text: () => (g ? `HP ${Math.round(g.player.hp)}/${Math.round(g.player.stats.maxHp)} · ₽ ${g.coins} · gemas ${g.player.gems} · pos ${Math.round(g.player.x)}, ${Math.round(g.player.y)}` : NEED_RUN) },
    { t: 'toggle', label: 'Invencível', get: () => holds.god, set: (on) => (holds.god = on) },
    {
      t: 'buttons',
      items: [
        { label: 'Curar', run: () => { if (g) g.player.hp = g.player.stats.maxHp } },
        { label: 'Level-up', run: () => ps('offers') },
        { label: 'Evoluir', run: () => ps('evolve') },
      ],
    },
    { t: 'title', label: 'Atributos (soma ao que os itens dão)' },
    ...TUNED_STATS.map((k): Ctl => {
      const r = STAT_RANGE[k]
      return { t: 'slider', label: k, min: r[0], max: r[1], step: r[2], get: () => DEBUG_STATS[k] ?? 0, set: (n) => { DEBUG_STATS[k] = n; if (g) recomputeStats(g) } }
    }),
    { t: 'title', label: 'Golpes e experiência' },
    { t: 'select', label: 'Golpe', options: (Object.keys(MOVES) as MoveId[]).sort(), get: () => moveId, set: (v) => (moveId = v as MoveId) },
    { t: 'slider', label: 'Nível do golpe', min: 1, max: 9, step: 1, get: () => moveLevel, set: (n) => (moveLevel = n) },
    { t: 'slider', label: 'XP a dar', min: 10, max: 5000, step: 10, get: () => xpAmount, set: (n) => (xpAmount = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Aprender golpe', run: () => { const out = ps('learn', moveId, moveLevel); return out ?? `${moveId} Nv ${moveLevel}` } },
        { label: '+ XP', run: () => { if (g) gainXp(g, xpAmount) } },
      ],
    },
    { t: 'title', label: 'Dinheiro' },
    { t: 'slider', label: 'Quantidade de ₽ / gemas', min: 100, max: 100000, step: 100, get: () => coinsStep, set: (n) => (coinsStep = n) },
    {
      t: 'buttons',
      items: [
        { label: '+ ₽', run: () => { if (g) g.coins += coinsStep } },
        { label: '+ gemas', run: () => { if (g) g.player.gems += Math.max(1, Math.round(coinsStep / 100)) } },
        { label: 'Bolas', run: () => ps('ball', 3) },
      ],
    },
  ],
}

const gameTab: Tab = {
  id: 'game',
  label: 'Jogo',
  controls: (g) => [
    { t: 'info', text: () => (g ? `seed ${g.terrain.seed} · tick ${Math.round(g.now * 60)} · escala ${DEBUG_RUN.scale}x` : NEED_RUN) },
    { t: 'title', label: 'Tempo' },
    { t: 'slider', label: 'Velocidade da simulação (0 = pausada)', min: 0, max: 3, step: 0.05, get: () => DEBUG_RUN.scale, set: (n) => (DEBUG_RUN.scale = n) },
    { t: 'slider', label: 'Ticks a avançar', min: 1, max: 600, step: 1, get: () => stepCount, set: (n) => (stepCount = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Pausar', run: () => { DEBUG_RUN.scale = 0 } },
        { label: 'Avançar', run: () => { DEBUG_RUN.steps = stepCount } },
        { label: 'Normal', run: () => { DEBUG_RUN.scale = 1 } },
      ],
    },
    { t: 'toggle', label: 'Congelar com hitstop (continua desenhando)', get: () => holds.freeze, set: (on) => { holds.freeze = on; if (g && !on) g.hitstop = 0 } },
    { t: 'title', label: 'Estado da run' },
    {
      t: 'buttons',
      items: [
        { label: 'Salvar snapshot', run: () => ps('snap') },
        { label: 'Voltar ao snapshot', run: () => ps('restore') },
        {
          label: 'Copiar replay',
          run: () => {
            const text = (window as unknown as { ps?: Record<string, PsCall> }).ps?.replayJson?.()
            if (typeof text !== 'string') return 'Sem run.'
            copyText(text)
            return `Replay copiado (${(text.length / 1024).toFixed(0)} KB).`
          },
        },
      ],
    },
    { t: 'title', label: 'Desenho' },
    { t: 'select', label: 'Qualidade de desenho', options: ['auto', 'full', 'lean'], get: () => 'auto', set: (v) => void ps('quality', v) },
    {
      t: 'buttons',
      items: [
        { label: 'Zerar knobs', run: () => { resetTune(); Object.assign(lit, LIT_DEFAULTS); retune(); Object.assign(DEBUG_VIEW, { hitboxes: false, rooms: false, levels: false, maze: false, counters: false }); MAZE_DEBUG.theme = ''; holds.god = holds.freeze = holds.wind = false; if (g) recomputeStats(g) } },
        { label: 'Copiar estado', run: () => { const text = JSON.stringify({ tune: DEBUG_TUNE, stats: DEBUG_STATS, lit, view: DEBUG_VIEW, cave: caveLevelPick }, null, 2); console.log(text); copyText(text); return 'Copiado (e no console).' } },
      ],
    },
  ],
}

let stepCount = 60

const viewTab: Tab = {
  id: 'view',
  label: 'Visão',
  controls: () => [
    { t: 'info', text: () => 'Camadas desenhadas sobre o mundo (só em dev).' },
    { t: 'toggle', label: 'Hitboxes (inimigos, jogador, golpes, perigos)', get: () => DEBUG_VIEW.hitboxes, set: (on) => (DEBUG_VIEW.hitboxes = on) },
    { t: 'toggle', label: 'Salas e corredores da caverna', get: () => DEBUG_VIEW.rooms, set: (on) => (DEBUG_VIEW.rooms = on) },
    { t: 'toggle', label: 'Nível de luz de cada sala', get: () => DEBUG_VIEW.levels, set: (on) => (DEBUG_VIEW.levels = on) },
    { t: 'toggle', label: 'Células do labirinto (passos a partir de você)', get: () => DEBUG_VIEW.maze, set: (on) => (DEBUG_VIEW.maze = on) },
    { t: 'toggle', label: 'Contadores da run', get: () => DEBUG_VIEW.counters, set: (on) => (DEBUG_VIEW.counters = on) },
  ],
}

const dataTab: Tab = { id: 'data', label: 'Dados', controls: () => [{ t: 'custom', render: (into, say) => renderData(into, say) }] }

const TABS: readonly Tab[] = [lightTab, caveTab, spawnTab, mazeTab, worldTab, playerTab, viewTab, gameTab, dataTab]

/* ---------------- The panel ---------------- */

let panel: HTMLElement | null = null
let tick: number | undefined
let current = 'cave'

const STYLE =
  '#debug-menu .dm-tabs{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}#debug-menu .dm-tabs button{flex:1;padding:3px 4px;cursor:pointer;background:#223;color:#fff;border:1px solid #446}#debug-menu .dm-tabs button.on{background:#58a8d8;color:#001}#debug-menu .dm-row{display:grid;grid-template-columns:1fr auto;gap:0 6px;margin:3px 0}#debug-menu .dm-row input[type=range]{grid-column:1/3;width:100%}#debug-menu .dm-line{display:flex;justify-content:space-between;gap:6px;margin:3px 0}#debug-menu .dm-line select{max-width:150px}#debug-menu .dm-btns{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}#debug-menu .dm-btns button{flex:1;padding:3px 6px;cursor:pointer}#debug-menu .dm-group{margin:6px 0;border-top:1px solid #335}#debug-menu .dm-title{margin:4px 0;font-weight:bold;color:#9cf;cursor:pointer;list-style:none}#debug-menu .dm-title::before{content:"▾ "}#debug-menu details:not([open])>.dm-title::before{content:"▸ "}#debug-menu .dm-info{margin:4px 0;color:#9fd;white-space:pre-wrap}#debug-menu .dm-status{margin-top:6px;color:#fd9}'

/** Which groups are folded, by tab and title: kept while the menu lives, so a tab comes back as it was left. */
const folded = new Set<string>()

/** Redraws a tab's controls into `body`; each title opens a collapsible group holding the controls up to the next title. `say` shows a line at the bottom. */
const draw = (body: HTMLElement, tab: Tab, g: Game | undefined, say: (text: string) => void) => {
  body.replaceChildren()
  let into: HTMLElement = body
  for (const c of tab.controls(g)) {
    switch (c.t) {
      case 'title': {
        const key = `${tab.id}:${c.label}`
        const box = h('details', { class: 'dm-group' }, h('summary', { class: 'dm-title' }, c.label)) as HTMLDetailsElement
        box.open = !folded.has(key)
        box.addEventListener('toggle', () => (box.open ? folded.delete(key) : folded.add(key)))
        body.append(box)
        into = box
        break
      }
      case 'info': {
        const el = h('div', { class: 'dm-info' }, c.text())
        infos.push(() => (el.textContent = c.text()))
        into.append(el)
        break
      }
      case 'slider': {
        const value = h('span', {}, String(Number(c.get().toFixed(3))))
        const input = h('input', { type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(c.get()) }) as HTMLInputElement
        input.addEventListener('input', () => {
          c.set(Number(input.value))
          value.textContent = input.value
        })
        into.append(h('label', { class: 'dm-row' }, h('span', {}, c.label), value, input))
        break
      }
      case 'toggle': {
        const input = h('input', { type: 'checkbox' }) as HTMLInputElement
        input.checked = c.get()
        input.addEventListener('change', () => c.set(input.checked))
        into.append(h('label', { class: 'dm-line' }, h('span', {}, c.label), input))
        break
      }
      case 'select': {
        const input = h('select', {}, ...c.options.map((o) => h('option', { value: o }, o))) as HTMLSelectElement
        input.value = c.get()
        input.addEventListener('change', () => c.set(input.value))
        into.append(h('label', { class: 'dm-line' }, h('span', {}, c.label), input))
        break
      }
      case 'number': {
        const input = h('input', { type: 'number', value: String(c.get()), style: 'width:110px' }) as HTMLInputElement
        input.addEventListener('input', () => Number.isFinite(Number(input.value)) && c.set(Number(input.value)))
        into.append(h('label', { class: 'dm-line' }, h('span', {}, c.label), input))
        break
      }
      case 'custom':
        c.render(into, say)
        break
      case 'buttons':
        into.append(
          h(
            'div',
            { class: 'dm-btns' },
            ...c.items.map((item) => {
              const b = h('button', { type: 'button' }, item.label)
              b.addEventListener('click', () => {
                say(item.run() ?? 'Feito.')
                infos.forEach((f) => f())
              })
              return b
            }),
          ),
        )
        break
    }
  }
}

let infos: Array<() => void> = []

/** Opens or closes the debug menu over the game. */
export const toggleDebugMenu = (game: () => Game | undefined) => {
  if (panel) {
    panel.remove()
    panel = null
    window.clearInterval(tick)
    return
  }
  const status = h('div', { class: 'dm-status' })
  const body = h('div', {})
  const tabs = h('div', { class: 'dm-tabs' })
  const show = (id: string) => {
    current = id
    infos = []
    for (const b of tabs.children) b.classList.toggle('on', (b as HTMLElement).dataset.id === id)
    draw(body, TABS.find((t) => t.id === id) ?? TABS[0]!, game(), (text) => (status.textContent = text))
  }
  for (const t of TABS) {
    const b = h('button', { type: 'button', 'data-id': t.id }, t.label)
    b.addEventListener('click', () => show(t.id))
    tabs.append(b)
  }
  panel = h(
    'div',
    {
      id: 'debug-menu',
      style: 'position:fixed;left:8px;top:8px;z-index:99999;width:340px;max-height:96vh;overflow:auto;padding:8px;background:rgba(10,10,20,.9);color:#fff;font:12px monospace;border:1px solid #58a8d8;border-radius:6px',
    },
    h('div', { style: 'font-weight:bold;margin-bottom:6px' }, 'Debug (F4 fecha)'),
    tabs,
    body,
    status,
    h('style', {}, STYLE),
  )
  document.body.append(panel)
  show(current)
  // Live readouts, and whatever is held on (god mode, a frozen simulation, the cave's wind).
  tick = window.setInterval(() => infos.forEach((f) => f()), 300)
}

/** Keeps the held knobs up; the shell calls it every frame while a dev build runs. */
export const keepDebugHolds = (g: Game | undefined) => {
  if (!g) return
  if (holds.god) g.player.hp = g.player.stats.maxHp
  if (holds.freeze) g.hitstop = 9999
  const inside = g.place.inside
  if (holds.wind && inside?.id === 'cave') inside.left = Math.max(inside.left, holds.windAt)
}

import { BIOMES, WEATHER_IDS, type BiomeId, type WeatherId } from '../data/biomes'
import { CAVE_LEVEL_COUNT, caveLevel } from '../data/caveLevels'
import { ENEMIES, type EnemyId } from '../data/enemies'
import { EVENTS } from '../data/waves'
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
  if (!fn) return `ps.${name} does not exist`
  const out = fn(...args)
  return typeof out === 'string' ? out : undefined
}

/** Things kept up while on: god mode and a frozen simulation, redone on a timer. */
const holds = { god: false, freeze: false, wind: false, windAt: 0, tension: -1 }

const NEED_RUN = 'Start a run first.'
const NEED_CAVE = 'Enter the cave first.'

/* ---------------- Tabs ---------------- */

type LightControl = { key: keyof Lit; label: string; min: number; max: number; step: number }

/** The cave's light numbers by what they act on: each group is a collapsible section of the tab. */
const LIGHT: ReadonlyArray<{ group: string; controls: readonly LightControl[]; extra?: () => Ctl[] }> = [
  {
    group: 'Darkness',
    controls: [
      { key: 'black', label: 'Darkness (black alpha)', min: 0.5, max: 1, step: 0.005 },
      { key: 'fade', label: 'Level transition speed (1/s)', min: 0.5, max: 12, step: 0.5 },
    ],
  },
  {
    group: 'Player light',
    controls: [{ key: 'playerScale', label: 'Player light (scale)', min: 0.2, max: 2, step: 0.05 }],
  },
  {
    group: 'Rooms',
    controls: [
      { key: 'floor', label: 'L0: floor level of a visited room', min: 0, max: 0.6, step: 0.01 },
      { key: 'max', label: 'Room light ceiling (L max)', min: 0.1, max: 1, step: 0.05 },
      { key: 'e0', label: 'E0: energy for 63% (average room)', min: 0.1, max: 3, step: 0.05 },
      { key: 'gamma', label: 'γ: dilution by room size', min: 0, max: 1.5, step: 0.05 },
      { key: 'aref', label: 'Reference area (px²)', min: 4000, max: 30000, step: 500 },
    ],
  },
  {
    group: 'Crystal: lit (shining)',
    controls: [
      { key: 'allOn', label: 'All crystals shining (0/1, lab)', min: 0, max: 1, step: 1 },
      { key: 'auraGain', label: 'Light strength', min: 0, max: 1, step: 0.05 },
      { key: 'aura', label: 'Light radius (px)', min: 10, max: 120, step: 2 },
      { key: 'auraFoot', label: 'Foot radius (px): stairs/chest glow near a shining crystal', min: 0, max: 80, step: 2 },
      { key: 'auraEase', label: 'Ease-in time (s)', min: 0, max: 3, step: 0.05 },
      { key: 'auraWaver', label: 'Radius waver (px)', min: 0, max: 8, step: 0.25 },
      { key: 'auraBlink', label: 'Light kept while blinking out', min: 0, max: 1, step: 0.05 },
    ],
    extra: () => [{ t: 'slider', label: 'Shine time (x 25 s)', min: 0.1, max: 8, step: 0.1, get: () => DEBUG_TUNE.crystal, set: (n) => (DEBUG_TUNE.crystal = n) }],
  },
  {
    group: 'Crystal: unlit (glint)',
    controls: [
      { key: 'glint', label: 'Glint on (0/1)', min: 0, max: 1, step: 1 },
      { key: 'glintGain', label: 'Glint strength', min: 0, max: 1, step: 0.05 },
      { key: 'glintR', label: 'Glint radius (px)', min: 2, max: 40, step: 1 },
      { key: 'glintNear', label: 'Distance of full glint (px)', min: 0, max: 300, step: 5 },
      { key: 'glintFade', label: 'Fade-out distance (px)', min: 5, max: 300, step: 5 },
    ],
  },
  {
    group: 'Doors and corridors',
    controls: [
      { key: 'door', label: 'Door crystal weight', min: 0, max: 1, step: 0.05 },
      { key: 'reach', label: 'Door crystal reach (px)', min: 20, max: 240, step: 4 },
      { key: 'spill', label: 'Light spilling out of a door (px)', min: 0, max: 160, step: 4 },
    ],
  },
  {
    group: 'Walls',
    controls: [{ key: 'rim', label: 'Light on the rock edge (px)', min: 0, max: 24, step: 1 }],
  },
]

const lab: Lab = { size: 4, inside: 1, doors: 0, vertical: 0 }

const lightTab: Tab = {
  id: 'light',
  label: 'Light',
  controls: (g) => [
    { t: 'info', text: () => `L of an average room with 1 crystal: ${roomLevel(1, lit.aref).toFixed(2)} · with 0: ${roomLevel(0, lit.aref).toFixed(2)}` },
    ...LIGHT.flatMap((grp): Ctl[] => [
      { t: 'title', label: grp.group },
      ...grp.controls.map((c): Ctl => ({ t: 'slider', label: c.label, min: c.min, max: c.max, step: c.step, get: () => lit[c.key], set: (n) => { lit[c.key] = n; retune() } })),
      ...(grp.extra?.() ?? []),
    ]),
    { t: 'title', label: 'Lab room' },
    { t: 'slider', label: 'Size (x average room)', min: 0.5, max: 12, step: 0.5, get: () => lab.size, set: (n) => (lab.size = n) },
    { t: 'slider', label: 'Crystals inside', min: 0, max: 12, step: 1, get: () => lab.inside, set: (n) => (lab.inside = n) },
    { t: 'slider', label: 'Crystals at the door', min: 0, max: 6, step: 1, get: () => lab.doors, set: (n) => (lab.doors = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Apply room', run: () => (g && applyLab(g, { ...lab, size: lab.size || 1 }) ? 'Room applied (the lab’s B2F).' : NEED_CAVE) },
        { label: 'Restore', run: () => { Object.assign(lit, LIT_DEFAULTS); retune(); return 'Light restored.' } },
        { label: 'Copy', run: () => { const text = JSON.stringify(lit, null, 2); console.log(text); copyText(text); return 'Values copied (and in the console).' } },
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
  label: 'Cave',
  controls: (g) => {
    const goto = (label: string, at: (g: Game, inside: NonNullable<ReturnType<typeof caveOf>>) => readonly [number, number] | null): { label: string; run: () => string | void } => ({
      label,
      run: () => {
        const inside = caveOf(g)
        if (!g || !inside) return NEED_CAVE
        const to = at(g, inside)
        if (!to) return 'None of that on this floor.'
        placeTeam(g, inside.x + to[0], inside.y + to[1])
      },
    })
    return [
      {
        t: 'info',
        text: () => {
          const inside = caveOf(g)
          if (!g || !inside) return 'Not in the cave.'
          const s = inside.state
          const lv = caveLevel(s.level)
          return `Lv ${s.level} · floor ${s.floor + 1}/${lv.floors}${s.plan ? '' : ' (chamber)'} · wind ${inside.left.toFixed(0)}s · rooms ${s.plan?.rooms.length ?? 0} (seen ${s.visited.length}) · ambushes ${s.sprung.length}/${s.ambush.length} · traps ${s.traps.filter((t) => !t.done).length}/${s.traps.length} · foes ${g.enemies.length}`
        },
      },
      { t: 'title', label: 'Enter' },
      { t: 'slider', label: 'Cave level', min: 1, max: CAVE_LEVEL_COUNT, step: 1, get: () => caveLevelPick, set: (n) => (caveLevelPick = n) },
      {
        t: 'buttons',
        items: [
          {
            label: 'Enter at this level',
            run: () => {
              if (!g) return NEED_RUN
              if (g.place.inside) return 'Leave first (the button beside it).'
              enterPlace(g, 'cave', Math.round(g.player.x), Math.round(g.player.y), caveLevelPick)
            },
          },
          { label: 'Leave', run: () => (g?.place.inside ? void exitPlace(g, 'done') : 'Not in a place.') },
          { label: 'Go down a floor', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; if (inside.state.floor >= caveLevel(inside.state.level).floors) return 'Already the chest chamber.'; descendCave(g, inside) } },
        ],
      },
      { t: 'title', label: 'Go to' },
      {
        t: 'buttons',
        items: [
          goto('Stairs', (_, i) => i.state.stairs),
          goto('Chest', (_, i) => (i.state.chest ? [i.state.chest.x, i.state.chest.y + 30] : null)),
          goto('Cristalário', (_, i) => (i.state.shop ? [i.state.shop.x, i.state.shop.y + 24] : null)),
          goto('Ambush', (_, i) => { const r = i.state.ambush.find((a) => !i.state.sprung.includes(a)); const room = r === undefined ? null : i.state.plan?.rooms[r]; return room ? [room.x + 8, room.y + room.h / 2] : null }),
          goto('Trap', (_, i) => { const t = i.state.traps.find((x) => !x.done); return t ? [t.x - 30, t.y] : null }),
        ],
      },
      { t: 'title', label: 'Floor state' },
      { t: 'slider', label: 'Wind: seconds left', min: 0, max: 150, step: 1, get: () => caveOf(g)?.left ?? 0, set: (n) => { const inside = caveOf(g); if (inside) inside.left = n } },
      { t: 'toggle', label: 'Hold the wind (clock stopped)', get: () => holds.wind, set: (on) => { holds.wind = on; holds.windAt = caveOf(g)?.left ?? 0 } },
      {
        t: 'buttons',
        items: [
          { label: 'Reveal floor', run: () => { const inside = caveOf(g); if (!g || !inside?.state.plan) return NEED_CAVE; inside.state.visited = inside.state.plan.rooms.map((_, i) => i) } },
          { label: 'Light all crystals', run: () => { const inside = caveOf(g); if (!inside) return NEED_CAVE; inside.state.touched = inside.state.lights.map((_, i) => ({ i, left: 999, age: 99 })) } },
          { label: 'Put out crystals', run: () => { const inside = caveOf(g); if (!inside) return NEED_CAVE; inside.state.touched = [] } },
        ],
      },
      { t: 'title', label: 'Generation' },
      { t: 'number', label: 'Draw seed (the run’s rng)', get: () => caveSeed, set: (n) => (caveSeed = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Regenerate floor', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; relayCave(g, inside) } },
          { label: 'Apply seed and regenerate', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; g.rng = createRng(caveSeed); relayCave(g, inside); return `seed ${caveSeed}` } },
        ],
      },
      { t: 'title', label: 'Hazards' },
      {
        t: 'buttons',
        items: [
          {
            label: 'Ambush in this room',
            run: () => {
              const inside = caveOf(g)
              const plan = inside?.state.plan
              if (!g || !inside || !plan) return NEED_CAVE
              const room = roomAt(plan, g.player.x - inside.x, g.player.y - inside.y)
              if (room < 0) return 'Stand inside a room.'
              springAmbush(g, inside, plan.rooms[room]!, plan.sizes[room]!, g.player)
            },
          },
          { label: 'Monster House', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; springHouse(g, inside) } },
          { label: 'Spring a trap', run: () => { const inside = caveOf(g); if (!g || !inside) return NEED_CAVE; for (const t of inside.state.traps) if (!t.done) { t.done = true; g.player.x = inside.x + t.x; g.player.y = inside.y + t.y; break } } },
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
    { t: 'info', text: () => (g ? `foes ${g.enemies.length} (maze ${g.enemies.filter((e) => e.home !== undefined).length}) · budget ${g.spawnBudget.toFixed(2)} · tension ${g.tension.level.toFixed(2)}` : NEED_RUN) },
    { t: 'title', label: 'Rates and caps (1 = normal, 0 = stopped)' },
    { t: 'slider', label: 'Overworld horde: rate (overworld only)', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.world, set: (n) => (DEBUG_TUNE.world = n) },
    { t: 'slider', label: 'Overworld horde: cap (overworld only)', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.cap, set: (n) => (DEBUG_TUNE.cap = n) },
    { t: 'slider', label: 'Places (cave): rate (inside a place only)', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.place, set: (n) => (DEBUG_TUNE.place = n) },
    { t: 'slider', label: 'Places (cave): cap (inside a place only)', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.placeCap, set: (n) => (DEBUG_TUNE.placeCap = n) },
    { t: 'slider', label: 'Maze: rate and cap (inside a maze only)', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.maze, set: (n) => (DEBUG_TUNE.maze = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Stop all', run: () => { DEBUG_TUNE.world = DEBUG_TUNE.place = DEBUG_TUNE.maze = 0 } },
        { label: 'Normal', run: () => resetTune() },
      ],
    },
    { t: 'title', label: 'Summon' },
    { t: 'select', label: 'Pokémon', options: (Object.keys(ENEMIES) as EnemyId[]).sort(), get: () => spawnKind, set: (v) => (spawnKind = v as EnemyId) },
    { t: 'slider', label: 'How many', min: 1, max: 60, step: 1, get: () => spawnCount, set: (n) => (spawnCount = n) },
    { t: 'toggle', label: 'Shiny', get: () => spawnShiny, set: (on) => (spawnShiny = on) },
    {
      t: 'buttons',
      items: [
        { label: 'Spawn', run: () => ps('spawn', spawnKind, spawnCount, spawnShiny) },
        { label: 'Alpha', run: () => ps('alpha', spawnKind) },
        { label: 'Boss', run: () => ps('boss', spawnKind) },
      ],
    },
    { t: 'title', label: 'Clear' },
    {
      t: 'buttons',
      items: [
        { label: 'Knock out all', run: () => { if (!g) return NEED_RUN; for (const e of [...g.enemies]) if (e.dying < 0) killEnemy(g, e) } },
        { label: 'Remove all', run: () => { if (!g) return NEED_RUN; g.enemies.length = 0 } },
      ],
    },
  ],
}

const mazeTab: Tab = {
  id: 'maze',
  label: 'Maze',
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
          if (!g || !here) return 'Not in a maze.'
          const r = here.run
          const theme = mazeTheme(g.biome.id, here.site.seed).id
          const live = g.enemies.filter((e) => e.home === here.site.key && e.dying < 0).length
          return `theme ${theme} · wings ${here.site.wings.map((w) => w.kind).join('/')} · dwellers ${live} · keys ${r ? r.keys.filter((k) => !k.taken).length : '?'}/${r?.keys.length ?? '?'} · chests ${r ? r.caches.filter((c) => !c.open).length : '?'} · traps ${r ? r.traps.filter((t) => !t.done).length : '?'}`
        },
      },
      {
        t: 'buttons',
        items: [
          { label: 'Go to the entrance', run: () => (g ? (goToMaze(g, false) ? undefined : 'No maze found.') : NEED_RUN) },
          { label: 'Enter', run: () => (g ? (goToMaze(g, true) ? undefined : 'No maze found.') : NEED_RUN) },
        ],
      },
      { t: 'title', label: 'Contents' },
      {
        t: 'buttons',
        items: [
          { label: 'Go to the heart', run: () => { const r = run()?.run; if (!g || !r) return 'Enter a maze first.'; placeTeam(g, r.heart.x, r.heart.y + 26) } },
          { label: 'Take all keys', run: () => { const r = run()?.run; if (!r) return 'Enter a maze first.'; for (const k of r.keys) k.taken = true } },
          { label: 'Go to a chest', run: () => { const r = run()?.run; const c = r?.caches.find((x) => !x.open); if (!g || !c) return 'No closed chest.'; placeTeam(g, c.x, c.y + 26) } },
          { label: 'Go to a trap', run: () => { const r = run()?.run; const t = r?.traps.find((x) => !x.done); if (!g || !t) return 'No trap.'; placeTeam(g, t.x, t.y + 40) } },
        ],
      },
      { t: 'title', label: 'Theme and generation' },
      { t: 'select', label: 'Forced theme', options: ['', ...[...new Set(Object.values(MAZE_CAST).flatMap((k) => k.themes.map((t) => t.id)))]], get: () => MAZE_DEBUG.theme, set: (v) => (MAZE_DEBUG.theme = v) },
      { t: 'number', label: 'World seed (changes the terrain)', get: () => worldSeed, set: (n) => (worldSeed = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Rebuild contents', run: () => { const here = run(); if (!g || !here) return 'Enter a maze first.'; g.mazes.delete(here.site.key); for (const e of [...g.enemies]) if (e.home === here.site.key) e.dying < 0 && killEnemy(g, e) } },
          { label: 'New world, go to a maze', run: () => { if (!g) return NEED_RUN; g.terrain.seed = worldSeed; g.mazes.clear(); g.enemies.length = 0; return goToMaze(g, false) ? `seed ${worldSeed}` : 'No maze found.' } },
        ],
      },
      { t: 'title', label: 'Dwellers' },
      { t: 'slider', label: 'Dwellers: rate and cap', min: 0, max: 6, step: 0.1, get: () => DEBUG_TUNE.maze, set: (n) => (DEBUG_TUNE.maze = n) },
      {
        t: 'buttons',
        items: [
          { label: 'Spawn now', run: () => { const r = run()?.run; if (!r) return 'Enter a maze first.'; r.spawnIn = 0 } },
          { label: 'Knock out dwellers', run: () => { const here = run(); if (!g || !here) return 'Enter a maze first.'; for (const e of [...g.enemies]) if (e.home === here.site.key && e.dying < 0) killEnemy(g, e) } },
        ],
      },
      { t: 'info', text: () => `Base ${MAZE_RUN.live.base}, +1 every ${MAZE_RUN.live.perMinutes} min, max ${MAZE_RUN.live.max}, a new one every ${MAZE_RUN.live.every}s.` },
    ]
  },
}

const HAZARDS = ['volley', 'line', 'zone'] as const

const worldTab: Tab = {
  id: 'world',
  label: 'World',
  controls: (g) => [
    { t: 'info', text: () => (g ? `${g.biome.id} · ${g.weather.id} · ${(g.time / 60).toFixed(1)} min · difficulty ${g.difficulty}` : NEED_RUN) },
    { t: 'select', label: 'Biome', options: Object.keys(BIOMES), get: () => g?.biome.id ?? 'meadow', set: (v) => g && setBiome(g, v as BiomeId) },
    { t: 'select', label: 'Weather', options: WEATHER_IDS, get: () => g?.weather.id ?? 'clear', set: (v) => g && setWeather(g, v as WeatherId) },
    { t: 'slider', label: 'Run clock (min); skips the wave events behind it', min: 0, max: 30, step: 0.5, get: () => (g ? g.time / 60 : 0), set: (n) => { if (!g) return; g.time = n * 60; const next = EVENTS.findIndex((e) => e.at > g.time); g.nextEvent = next < 0 ? EVENTS.length : next } },
    { t: 'slider', label: 'Tension (0 to 1), held while on', min: 0, max: 1, step: 0.05, get: () => (holds.tension >= 0 ? holds.tension : (g?.tension.level ?? 0)), set: (n) => { holds.tension = n; void ps('tension', n) } },
    { t: 'toggle', label: 'Hold tension (the director would pull it back, and caps it before minute 10)', get: () => holds.tension >= 0, set: (on) => { holds.tension = on ? (g?.tension.level ?? 0) : -1 } },
    { t: 'title', label: 'World hazards' },
    { t: 'buttons', items: HAZARDS.map((id) => ({ label: id, run: () => ps('hazard', id) })) },
    { t: 'title', label: 'Places and events' },
    {
      t: 'buttons',
      items: [
        { label: 'Open cave', run: () => ps('place', 'cave', caveLevelPick) },
        { label: 'Graveyard', run: () => ps('place', 'graveyard') },
        { label: 'Portal', run: () => ps('portal') },
        { label: 'Chest', run: () => ps('event', 'chest') },
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
  label: 'Player',
  controls: (g) => [
    { t: 'info', text: () => (g ? `HP ${Math.round(g.player.hp)}/${Math.round(g.player.stats.maxHp)} · ₽ ${g.coins} · gems ${g.player.gems} · pos ${Math.round(g.player.x)}, ${Math.round(g.player.y)}` : NEED_RUN) },
    { t: 'toggle', label: 'Invincible', get: () => holds.god, set: (on) => (holds.god = on) },
    {
      t: 'buttons',
      items: [
        { label: 'Heal', run: () => { if (g) g.player.hp = g.player.stats.maxHp } },
        { label: 'Level-up', run: () => ps('offers') },
        { label: 'Evolve', run: () => ps('evolve') },
      ],
    },
    { t: 'title', label: 'Stats (added on top of what items give)' },
    ...TUNED_STATS.map((k): Ctl => {
      const r = STAT_RANGE[k]
      return { t: 'slider', label: k, min: r[0], max: r[1], step: r[2], get: () => DEBUG_STATS[k] ?? 0, set: (n) => { DEBUG_STATS[k] = n; if (g) recomputeStats(g) } }
    }),
    { t: 'title', label: 'Moves and experience' },
    { t: 'select', label: 'Move', options: (Object.keys(MOVES) as MoveId[]).sort(), get: () => moveId, set: (v) => (moveId = v as MoveId) },
    { t: 'slider', label: 'Move level', min: 1, max: 9, step: 1, get: () => moveLevel, set: (n) => (moveLevel = n) },
    { t: 'slider', label: 'XP to give', min: 10, max: 5000, step: 10, get: () => xpAmount, set: (n) => (xpAmount = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Learn move', run: () => { const out = ps('learn', moveId, moveLevel); return out ?? `${moveId} Nv ${moveLevel}` } },
        { label: '+ XP', run: () => { if (g) gainXp(g, xpAmount) } },
      ],
    },
    { t: 'title', label: 'Money' },
    { t: 'slider', label: 'Amount of ₽ / gems', min: 100, max: 100000, step: 100, get: () => coinsStep, set: (n) => (coinsStep = n) },
    {
      t: 'buttons',
      items: [
        { label: '+ ₽', run: () => { if (g) g.coins += coinsStep } },
        { label: '+ gems', run: () => { if (g) g.player.gems += Math.max(1, Math.round(coinsStep / 100)) } },
        { label: 'Poké Balls', run: () => ps('ball', 3) },
      ],
    },
  ],
}

const gameTab: Tab = {
  id: 'game',
  label: 'Game',
  controls: (g) => [
    { t: 'info', text: () => (g ? `seed ${g.terrain.seed} · tick ${Math.round(g.now * 60)} · speed ${DEBUG_RUN.scale}x` : NEED_RUN) },
    { t: 'title', label: 'Time' },
    { t: 'slider', label: 'Simulation speed (0 = paused)', min: 0, max: 3, step: 0.05, get: () => DEBUG_RUN.scale, set: (n) => (DEBUG_RUN.scale = n) },
    { t: 'slider', label: 'Ticks to step', min: 1, max: 600, step: 1, get: () => stepCount, set: (n) => (stepCount = n) },
    {
      t: 'buttons',
      items: [
        { label: 'Pause', run: () => { DEBUG_RUN.scale = 0 } },
        { label: 'Step', run: () => { DEBUG_RUN.steps = stepCount } },
        { label: 'Normal', run: () => { DEBUG_RUN.scale = 1 } },
      ],
    },
    { t: 'toggle', label: 'Freeze with hitstop (keeps drawing)', get: () => holds.freeze, set: (on) => { holds.freeze = on; if (g && !on) g.hitstop = 0 } },
    { t: 'title', label: 'Run state' },
    {
      t: 'buttons',
      items: [
        { label: 'Save snapshot', run: () => ps('snap') },
        { label: 'Back to snapshot', run: () => ps('restore') },
        {
          label: 'Copy replay',
          run: () => {
            const text = (window as unknown as { ps?: Record<string, PsCall> }).ps?.replayJson?.()
            if (typeof text !== 'string') return 'No run.'
            copyText(text)
            return `Replay copied (${(text.length / 1024).toFixed(0)} KB).`
          },
        },
      ],
    },
    { t: 'title', label: 'Drawing' },
    { t: 'select', label: 'Draw quality', options: ['auto', 'full', 'lean'], get: () => 'auto', set: (v) => void ps('quality', v) },
    {
      t: 'buttons',
      items: [
        { label: 'Reset knobs', run: () => { resetTune(); Object.assign(lit, LIT_DEFAULTS); retune(); Object.assign(DEBUG_VIEW, { hitboxes: false, rooms: false, levels: false, maze: false, counters: false }); MAZE_DEBUG.theme = ''; holds.god = holds.freeze = holds.wind = false; holds.tension = -1; if (g) recomputeStats(g) } },
        { label: 'Copy state', run: () => { const text = JSON.stringify({ tune: DEBUG_TUNE, stats: DEBUG_STATS, lit, view: DEBUG_VIEW, cave: caveLevelPick }, null, 2); console.log(text); copyText(text); return 'Copied (and in the console).' } },
      ],
    },
  ],
}

let stepCount = 60

const viewTab: Tab = {
  id: 'view',
  label: 'View',
  controls: () => [
    { t: 'info', text: () => 'Layers drawn over the world (dev only).' },
    { t: 'toggle', label: 'Hitboxes (foes, player, moves, hazards)', get: () => DEBUG_VIEW.hitboxes, set: (on) => (DEBUG_VIEW.hitboxes = on) },
    { t: 'toggle', label: 'Cave rooms and corridors', get: () => DEBUG_VIEW.rooms, set: (on) => (DEBUG_VIEW.rooms = on) },
    { t: 'toggle', label: 'Light level of each room', get: () => DEBUG_VIEW.levels, set: (on) => (DEBUG_VIEW.levels = on) },
    { t: 'toggle', label: 'Maze cells (steps from you)', get: () => DEBUG_VIEW.maze, set: (on) => (DEBUG_VIEW.maze = on) },
    { t: 'toggle', label: 'Run counters', get: () => DEBUG_VIEW.counters, set: (on) => (DEBUG_VIEW.counters = on) },
  ],
}

const dataTab: Tab = { id: 'data', label: 'Data', controls: () => [{ t: 'custom', render: (into, say) => renderData(into, say) }] }

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
                say(item.run() ?? 'Done.')
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
    h('div', { style: 'font-weight:bold;margin-bottom:6px' }, 'Debug (F4 closes)'),
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
  if (holds.tension >= 0) {
    g.tension.level = holds.tension
    g.tension.reach = 1
    g.tension.harm = 0
  }
  const inside = g.place.inside
  if (holds.wind && inside?.id === 'cave') inside.left = Math.max(inside.left, holds.windAt)
}

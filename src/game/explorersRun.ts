import { range } from '../engine/rng'
import { ENEMIES, type EnemyDef } from '../data/enemies'
import { EXPLORER_THEMES } from '../data/explorers'
import { shapeFloor } from './roomShapes'
import { CAVE, PLACE_FEET } from '../data/places'
import { caveLevel } from '../data/caveLevels'
import { CAVE_GEN } from '../data/procgen'
import { COIN_VALUES, type Ranks } from './meta'
import { DROP_TABLES, rollDrop } from '../data/consumables'
import { spawnAlpha } from './alphas'
import { litSources, stateOf, type Floor } from './cave'
import { dropItem } from './consumables'
import { floorShapes, generateFloorV2, roomAt, type DungeonFloor } from './dungeon'
import { shakeScreen } from './effects'
import { spawnEnemy } from './enemies'
import { clockAt, generatorLevel, guardOf, headcount, powerAt, speciesAt, themeOf } from './explorers'
import { createGame, openPendingPicks, stepMoves, stepPlayer, type RunOptions, type StepInput } from './game'

import { updateAttacks } from './attacks'
import { updateBosses, updateHazards } from './bosses'
import { updateConsumables } from './consumables'
import { updateEffects } from './effects'
import { rebuildGrid, updateEnemies } from './enemies'
import { updateCoop } from './coop'
import { dropCoins, dropPickup, updatePickups } from './pickups'
import { notifyPlace, solidAt } from './placeKit'
import { centerScreen, followPlayers, inPlay, placeTeam, playerWithin } from './players'
import { setAside, keepOnFloor } from './room'
import { onFloor } from './arenaFloor'
import { updateStatuses } from './statusSystem'
import { footOf, updateTerrain } from './terrain'
import { trapStrike } from './hazards'
import { updateVerbEvolved } from './verbEvolutions'
import type { PlayableId } from '../data/hatchlings'
import type { Game, Player } from './types'
import type { PlaceInteriorOf } from './place'
import { retain } from '../engine/math'
import * as dm from '../engine/dmath'

/**
 * Explorers' run (`docs/explorers.md`): the stateful side of `explorers.ts`. The run is laid out in a cave's container (`g.place.inside`,
 * `id: 'cave'`) only so the screen, the minimap, the dark and the light draw it as they draw a cave; its *rules* are its own: this file's
 * `stepExplorers` replaces `stepTeam`, and `updateCave`, the wind's throw-out, the dark's spawns, the rescue at the door and the treasure
 * chamber never run. What it shares with the cave are the mechanics: the generated floor, the light sources, the walkers' graph.
 *
 *  - nothing is born during a floor: its foes are placed once, when it is laid out, and only fewer remain;
 *  - the stairs are there from the start: going down is always allowed;
 *  - the floor's clock zeroing ends the run, and so does a fall (in co-op, the last one standing).
 */

type Inside = PlaceInteriorOf<'cave'>

/** What Explorers keeps of a run besides the floor: the depth, the deepest reached and how many foes the floor started with. */
export type ExplorersRun = { depth: number; deepest: number; foes: number }

/** A fresh Explorers run for `starter`, on floor 1 of the first theme, solo (co-op builds the same through its lockstep start). */
export const createExplorersGame = (starter: PlayableId, view: Game['view'], seed: number, ranks?: Ranks, options?: RunOptions): Game => {
  const g = createGame(starter, view, seed, ranks, undefined, options)
  startExplorers(g)
  return g
}

/** Turns a freshly created run into an Explorers run: the world set aside for good, floor 1 laid out around the origin. */
export const startExplorers = (g: Game, depth = 1) => {
  g.explorers = { depth, deepest: depth, foes: 0 }
  const stash = setAside(g)
  const inside: Inside = {
    id: 'cave',
    x: 0,
    y: 0,
    layout: { floor: [] },
    terrain: { solids: [], lake: null },
    age: 0,
    left: clockAt(depth),
    intro: CAVE.card,
    loot: null,
    fall: null,
    stash,
    door: { x: 0, y: 0 },
    spawnBudget: 0,
    state: stateOf({ layout: { floor: [] }, solids: [], start: [0, 0], plan: null, stairs: null, chest: null, lights: [], shop: null }, 0, 1),
  }
  g.place.inside = inside
  layExplorerFloor(g, inside, depth)
}

/** The floor `depth` as the cave's container holds one: the plan, its solids, the stairs (open from the start) and the foes. */
const floorFor = (g: Game, inside: Inside, depth: number): Floor => {
  const theme = EXPLORER_THEMES[themeOf(depth)]
  // Only the dark of the caves has crystals to light it: the field has no dark and the forest's patches of shade need none.
  const lit = theme.dark === 'full'
  const shaped = shapeFloor(generateFloorV2(g.rng, Math.min(depth - 1, CAVE_GEN.grids.length - 1), caveLevel(generatorLevel(depth))), g.rng, theme.shapeShare, theme.shapes)
  const plan = lit ? shaped : { ...shaped, sources: [] }
  plan.items.forEach(([ix, iy], i) => {
    if (i === 0) dropCoins(g, inside.x + ix, inside.y + iy, [COIN_VALUES[1], COIN_VALUES[1], COIN_VALUES[0], COIN_VALUES[0]])
    else dropItem(g, inside.x + ix, inside.y + iy, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
    dropPickup(g, inside.x + ix - 10, inside.y + iy, 'gem')
  })
  return {
    layout: { floor: floorShapes(plan) },
    solids: [
      ...plan.sources.map(([cx, cy], i) => solidAt('crystal', PLACE_FEET.crystal, inside.x + cx, inside.y + cy, i)),
      ...plan.rocks.map(([rx, ry], i) => solidAt('caveRock', PLACE_FEET.caveRock, inside.x + rx, inside.y + ry, i)),
    ],
    start: plan.start,
    plan,
    stairs: plan.stairs,
    chest: null,
    lights: plan.sources,
    shop: null,
  }
}

/** Makes a foe of the floor as strong as its depth says (`powerAt`). */
const strengthen = (e: ReturnType<typeof spawnEnemy>, depth: number) => {
  const power = powerAt(depth)
  e.hp = e.maxHp = dm.round(e.maxHp * power)
  e.damage *= power
}

/** The floor's whole cast, placed once: a few in every room but the start's, the guard on the stairs' side. Nothing comes after. */
const populate = (g: Game, inside: Inside, plan: DungeonFloor, depth: number) => {
  const species = speciesAt(depth)
  let foes = 0
  plan.rooms.forEach((r, i) => {
    if (i === plan.startRoom || plan.ambush.includes(i)) return
    const count = headcount(depth, plan.sizes[i]!)
    for (let n = 0; n < count; n++) {
      const x = inside.x + range(g.rng, r.x + 16, r.x + r.w - 16)
      const y = inside.y + range(g.rng, r.y + 16, r.y + r.h - 16)
      strengthen(spawnEnemy(g, species[Math.floor(g.rng() * species.length)]!, x, y), depth)
      foes++
    }
  })
  const guard = guardOf(depth)
  if (guard) {
    const r = plan.rooms[plan.stairsRoom]!
    const [gx, gy] = [inside.x + r.x + r.w / 2, inside.y + r.y + r.h / 2 - 20]
    // A block's boss fights with its own patterns (`BOSS_PATTERNS`); a sub-boss is an Alpha of its species.
    const def: EnemyDef = ENEMIES[guard]
    const boss = def.boss ? spawnEnemy(g, guard, gx, gy) : spawnAlpha(g, guard, gx, gy)
    strengthen(boss, depth)
    g.bossId = boss.id
    g.events.push({ kind: 'boss', enemy: guard })
    foes++
  }
  return foes
}

/** An ambush room's pack when a player steps in (the floor's Monster House): its species, as many as the room is big, at the room's edge. */
const springPack = (g: Game, inside: Inside, room: number, depth: number, by: Player) => {
  const plan = inside.state.plan!
  const r = plan.rooms[room]!
  const species = speciesAt(depth)
  const count = headcount(depth, plan.sizes[room]!) + 3
  for (let i = 0; i < count; i++) {
    let x = 0
    let y = 0
    for (let t = 0; t < 8; t++) {
      x = inside.x + range(g.rng, r.x + 16, r.x + r.w - 16)
      y = inside.y + range(g.rng, r.y + 16, r.y + r.h - 16)
      if (dm.sq(x - by.x) + dm.sq(y - by.y) > 70 * 70) break
    }
    const e = spawnEnemy(g, species[Math.floor(g.rng() * species.length)]!, x, y)
    e.alert = CAVE.sight.ambush
    strengthen(e, depth)
  }
  shakeScreen(g, 4, { x: inside.x + r.x + r.w / 2, y: inside.y + r.y + r.h / 2 })
  notifyPlace(g, 'cave', { kind: 'monsterHouse' })
}

/** Lays floor `depth` out in the container and puts the team at its start (the loot lying around comes along). Also the dev jump (`ps.explorers(depth)`). */
export const layExplorerFloor = (g: Game, inside: Inside, depth: number) => {
  g.enemies = []
  g.hazards = []
  g.bossId = null
  for (const k of g.pickups) k.attracted = true
  const f = floorFor(g, inside, depth)
  inside.layout = f.layout
  inside.terrain = { solids: f.solids, lake: null }
  inside.left = clockAt(depth)
  inside.state = stateOf(f, depth - 1, generatorLevel(depth))
  placeTeam(g, inside.x + f.start[0], inside.y + f.start[1])
  for (const q of g.players) centerScreen(g, q, q.x, q.y)
  const run = g.explorers!
  run.depth = depth
  run.deepest = Math.max(run.deepest, depth)
  run.foes = populate(g, inside, f.plan!, depth)
  inside.intro = CAVE.card
  notifyPlace(g, 'cave', { kind: 'floor', floor: depth - 1 })
}

/** Ends the run: the clock ran out or the team fell. */
const endRun = (g: Game) => {
  if (g.phase === 'gameover') return
  g.phase = 'gameover'
  g.events.push({ kind: 'gameover', foe: null, hit: 'zone' })
}

/** The floor's rules, once a tick: rooms entered, the pack of a Monster House, lit sources, traps, the stairs, the clock. */
const updateExplorers = (g: Game, inside: Inside, run: ExplorersRun, dt: number) => {
  const s = inside.state
  const plan = s.plan!
  for (const p of g.players) {
    const room = roomAt(plan, p.x - inside.x, p.y - inside.y)
    if (room >= 0 && !s.visited.includes(room)) s.visited.push(room)
    if (room < 0 || !s.ambush.includes(room) || s.sprung.includes(room)) continue
    s.sprung.push(room)
    springPack(g, inside, room, run.depth, p)
  }
  litSources(g, inside, dt)
  for (const t of s.traps) {
    if (t.done || !playerWithin(g, inside.x + t.x, inside.y + t.y, 14)) continue
    t.done = true
    trapStrike(g, inside.x + t.x, inside.y + t.y)
    shakeScreen(g, 2, { x: inside.x + t.x, y: inside.y + t.y })
  }
  const stairs = s.stairs
  if (stairs && g.players.some((p) => inPlay(p) && dm.sq(p.x - inside.x - stairs[0]) + dm.sq(p.y - inside.y - stairs[1]) < dm.sq(CAVE.stairsRadius + p.radius * 0.5))) {
    return layExplorerFloor(g, inside, run.depth + 1)
  }
  inside.left -= dt
  if (inside.left <= 0) endRun(g)
}

const STILL: StepInput = { move: { x: 0, y: 0 }, special: false }

/**
 * One tick of an Explorers run, in place of `stepTeam`'s (solo: `main.ts`; co-op: the lockstep): the players walk and fight, the floor's
 * walkers act, and the floor's rules run (`updateExplorers`). The world's horde, biomes, weather, map events, places and rifts never run.
 */
export const stepExplorers = (g: Game, inputs: readonly StepInput[], dt: number) => {
  const run = g.explorers
  const inside = g.place.inside
  if (!run || inside?.id !== 'cave' || g.phase !== 'playing') return
  // A new floor's title card holds the world for a moment.
  if (inside.intro > 0) {
    inside.intro -= dt
    return
  }
  g.now += dt
  g.time += dt
  inside.age += dt
  const actor = g.player
  for (const p of g.players) {
    if (g.coop !== null && !inPlay(p)) continue
    g.player = p
    stepPlayer(g, inputs[p.slot] ?? STILL, dt)
  }
  g.player = actor
  rebuildGrid(g)
  updateEnemies(g, dt)
  updateBosses(g, dt)
  updateHazards(g, dt)
  updateStatuses(g, dt)
  const floor = inside.layout.floor
  for (const p of g.players) if (p.hp > 0) keepOnFloor(p, inside, floor, [], footOf(p))
  for (const e of g.enemies) if (e.dying < 0) keepOnFloor(e, inside, floor, [], e.radius * 0.8)
  // Shots break where the floor ends.
  retain(g.hazards, (h) => onFloor(floor, h.x - inside.x, h.y - inside.y, 4))
  rebuildGrid(g)
  updateExplorers(g, inside, run, dt)
  for (const p of g.players) {
    if (g.coop !== null && !inPlay(p)) continue
    g.player = p
    stepMoves(g, inputs[p.slot] ?? STILL, dt)
  }
  g.player = actor
  updateAttacks(g, dt)
  updateVerbEvolved(g, dt)
  updateTerrain(g, dt)
  updatePickups(g, dt)
  updateConsumables(g, dt)
  updateEffects(g, dt)
  if (g.coop !== null) updateCoop(g, dt)
  followPlayers(g, dt)
  openPendingPicks(g)
}

import { clamp, retain, TAU } from '../engine/math'
import { range, weightedPick } from '../engine/rng'
import type { Circle, FloorPlan, Pt } from '../data/arenas'
import { DROP_TABLES, rollDrop } from '../data/consumables'
import { CAVE, PLACE_FEET, PLACE_LOOT } from '../data/places'
import { CAVE_SHOP } from '../data/caveShop'
import { CAVE_TRAP, caveLevel } from '../data/caveLevels'
import { CAVE_GEN, PROCGEN } from '../data/procgen'
import { spawnAlpha } from './alphas'
import { levelOf, levelsOf } from './caveLevel'
import { drawNpc, openShop, type CaveShop } from './caveShop'
import { dropItem } from './consumables'
import { floorShapes, generateFloor, generateFloorV2, roomAt, type DungeonFloor, type Rect } from './dungeon'
import { burst, shakeScreen } from './effects'
import { DEBUG_TUNE } from './debugTune'
import { trapStrike } from './hazards'
import { spawnEnemy } from './enemies'
import { chestCoins } from './mapEventRules'
import { COIN_VALUES } from './meta'
import { awardEgg, dropCoins, dropPickup } from './pickups'
import { placePool, type PlaceInteriorOf } from './place'
import { notifyPlace, solidAt, spawnInPlace, startLoot } from './placeKit'
import { playerTypes, type Solid } from './terrain'
import { actAs, anchorPlayer, centerScreen, phaseOf, placeTeam, playerWithin, standing } from './players'
import type { Game, Player } from './types'
import * as dm from '../engine/dmath'

/**
 * The cave, a Mystery Dungeon: dark floors of rooms and corridors
 * (`dungeon.ts`) with stairs down, then a treasure chamber whose chest is
 * guarded by a Monster House. The PMD wind warns three times, then blows the
 * explorer back out. Only a circle of light around the player shows the way
 * (`caveLight`), wider for Fire and Electric types.
 */

export type CaveState = {
  /** The cave's level (1 to 5, `data/caveLevels.ts`): how many floors it has, how deadly it is and how rich. */
  level: number
  /** 0 is B1F; at the level's `floors` the treasure chamber. */
  floor: number
  /** The floor's layout, null in the treasure chamber. */
  plan: DungeonFloor | null
  /** Where the stairs stand, in room px (null in the treasure chamber). */
  stairs: Pt | null
  chest: { x: number; y: number; progress: number; open: boolean } | null
  /** Glowing crystals, in room px: light besides the player's. */
  lights: readonly Pt[]
  /** Wind warnings given so far (up to three). */
  wind: number
  /** The treasure chamber's Monster House has sprung. */
  house: boolean
  /** The floor's ambush rooms (`DungeonFloor.ambush`) and the ones that have sprung. */
  ambush: readonly number[]
  sprung: number[]
  /** Rooms (`DungeonFloor.rooms`) the team has entered: only their Pokémon are awake and their foes can be aimed at, as in the Mystery Dungeon games. */
  visited: number[]
  /** The floor's Cristalário (null in the chamber and on floors without one), and what the wares bought here do until the stairs. */
  shop: CaveShop | null
  lantern: boolean
  compass: boolean
  fortune: boolean
  /** Crystals (indices into `lights`) a player touched, seconds they still shine (kept full while a foot stays on them) and since when they've been lit (`CAVE.crystal`): their glow and the light they give their room (`render/caveSight.ts`). */
  touched: Array<{ i: number; left: number; age: number }>
  /** The floor's hidden traps (`DungeonFloor.traps`) and whether each has gone off. */
  traps: Array<{ x: number; y: number; done: boolean }>
}

type CaveInside = PlaceInteriorOf<'cave'>

/** The treasure chamber: a round cavern, crystals around its wall and the chest in the middle. */
const CHAMBER = { r: 120, chest: [0, -14] as Pt, start: [0, 94] as Pt, crystals: 7 } as const

/** How far the acting player's light reaches: Fire types carry a flame, Electric types use Flash. */
export const caveLight = (g: Game) => {
  const types = playerTypes(g)
  const inside = g.place.inside
  const lantern = inside?.id === 'cave' && inside.state.lantern ? CAVE_SHOP.lantern : 0
  return (types.includes('fire') ? CAVE.fireLight : types.includes('electric') ? CAVE.electricLight : CAVE.light) + lantern
}

type Floor = { layout: FloorPlan; solids: Solid[]; start: Pt; plan: DungeonFloor | null; stairs: Pt | null; chest: CaveState['chest']; lights: readonly Pt[]; shop: CaveShop | null }

/** Lays out floor `index` around world (x, y) and puts its items down: a pile of Poké and something from an item ball. */
/** A floor layout the next `layFloor` uses instead of drawing one (the `?debug=` lab, `debugStart.ts`). */
let staged: DungeonFloor | null = null
export const stagePlan = (plan: DungeonFloor | null) => {
  staged = plan
}

const layFloor = (g: Game, x: number, y: number, index: number, level: number): Floor => {
  const lv = caveLevel(level)
  if (index >= lv.floors) {
    const lights = Array.from({ length: CHAMBER.crystals }, (_, i): Pt => {
      const a = -Math.PI / 2 + ((i + 0.5) / CHAMBER.crystals) * TAU
      return [dm.round(dm.cos(a) * (CHAMBER.r - 16)), dm.round(dm.sin(a) * (CHAMBER.r - 16) * 0.9)]
    }).filter(([lx, ly]) => ly < CHAMBER.r - 40 || Math.abs(lx) > 30)
    const floor: Circle = { kind: 'circle', x: 0, y: 0, r: CHAMBER.r }
    return {
      layout: { floor: [floor] },
      solids: [
        solidAt('chest', PLACE_FEET.chest, x + CHAMBER.chest[0], y + CHAMBER.chest[1]),
        ...lights.map(([lx, ly], i) => solidAt('crystal', PLACE_FEET.crystal, x + lx, y + ly, i)),
      ],
      start: CHAMBER.start,
      plan: null,
      stairs: null,
      chest: { x: CHAMBER.chest[0], y: CHAMBER.chest[1], progress: 0, open: false },
      lights,
      shop: null,
    }
  }
  const plan = staged ?? (PROCGEN.cave ? generateFloorV2(g.rng, index, lv) : generateFloor(g.rng, index))
  staged = null
  plan.items.forEach(([ix, iy], i) => {
    if (i === 0) dropCoins(g, x + ix, y + iy, [COIN_VALUES[1], COIN_VALUES[1], COIN_VALUES[0], COIN_VALUES[0]])
    else dropItem(g, x + ix, y + iy, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
    dropPickup(g, x + ix - 10, y + iy, 'gem')
  })
  // An ambush room's prize: a pile of ₽ and something from an item ball, for whoever dares.
  for (const [px, py] of plan.prizes) {
    dropCoins(g, x + px, y + py, [COIN_VALUES[1], COIN_VALUES[1], COIN_VALUES[1], COIN_VALUES[0], ...Array.from({ length: lv.reward.coins }, () => COIN_VALUES[1])])
    for (let i = 0; i <= lv.reward.items; i++) dropItem(g, x + px + 12 + i * 8, y + py - i * 4, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
    for (let i = 0; i < CAVE_SHOP.gemsPerPrize + lv.reward.gems; i++) dropPickup(g, x + px - 12 + i * 8, y + py + 6, 'gem')
  }
  const sanctuary = plan.sanctuary >= 0 ? plan.rooms[plan.sanctuary]! : null
  const shop: CaveShop | null = sanctuary ? { npc: drawNpc(g.rng, index, lv.reward.shiny), level, x: dm.round(sanctuary.x + sanctuary.w / 2), y: dm.round(sanctuary.y + sanctuary.h / 2) + 6, stand: 0, sold: [] } : null
  return {
    layout: { floor: floorShapes(plan) },
    solids: [
      ...plan.crystals.map(([cx, cy], i) => solidAt('crystal', PLACE_FEET.crystal, x + cx, y + cy, i)),
      ...plan.rocks.map(([rx, ry], i) => solidAt('caveRock', PLACE_FEET.caveRock, x + rx, y + ry, i)),
    ],
    start: plan.start,
    plan,
    stairs: plan.stairs,
    chest: null,
    lights: plan.crystals,
    shop,
  }
}

const stateOf = (f: Floor, floor: number, level: number): CaveState => ({ level, floor, plan: f.plan, stairs: f.stairs, chest: f.chest, lights: f.lights, wind: 0, house: false, ambush: f.plan ? [...f.plan.ambush] : [], sprung: [], visited: f.plan ? [f.plan.startRoom] : [], shop: f.shop, lantern: false, compass: false, fortune: false, touched: [], traps: f.plan ? f.plan.traps.map(([x, y]) => ({ x, y, done: false })) : [] })

export const buildCave = (g: Game, x: number, y: number, level = 1) => {
  const f = layFloor(g, x, y, 0, level)
  return { layout: f.layout, solids: f.solids, start: f.start, state: stateOf(f, 0, level), intro: CAVE.card, left: floorClock(level, 0) }
}

/**
 * Down the stairs: a fresh floor and a fresh cast, the team at its start.
 * Loot still lying around comes along (it flies to a player as they arrive),
 * and the floor's title card holds everything still for a moment.
 */
export const descendCave = (g: Game, inside: CaveInside) => laidFloor(g, inside, inside.state.floor + 1)

/** Lays the floor the team is on out again (a new draw from the run's rng): the debug menu's "Regerar andar". */
export const relayCave = (g: Game, inside: CaveInside) => laidFloor(g, inside, inside.state.floor)

const laidFloor = (g: Game, inside: CaveInside, next: number) => {
  const s = inside.state
  g.enemies = []
  g.hazards = []
  g.bossId = null
  for (const k of g.pickups) k.attracted = true
  const f = layFloor(g, inside.x, inside.y, next, s.level)
  const start = f.start
  inside.layout = f.layout
  inside.terrain = { solids: f.solids, lake: null }
  // The generated cave keeps a clock per floor, and the wind starts over with it.
  if (PROCGEN.cave) inside.left = next >= caveLevel(s.level).floors ? CAVE_GEN.chamberTime : floorClock(s.level, next)
  inside.state = { ...stateOf(f, next, s.level), wind: PROCGEN.cave ? 0 : s.wind }
  placeTeam(g, inside.x + start[0], inside.y + start[1])
  const p = anchorPlayer(g)
  for (const k of g.pickups) {
    if (!k.attracted) continue
    k.x = p.x + range(g.rng, -20, 20)
    k.y = p.y - 30
  }
  for (const q of g.players) centerScreen(g, q, q.x, q.y)
  inside.intro = CAVE.card
  notifyPlace(g, 'cave', { kind: 'floor', floor: inside.state.floor })
}

/** Whether (x, y) is in some player's light (and its 24 px fringe). */
const inLight = (g: Game, x: number, y: number) => {
  const before = g.player
  let lit = false
  for (const p of g.players) {
    g.player = p
    if (dm.sq(x - p.x) + dm.sq(y - p.y) <= dm.sq(caveLight(g) + 24)) lit = true
  }
  g.player = before
  return lit
}

/** A spot in the dark: in some room (or around the chamber), past every player's light but close enough to come for one of them (they take turns, `anchorPlayer`). */
/** The clock of floor `floor` of a cave of `level`, in seconds: a deeper level's wind blows sooner. */
export const floorClock = (level: number, floor: number) => dm.round(CAVE_GEN.floorTime[Math.min(floor, CAVE_GEN.floorTime.length - 1)]! * caveLevel(level).time)

/** The clock of the floor the team is on, in seconds. */
const floorTime = (inside: CaveInside) => floorClock(inside.state.level, inside.state.floor)

const darkSpot = (inside: CaveInside) => (g: Game) => {
  const plan = inside.state.plan
  const p = anchorPlayer(g)
  for (let i = 0; i < 4; i++) {
    let x: number
    let y: number
    if (plan) {
      // Never in the Cristalário (its dweller is at peace), nor in a room a player stands in: foes there come from the dark, not out of nowhere.
      const there = g.players.map((q) => roomAt(plan, q.x - inside.x, q.y - inside.y))
      const seen = inside.state.visited.filter((room) => room !== plan.sanctuary && !there.includes(room))
      if (seen.length === 0) return null
      const room = seen[Math.floor(g.rng() * seen.length)]!
      // The brighter the room, the fewer foes the dark sends into it, and fewer still in rooms already explored, growing as the floor's clock runs down.
      const { explored, ramp } = CAVE_GEN.spawn
      const level = levelsOf(plan, inside.state.touched.map((c) => c.i), CAVE.lit)[room]!
      const calm = dm.sq(1 - level / CAVE.lit.max)
      const lingered = PROCGEN.cave ? 1 + (ramp * (floorTime(inside) - inside.left)) / floorTime(inside) : 1
      if (g.rng() >= explored * calm * lingered) continue
      const r = plan.rooms[room]!
      x = inside.x + range(g.rng, r.x + 14, r.x + r.w - 14)
      y = inside.y + range(g.rng, r.y + 14, r.y + r.h - 14)
    } else {
      // The treasure chamber: the same rule, with its crystals' light spread over the whole cavern.
      const { explored } = CAVE_GEN.spawn
      const level = levelOf(inside.state.touched.length, Math.PI * CHAMBER.r * CHAMBER.r, CAVE.lit)
      if (g.rng() >= explored * dm.sq(1 - level / CAVE.lit.max)) continue
      const a = range(g.rng, 0, TAU)
      const d = range(g.rng, 40, CHAMBER.r - 16)
      x = inside.x + dm.cos(a) * d
      y = inside.y + dm.sin(a) * d
    }
    if (!inLight(g, x, y) && dm.sq(x - p.x) + dm.sq(y - p.y) < 380 * 380) return { x, y }
  }
  return null
}

/** The Monster House: wild Pokémon all around the chest at once. */
export const springHouse = (g: Game, inside: CaveInside) => {
  inside.state.house = true
  const chest = inside.state.chest
  if (!chest) return
  const count = CAVE.monsterHouse + caveLevel(inside.state.level).house + Math.floor(g.time / 120)
  const offset = range(g.rng, 0, TAU)
  const pool = placePool('cave', g.time)
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * TAU
    const d = range(g.rng, 46, 84)
    spawnEnemy(g, weightedPick(g.rng, pool), inside.x + chest.x + dm.cos(a) * d, inside.y + chest.y + dm.sin(a) * d * 0.8)
  }
  shakeScreen(g, 5, { x: inside.x + chest.x, y: inside.y + chest.y })
  notifyPlace(g, 'cave', { kind: 'monsterHouse' })
}

/**
 * An ambush room's pack: wild Pokémon out of the dark all over the room at
 * once, themed by depth and as many as the room is big (`CAVE_GEN.packs`),
 * with the floor's leader in a big enough room: an Alpha, or a tough Pokémon
 * like Onix. They appear clear of whoever stepped in (`by`).
 */
export const springAmbush = (g: Game, inside: CaveInside, room: Rect, cells: number, by: { x: number; y: number }) => {
  const lv = caveLevel(inside.state.level)
  const pack = CAVE_GEN.packs[Math.min(inside.state.floor + lv.packShift, CAVE_GEN.packs.length - 1)]!
  const count = Math.min(dm.round(CAVE_GEN.packMax * lv.packSize), dm.round((pack.base + pack.perCell * (cells - 1)) * lv.packSize))
  const spot = () => {
    let x = 0
    let y = 0
    for (let i = 0; i < 8; i++) {
      x = inside.x + range(g.rng, room.x + 16, room.x + room.w - 16)
      y = inside.y + range(g.rng, room.y + 16, room.y + room.h - 16)
      if (dm.sq(x - by.x) + dm.sq(y - by.y) > 70 * 70) break
    }
    return { x, y }
  }
  for (let i = 0; i < count; i++) {
    const at = spot()
    spawnEnemy(g, pack.mob[Math.floor(g.rng() * pack.mob.length)]!, at.x, at.y).alert = CAVE.sight.ambush
  }
  const cx = inside.x + room.x + room.w / 2
  const cy = inside.y + room.y + room.h / 2
  const lead = pack.leader
  if (lead && cells >= Math.max(2, lead.minCells - lv.leaderCells)) {
    const boss = lead.alpha ? spawnAlpha(g, lead.kind, cx, cy) : spawnEnemy(g, lead.kind, cx, cy)
    boss.alert = CAVE.sight.ambush
    // The room's leader takes the HP bar, as a wave boss does (it clears when it falls or the team goes down the stairs).
    g.bossId = boss.id
  }
  shakeScreen(g, 4, { x: cx, y: cy })
  notifyPlace(g, 'cave', { kind: 'monsterHouse' })
}

/** The chest opens: ₽, a Poké Ball, items and maybe an egg, then the way out. */
const openChest = (g: Game, inside: CaveInside, chest: NonNullable<CaveState['chest']>) => {
  chest.open = true
  // The chest's art shows it open.
  for (const s of inside.terrain.solids) if (s.kind === 'chest') s.variant = 1
  const x = inside.x + chest.x
  const y = inside.y + chest.y
  const lv = caveLevel(inside.state.level)
  const coins = [...chestCoins(g.time), COIN_VALUES[2], ...Array.from({ length: lv.reward.coins }, () => COIN_VALUES[2])]
  dropCoins(g, x, y - 4, coins)
  dropPickup(g, x + 8, y, 'pokeball')
  PLACE_LOOT.cave.forEach((item, i) => dropItem(g, x - 8 + i * 6, y, item))
  // The deeper the cave, the more the chest holds: extra Rare Candies and item rolls, and a better egg.
  for (let i = 0; i < lv.reward.chestCandies; i++) dropItem(g, x - 14 - i * 6, y + 4, PLACE_LOOT.cave[0])
  for (let i = 0; i < lv.reward.chestItems; i++) dropItem(g, x + 14 + i * 7, y + 4, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
  awardEgg(g, lv.reward.egg, x, y)
  burst(g, x, y - 8, { colors: ['#f8d030', '#fff8c0', '#ffffff', '#c08800'], count: 60, speed: 150, ttl: 0.8, gravity: 60 })
  shakeScreen(g, 4, { x, y })
  notifyPlace(g, 'cave', { kind: 'treasure', coins: coins.reduce((a, b) => a + b, 0) })
  startLoot(g, inside)
}

/**
 * Whether `p` stands where the treasure chamber's chest fills, still shut: a
 * lunge stops there (`attacks.ts`), like at a doorway, so a move that keeps
 * carrying the player (Aqua Step's dance) can't hop them off it every time.
 */
export const atCaveChest = (g: Pick<Game, 'place'>, p: Pick<Player, 'x' | 'y' | 'radius'>) => {
  const inside = g.place.inside
  if (inside?.id !== 'cave') return false
  const chest = inside.state.chest
  return chest !== null && !chest.open && dm.sq(p.x - inside.x - chest.x) + dm.sq(p.y - inside.y - chest.y) < dm.sq(CAVE.chestRadius + p.radius)
}

/** Every tick in the cave: the wind's warnings, the stairs, the Monster House, the chest and the dark's spawns. */
export const updateCave = (g: Game, inside: CaveInside, dt: number) => {
  const s = inside.state
  while (s.wind < CAVE.wind.length && inside.left <= CAVE.wind[s.wind]!) {
    s.wind++
    notifyPlace(g, 'cave', { kind: 'wind', level: s.wind })
  }
  // A room the team steps into is theirs to face: its Pokémon wake. The first player into an ambush room springs its pack.
  const plan = s.plan
  if (plan) {
    for (const p of g.players) {
      const room = roomAt(plan, p.x - inside.x, p.y - inside.y)
      if (room >= 0 && !s.visited.includes(room)) s.visited.push(room)
      if (room < 0 || !s.ambush.includes(room) || s.sprung.includes(room)) continue
      s.sprung.push(room)
      springAmbush(g, inside, plan.rooms[room]!, plan.sizes[room]!, p)
    }
  }
  // A crystal a player's foot touches lights up for a while and then goes out (touching it again lights it afresh).
  for (const c of s.touched) {
    c.left -= dt
    c.age += dt
  }
  retain(s.touched, (c) => c.left > 0)
  const { rx, ry } = CAVE.crystal
  const time = CAVE.crystal.time * DEBUG_TUNE.crystal
  s.lights.forEach(([lx, ly], i) => {
    if (!g.players.some((p) => standing(g, p) && dm.sq((p.x - inside.x - lx) / rx) + dm.sq((p.y - inside.y - ly) / ry) <= 1)) return
    const lit = s.touched.find((c) => c.i === i)
    if (lit) lit.left = time
    else s.touched.push({ i, left: time, age: 0 })
  })
  // Standing in the Cristalário's ring opens the sheet for whoever stands there.
  const shop = s.shop
  if (shop) {
    const sx = inside.x + shop.x
    const sy = inside.y + shop.y
    const guest = playerWithin(g, sx, sy, CAVE_SHOP.radius, true)
    shop.stand = Math.max(0, Math.min(CAVE_SHOP.stand, shop.stand + (guest ? dt : -dt)))
    if (shop.stand >= CAVE_SHOP.stand && guest && phaseOf(g, guest) === 'playing') {
      const before = actAs(g, guest)
      openShop(g, shop)
      actAs(g, before)
      shop.stand = 0
    }
  }
  // A hidden trap goes off under the first player to step on it: a telegraphed rockfall.
  for (const t of s.traps) {
    if (t.done || !playerWithin(g, inside.x + t.x, inside.y + t.y, CAVE_TRAP.trigger)) continue
    t.done = true
    trapStrike(g, inside.x + t.x, inside.y + t.y)
    shakeScreen(g, 2, { x: inside.x + t.x, y: inside.y + t.y })
  }
  // Any player at the stairs takes the team down; any player at the chest opens it.
  const stairs = s.stairs
  if (stairs) {
    for (const p of g.players) if (dm.sq(p.x - inside.x - stairs[0]) + dm.sq(p.y - inside.y - stairs[1]) < dm.sq(CAVE.stairsRadius + p.radius * 0.5)) return descendCave(g, inside)
  }
  const chest = s.chest
  if (chest && !chest.open) {
    if (!s.house) return springHouse(g, inside)
    let near = false
    for (const p of g.players) near ||= dm.sq(p.x - inside.x - chest.x) + dm.sq(p.y - inside.y - chest.y) < dm.sq(CAVE.chestRadius + p.radius)
    const before = chest.progress
    chest.progress = clamp(chest.progress + (near ? dt : -dt * 0.5) / CAVE.chestTime, 0, 1)
    if (chest.progress > before && Math.floor(chest.progress * 5) !== Math.floor(before * 5)) notifyPlace(g, 'cave', { kind: 'chestTick' })
    if (chest.progress >= 1) return openChest(g, inside, chest)
  }
  spawnInPlace(g, inside, dt, darkSpot(inside), (s.plan ? 1 : 0.3) * (PROCGEN.cave ? 1 + CAVE_GEN.spawnPerFloor * s.floor : 1) * caveLevel(s.level).spawn)
}

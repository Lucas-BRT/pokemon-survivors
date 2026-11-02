import { cellCenter, nearestMaze } from './grandMaze'
import { BIOMES, type BiomeId } from '../data/biomes'
import { setBiome } from './biomes'
import { PLACE_IDS, type PlaceId } from '../data/places'
import { CAVE_NPCS, type CaveNpcId } from '../data/caveShop'
import { descendCave, stagePlan } from './cave'
import { CAVE } from '../data/places'
import type { DungeonFloor, Rect } from './dungeon'
import { placeTeam } from './players'
import { enterPlace } from './placeInterior'
import type { Game } from './types'

/**
 * Debug start (dev builds only, `?debug=` in the URL): the page opens straight
 * into a run staged for a feature, so testing it doesn't take a whole run.
 * `?debug=cave` starts inside the cave; `&floor=2` takes its stairs that many
 * times, `&mon=charmander` picks the Pokémon, `&coins=5000` and `&gems=6` fill the run's ₽ and gems, and
 * `&shop=sableyeShiny` (a `CAVE_NPCS` id) puts that dweller in the floor's Cristalário and the team beside it.
 * `?debug=maze` walks the run to the nearest hedge maze's first way in (`&biome=snow` first sets its biome, `&in` stands inside it). A bare `?debug` just starts a run. Never ranked:
 * the shell skips the debug runs' banking, and this only runs in dev.
 */
export type DebugStart = { place: PlaceId | null; floor: number; mon: string | null; coins: number; gems: number; shop: CaveNpcId | null; lab: Lab | null; maze: boolean; inside: boolean; biome: BiomeId | null }

/** The light lab (`&lab=S:C:D`): one room of S times the reference area, C crystals inside it, D in its door tile. */
export type Lab = { size: number; inside: number; doors: number; vertical: 0 | 1 | 2 }

const parseLab = (v: string | null): Lab | null => {
  if (!v) return null
  const [size, inside, doors, vertical] = v.split(':').map((n) => Math.max(0, Number(n) || 0))
  return { size: size || 1, inside: inside ?? 0, doors: doors ?? 0, vertical: vertical === 1 ? 1 : vertical === 2 ? 2 : 0 }
}

/** The plan turned a quarter (x and y swapped), so the lab's corridor runs down instead of across. */
const transpose = (p: DungeonFloor, up: boolean): DungeonFloor => {
  const k = up ? -1 : 1
  const t = ({ x, y, w, h }: Rect): Rect => ({ x: y, y: up ? -(x + w) : x, w: h, h: w })
  const pt = ([x, y]: readonly [number, number]) => [y, k * x] as const
  return {
    ...p,
    rooms: p.rooms.map(t),
    links: p.links.map((l) => ({ ...l, path: l.path.map(pt), rects: l.rects.map(t) })),
    start: [...pt(p.start)],
    stairs: [...pt(p.stairs)],
    crystals: p.crystals.map((c) => [...pt(c)]),
  }
}

/** A floor of one room (the lab's) and a small one past a corridor, with the crystals the lab asks for: a room to judge the cave's light by. */
export const labPlan = ({ size, inside, doors, vertical }: Lab): DungeonFloor => {
  const area = size * CAVE.lit.aref
  const w = Math.round(Math.sqrt(area * 1.25))
  const h = Math.round(area / w)
  const room: Rect = { x: -Math.round(w / 2), y: -Math.round(h / 2), w, h }
  const next: Rect = { x: room.x + w + 110, y: -40, w: 100, h: 80 }
  const cx = Math.round(next.x + next.w / 2)
  const mx = Math.round((room.x + w + next.x) / 2)
  const crystals = Array.from({ length: inside }, (_, i): [number, number] => {
    const a = (i / Math.max(1, inside)) * Math.PI * 2 + 0.6
    return [Math.round(Math.cos(a) * w * 0.36), Math.round(Math.sin(a) * h * 0.34)]
  })
  for (let i = 0; i < doors; i++) crystals.push([room.x + w + 14, i % 2 ? 14 : -14])
  const plan: DungeonFloor = {
    rooms: [room, next],
    links: [{ a: 0, b: 1, path: [[0, 0], [mx, 0], [mx, 0], [cx, 0]], rects: [{ x: -22, y: -22, w: cx + 44, h: 44 }] }],
    start: [Math.round(-w * 0.15), Math.round(h * 0.1)],
    stairs: [cx, 0],
    startRoom: 0,
    stairsRoom: 1,
    items: [],
    crystals,
    rocks: [],
    ambush: [],
    prizes: [],
    sizes: [size, 1],
    sanctuary: -1,
  }
  return vertical ? transpose(plan, vertical === 2) : plan
}

/** Reads `?debug=…` (null when absent); unknown places and bad numbers fall back to nothing. */
export const parseDebug = (search: string): DebugStart | null => {
  const q = new URLSearchParams(search)
  if (!q.has('debug')) return null
  const place = q.get('debug')
  const num = (key: string) => Math.max(0, Math.floor(Number(q.get(key))) || 0)
  return {
    place: PLACE_IDS.find((id) => id === place) ?? null,
    floor: num('floor'),
    mon: q.get('mon'),
    coins: num('coins'),
    gems: num('gems'),
    lab: parseLab(q.get('lab')),
    maze: place === 'maze',
    inside: q.has('in'),
    biome: (Object.keys(BIOMES) as BiomeId[]).find((id) => id === q.get('biome')) ?? null,
    shop: (Object.keys(CAVE_NPCS) as CaveNpcId[]).find((id) => id === q.get('shop')) ?? null,
  }
}

/**
 * Sets the team down at the first way in of the nearest big hedge maze (just outside it, or `inside` a step in). The search widens
 * until it finds one, so there is always a maze to debug without walking the map. Returns whether one was found.
 */
export const goToMaze = (g: Game, inside = false) => {
  for (let blocks = 6; blocks <= 48; blocks *= 2) {
    const site = nearestMaze(g.terrain.seed, g.player.x, g.player.y, blocks)
    const e = site?.entrances[0]
    if (!site || !e) continue
    const c = cellCenter(site, e.c, e.r)
    const out = inside ? -64 : 70
    placeTeam(g, e.side === 3 ? site.x - out : e.side === 1 ? site.x + site.side + out : c.x, e.side === 0 ? site.y - out : e.side === 2 ? site.y + site.side + out : c.y)
    return true
  }
  return false
}

/** Stages the running game as `spec` says. */
export const applyDebug = (g: Game, input: DebugStart) => {
  let spec = input
  if (spec.biome) setBiome(g, spec.biome)
  if (spec.lab) spec = { ...spec, floor: Math.max(1, spec.floor) }
  g.coins += spec.coins
  // `?debug=maze`: just outside the nearest big hedge maze's first way in.
  if (spec.maze) goToMaze(g, spec.inside)
  g.player.gems += spec.gems
  if (spec.place) enterPlace(g, spec.place, Math.round(g.player.x), Math.round(g.player.y))
  // The lab's floor replaces the next one drawn: B2F with a room of the asked size.
  if (spec.lab) stagePlan(labPlan(spec.lab))
  for (let i = 0; i < spec.floor; i++) {
    const inside = g.place.inside
    if (inside?.id !== 'cave') break
    descendCave(g, inside)
  }
  // `&shop=sableyeShiny`: this floor's Cristalário has that dweller, and the team starts a few steps from it.
  const inside = g.place.inside
  const shop = inside?.id === 'cave' ? inside.state.shop : null
  if (inside && shop && spec.shop) {
    shop.npc = spec.shop
    placeTeam(g, inside.x + shop.x, inside.y + shop.y + 60)
  }
}

/** Rebuilds the cave around a new lab room (`labPlan`) without restarting the run: the light menu's "Aplicar". Dev only. */
export const applyLab = (g: Game, lab: Lab) => {
  const inside = g.place.inside
  if (inside?.id !== 'cave') return false
  stagePlan(labPlan(lab))
  descendCave(g, inside)
  g.enemies.length = 0
  return true
}

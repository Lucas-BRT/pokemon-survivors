import { CAVE } from '../data/places'
import { caveLight } from '../game/cave'
import { levelOf, levelsOf } from '../game/caveLevel'
import { LIGHT_FIELD } from '../data/lightSources'
import { atDepth, onSources, type LightSource } from '../game/lightSources'
import { spaceAt, type DungeonFloor, type Rect } from '../game/dungeon'
import type { Game } from '../game/types'

/**
 * What the team has seen of a cave floor: the map px (`SEEN_SCALE` world px
 * each) every player's light has reached so far. The dark and the minimap
 * both read it, so they agree: what the light hasn't touched stays black (no
 * glow of a crystal, no eyes, no stairs), and what it has stays known.
 * Presentation only: the simulation never knows, and a new floor starts unseen.
 */

/** World px per remembered cell; the minimap draws a cave at this scale too. */
export const SEEN_SCALE = 14

/** Map px each cave floor's team has lit so far, by the floor's layout. */
const seenOf = new WeakMap<DungeonFloor, Set<number>>()
/** The rooms already added to `seenOf`'s set. */
const roomsDone = new WeakMap<DungeonFloor, Set<number>>()

export const fogKey = (mx: number, my: number) => (mx & 0xffff) * 0x10000 + (my & 0xffff)

/** Walls show this many px past a space's floor (the rock's face), so the light reveals them but not what lies behind. */
const WALL = 14

/** What a player at floor px (x, y) can see into: their room, or else the corridor stretches they stand in. */
export const spacesAround = (plan: DungeonFloor, x: number, y: number, out: Rect[] = []) => {
  out.length = 0
  const room = spaceAt(plan, x, y)
  if (room >= 0 && room < plan.rooms.length) return (out.push(plan.rooms[room]!), out)
  for (const l of plan.links) for (const r of l.rects) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) out.push(r)
  return out
}

/**
 * Adds what the team has seen of floor `plan` (a cave at (cx, cy)) and gives
 * the whole of it: a room is known whole once someone has entered it
 * (`CaveState.visited`), a corridor as far as the light has walked it. The
 * light never reaches through rock into another room.
 */
export const caveFog = (g: Game, plan: DungeonFloor, visited: readonly number[], cx: number, cy: number) => {
  let seen = seenOf.get(plan)
  if (!seen) seenOf.set(plan, (seen = new Set()))
  const done = roomsDone.get(plan) ?? roomsDone.set(plan, new Set()).get(plan)!
  for (const i of visited) {
    if (done.has(i)) continue
    done.add(i)
    const r = plan.rooms[i]!
    // One cell past the room each way: the map draws the rim of its walls there.
    const x0 = Math.floor((cx + r.x) / SEEN_SCALE) - 1
    const x1 = Math.floor((cx + r.x + r.w) / SEEN_SCALE) + 1
    for (let my = Math.floor((cy + r.y) / SEEN_SCALE) - 1; my <= Math.floor((cy + r.y + r.h) / SEEN_SCALE) + 1; my++) for (let mx = x0; mx <= x1; mx++) seen.add(fogKey(mx, my))
  }
  const rad = Math.ceil(caveLight(g) / SEEN_SCALE)
  const around: Rect[] = []
  for (const p of g.players) {
    if (p.gone) continue
    spacesAround(plan, p.x - cx, p.y - cy, around)
    const px = Math.floor(p.x / SEEN_SCALE)
    const py = Math.floor(p.y / SEEN_SCALE)
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue
        const wx = (px + dx + 0.5) * SEEN_SCALE - cx
        const wy = (py + dy + 0.5) * SEEN_SCALE - cy
        // Only the space the player stands in: not the rock, nor a room behind it.
        const at = spaceAt(plan, wx, wy)
        if (at >= 0 && at < plan.rooms.length && !visited.includes(at)) continue
        if (around.some((r) => wx >= r.x - WALL && wx <= r.x + r.w + WALL && wy >= r.y - WALL && wy <= r.y + r.h + WALL)) seen.add(fogKey(px + dx, py + dy))
      }
    }
  }
  return seen
}
/** Whether the world px (x, y) has been seen. */
export const wasSeen = (seen: ReadonlySet<number>, x: number, y: number) => seen.has(fogKey(Math.floor(x / SEEN_SCALE), Math.floor(y / SEEN_SCALE)))

/**
 * The cave's light numbers as the screen reads them: `CAVE.lit`'s, plus the spill into corridors, the light sources' aura, how their
 * light is seen from another space (`LIGHT_FIELD`) and a scale for the player's light.
 * A copy the debug menu (`ui/debugMenu.ts`) edits at run time; `retune` after a change so the levels are worked out again.
 */
export type Lit = { -readonly [K in keyof typeof CAVE.lit]: number } & { -readonly [K in keyof typeof LIGHT_FIELD]: number } & {
  spill: number
  rim: number
  allOn: number
  aura: number
  auraGain: number
  playerScale: number
  /** A source that is on: seconds its light takes to ease in, px its radius wavers, the share of its light kept while it blinks out, and the radius (px) of the lit spot round its foot. */
  auraEase: number
  auraWaver: number
  auraBlink: number
  auraFoot: number
}
export const LIT_DEFAULTS: Lit = { ...CAVE.lit, ...LIGHT_FIELD, spill: 32, rim: 6, allOn: 0, aura: 30, auraGain: 0.65, playerScale: 1, auraEase: 0.4, auraWaver: 1.5, auraBlink: 0.3, auraFoot: 26 }
export const lit: Lit = { ...LIT_DEFAULTS }
let tuning = 0
export const retune = () => void tuning++

/** A room's level of light, 0..1 (`lit`): the sources' energy `e` spread over a room of `area` px² (`game/lightSources.ts`). */
export const roomLevel = (e: number, area: number, floor = 0) => levelOf(e, area, atDepth(lit, floor))

const levelsCache = new WeakMap<DungeonFloor, { key: string; levels: number[] }>()

/**
 * Every space's level of light on floor `plan` (the rooms first, then the corridors): the sources on in a space count whole, the ones
 * in a corridor close to a room count `lit.door` of their strength there, less the farther from it. `lit.allOn` counts every source
 * (the lab). `floor` is how far down the cave is: each floor down starts a visited room darker (`atDepth`). Worked out again when the sources on, the floor or the numbers change.
 */
export const roomLevels = (plan: DungeonFloor, sources: readonly LightSource[], floor = 0): readonly number[] => {
  const key = `${tuning}:${floor}:${onSources(sources).join(',')}:${lit.allOn}`
  const known = levelsCache.get(plan)
  if (known && known.key === key) return known.levels
  const levels = levelsOf(plan, sources, atDepth(lit, floor), lit.allOn === 1)
  levelsCache.set(plan, { key, levels })
  return levels
}

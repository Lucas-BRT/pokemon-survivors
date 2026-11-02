import { CAVE } from '../data/places'
import { caveLight } from '../game/cave'
import { levelOf, levelsOf } from '../game/caveLevel'
import { roomAt, spaceAt, type DungeonFloor, type Rect } from '../game/dungeon'
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
 * The cave's light numbers as the screen reads them: `CAVE.lit`'s, plus the spill into corridors, the crystals' aura and a scale for the player's light.
 * A copy the dev light menu (`ui/lightMenu.ts`) edits at run time; `retune` after a change so the levels are worked out again.
 */
export type Lit = { -readonly [K in keyof typeof CAVE.lit]: number } & {
  spill: number
  rim: number
  allOn: number
  aura: number
  auraGain: number
  playerScale: number
  /** A shining crystal: seconds its light takes to ease in, px its radius wavers, the share of its light kept while it blinks out, and the radius (px) of the lit spot round its foot. */
  auraEase: number
  auraWaver: number
  auraBlink: number
  auraFoot: number
  /** A crystal that doesn't shine (0 off, 1 on): the dull glint's radius (px), its strength, how far (px) past its room's walls a player can be and still see it at full (inside the room it never fades; in a corridor the distance is to the crystal), and how far past that it fades out. */
  glint: number
  glintR: number
  glintGain: number
  glintNear: number
  glintFade: number
}
export const LIT_DEFAULTS: Lit = { ...CAVE.lit, spill: 32, rim: 6, allOn: 0, aura: 30, auraGain: 0.65, playerScale: 1, auraEase: 0.4, auraWaver: 1.5, auraBlink: 0.3, auraFoot: 26, glint: 1, glintR: 9, glintGain: 0.7, glintNear: 60, glintFade: 90 }
export const lit: Lit = { ...LIT_DEFAULTS }
let tuning = 0
export const retune = () => void tuning++

/** A room's level of light, 0..1 (`lit`): the crystals' energy `e` spread over a room of `area` px² (`game/caveLevel.ts`). */
export const roomLevel = (e: number, area: number) => levelOf(e, area, lit)

const levelsCache = new WeakMap<DungeonFloor, { key: string; levels: number[] }>()

/**
 * Each room's level of light on floor `plan`: a crystal inside counts whole, one standing in a corridor close to the room
 * counts `CAVE.lit.door` of its strength, less the farther from the room. Only the crystals the team has touched
 * (`CaveState.touched`'s indices into `plan.crystals`, while they shine) give light; `lit.allOn` counts them all (the lab). Worked out again when that changes.
 */
export const roomLevels = (plan: DungeonFloor, touched: readonly number[]): readonly number[] => {
  const key = `${tuning}:${touched.join(',')}:${lit.allOn}`
  const known = levelsCache.get(plan)
  if (known && known.key === key) return known.levels
  const levels = levelsOf(plan, touched, lit, lit.allOn === 1)
  levelsCache.set(plan, { key, levels })
  return levels
}

/**
 * How strongly a crystal that isn't shining glints (0..1, before `glintGain`): constant while a player is in its room, wherever in it
 * they stand, and fading only once they are out of it, by their distance to its walls (`glintNear` px of grace, then `glintFade` px
 * to nothing); `caveDark` shows it only for rooms already entered. A crystal in a corridor has no room: the distance is to the crystal itself. In the treasure chamber (`plan` null) the
 * whole cavern is one room. `players` and the crystal (`at`) are in the floor's own px.
 */
export const glintOf = (plan: DungeonFloor | null, at: readonly [number, number], players: ReadonlyArray<{ x: number; y: number }>, n: Pick<Lit, 'glintNear' | 'glintFade'> = lit) => {
  const room = plan ? roomAt(plan, at[0], at[1]) : -1
  const walls = room >= 0 ? plan!.rooms[room]! : null
  let nearest = Infinity
  for (const q of players) {
    const d = !plan ? 0 : walls ? Math.hypot(Math.max(walls.x - q.x, 0, q.x - (walls.x + walls.w)), Math.max(walls.y - q.y, 0, q.y - (walls.y + walls.h))) : Math.hypot(q.x - at[0], q.y - at[1])
    nearest = Math.min(nearest, d)
  }
  const k = Math.max(0, Math.min(1, (nearest - n.glintNear) / Math.max(1, n.glintFade)))
  return 1 - k * k * (3 - 2 * k)
}

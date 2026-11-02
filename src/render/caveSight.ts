import { caveLight } from '../game/cave'
import type { DungeonFloor } from '../game/dungeon'
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

export const fogKey = (mx: number, my: number) => (mx & 0xffff) * 0x10000 + (my & 0xffff)

/** Adds the light around every player to what floor `plan` has seen, and gives the whole of it. */
export const caveFog = (g: Game, plan: DungeonFloor) => {
  let seen = seenOf.get(plan)
  if (!seen) seenOf.set(plan, (seen = new Set()))
  const r = Math.ceil(caveLight(g) / SEEN_SCALE)
  for (const p of g.players) {
    if (p.gone) continue
    const px = Math.floor(p.x / SEEN_SCALE)
    const py = Math.floor(p.y / SEEN_SCALE)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) seen.add(fogKey(px + dx, py + dy))
  }
  return seen
}

/** Whether the world px (x, y) has been seen. */
export const wasSeen = (seen: ReadonlySet<number>, x: number, y: number) => seen.has(fogKey(Math.floor(x / SEEN_SCALE), Math.floor(y / SEEN_SCALE)))

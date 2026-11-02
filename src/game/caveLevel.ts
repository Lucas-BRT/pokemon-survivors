import type { DungeonFloor, Rect } from './dungeon'
import { spaceAt } from './dungeon'
import * as dm from '../engine/dmath'

/**
 * How lit a cave room is, from its crystals: the pure rule behind the light the screen draws (`render/caveSight.ts`
 * reads it with its tunable copy of the numbers) and behind how often the dark spawns foes in it (`cave.ts`, with
 * `CAVE.lit`'s own). A room starts at `floor`; the energy `e` of the crystals shining in it (and, at `door` of
 * their strength, the ones in a corridor's door tile, fading over `reach` px) is spread over its area:
 * L = floor + (max - floor)(1 - exp(-e / (e0 · S^gamma))), S the area over `aref`.
 */
export type LevelNumbers = { floor: number; max: number; e0: number; gamma: number; aref: number; reach: number; door: number }

export const levelOf = (e: number, area: number, n: LevelNumbers) => n.floor + (n.max - n.floor) * (1 - dm.exp(-e / (n.e0 * dm.pow(area / n.aref, n.gamma))))

const distTo = (r: Rect, x: number, y: number) => dm.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)))

/** Each room's level of light on `plan` with the crystals `shining` (indices into `plan.crystals`; `all` counts every one). */
export const levelsOf = (plan: DungeonFloor, shining: readonly number[], n: LevelNumbers, all = false): number[] =>
  plan.rooms.map((r) => {
    let e = 0
    for (const [i, [x, y]] of plan.crystals.entries()) {
      if (!all && !shining.includes(i)) continue
      const d = distTo(r, x, y)
      if (d === 0) e += 1
      else if (spaceAt(plan, x, y) >= plan.rooms.length && d < n.reach) e += n.door * (1 - d / n.reach)
    }
    return levelOf(e, r.w * r.h, n)
  })

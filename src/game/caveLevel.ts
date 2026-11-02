import type { DungeonFloor } from './dungeon'
import { levelOf, spaceLevels, type LevelNumbers, type LightSource } from './lightSources'

/**
 * How lit a cave room is, from its light sources: the pure rule behind the light the screen draws (`render/caveSight.ts`
 * reads it with its tunable copy of the numbers) and behind how often the dark spawns foes in it (`cave.ts`, with
 * `CAVE.lit`'s own). The maths is in `game/lightSources.ts`; a room starts at `floor`, and the energy of the sources on in it (and, at
 * `door` of their strength, the ones in a corridor's door tile, fading over `reach` px) is spread over its area:
 * L = floor + (max - floor)(1 - exp(-e / (e0 · S^gamma))), S the area over `aref`.
 */
export type { LevelNumbers }
export { levelOf }

/** Each space's level of light on `plan` (the rooms first, then the corridors) with the sources that are on (`all` counts every one). */
export const levelsOf = (plan: DungeonFloor, sources: readonly LightSource[], n: LevelNumbers, all = false): number[] => spaceLevels(plan, sources, n, all)

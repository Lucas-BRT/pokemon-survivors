import * as dm from '../engine/dmath'
import { EXPLORER_ORDER, EXPLORER_THEMES, EXPLORERS, SPECIAL_ORDER, type ExplorerThemeId, type FloorKind } from '../data/explorers'
import type { EnemyId } from '../data/enemies'

/**
 * The rules of Explorers (`docs/explorers.md`) that depend only on the depth: which block and theme a floor belongs to, what kind of
 * floor it is, how strong its foes are and which species may live there. Pure arithmetic, no rng and no state: the same depth gives the
 * same answer on every client.
 */

/** The block of floors `depth` is in: 0 for floors 1 to `bossEvery`, 1 for the next ones… */
export const blockOf = (depth: number) => Math.floor((depth - 1) / EXPLORERS.bossEvery)

/** The theme of floor `depth`: the themes in order, one per block, then around again. */
export const themeOf = (depth: number): ExplorerThemeId => EXPLORER_ORDER[blockOf(depth) % EXPLORER_ORDER.length]!

/** How many times the whole list of themes has been gone through before floor `depth`. */
export const cycleOf = (depth: number) => Math.floor(blockOf(depth) / EXPLORER_ORDER.length)

/** The floor's place in its block, 1 to `bossEvery`. */
export const floorInBlock = (depth: number) => ((depth - 1) % EXPLORERS.bossEvery) + 1

/** What floor `depth` is: the block's boss, a sub-boss, one of the special floors, or a plain fight (the first floor is always one). */
export const floorKind = (depth: number): FloorKind => {
  if (depth % EXPLORERS.bossEvery === 0) return 'boss'
  if (depth % EXPLORERS.subbossEvery === 0) return 'subboss'
  if (depth === 1) return 'normal'
  for (const kind of SPECIAL_ORDER) {
    const [every, offset] = EXPLORERS.special[kind]
    if (depth % every === offset) return kind
  }
  return 'normal'
}

/** The foes' strength at `depth`, 1 on the first floor: the curve of the floors, plus a step each time the themes go around. */
export const powerAt = (depth: number) => 1 + EXPLORERS.curve.perFloor * (depth - 1) + EXPLORERS.curve.perCycle * cycleOf(depth)

/** The species that may live on floor `depth`, by the theme's own list (a species shows up from its floor in the block on). */
export const speciesAt = (depth: number): EnemyId[] => {
  const at = floorInBlock(depth)
  return EXPLORER_THEMES[themeOf(depth)].species.filter(([, from]) => from <= at).map(([id]) => id)
}

/** The boss guarding floor `depth`'s stairs, or null when the floor has none (a sub-boss on every `subbossEvery`, the boss on every `bossEvery`). */
export const guardOf = (depth: number): EnemyId | null => {
  const kind = floorKind(depth)
  const theme = EXPLORER_THEMES[themeOf(depth)]
  return kind === 'boss' ? theme.boss : kind === 'subboss' ? theme.subboss : null
}

/** How many floors until the next boss, counting this one (1 on a boss floor). */
export const floorsToBoss = (depth: number) => EXPLORERS.bossEvery - floorInBlock(depth) + 1

/** A floor's clock in seconds. */
export const clockAt = (depth: number) => Math.max(EXPLORERS.clock.min, EXPLORERS.clock.start + EXPLORERS.clock.perFloor * (depth - 1))

/** The cave level whose generator settings floor `depth` uses (1 to 5). */
export const generatorLevel = (depth: number) => Math.min(5, 1 + Math.floor((depth - 1) / EXPLORERS.generator.levelEvery))

/** Foes standing in a room of `cells` grid cells when the floor is laid out: none on a rest floor, more on a hall floor. */
export const headcount = (depth: number, cells: number) => {
  const kind = floorKind(depth)
  if (kind === 'rest' || kind === 'market') return 0
  const { perRoom, perCell, hallFactor } = EXPLORERS.population
  return dm.round((perRoom + perCell * (cells - 1)) * (kind === 'hall' ? hallFactor : 1))
}

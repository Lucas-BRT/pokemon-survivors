import { weightedPick, type Rng } from '../engine/rng'

/**
 * The cave's levels (1 to 5): each entrance on the map is drawn with one, shown on its mouth, and the deeper the level the bigger and
 * deadlier the dungeon and the richer what it holds. Level 1 is the cave as it always was. Everything here is data for `game/cave.ts`,
 * `game/dungeon.ts` and `game/caveShop.ts`; the lines live in `i18n` (`places.caveLevel`).
 */
export const CAVE_LEVEL_COUNT = 5

export type CaveLevel = {
  /** Floors with stairs; the treasure chamber comes after them. */
  floors: number
  /** Cells added to a floor's grid (columns first, then rows, one each in turn), and extra big rooms and ambush rooms per floor. */
  grid: number
  big: number
  ambush: number
  /** Extra items lying around each floor. */
  items: number
  /** Floors the ambush packs are shifted down (a deeper, tougher species list), their size multiplier, and how many cells fewer a room needs for its leader. */
  packShift: number
  packSize: number
  leaderCells: number
  /** Multiplier on the dark's spawn rate and on every floor's clock (the wind). */
  spawn: number
  time: number
  /** Share of a floor's crystals kept (fewer lights, a darker cave). */
  crystals: number
  /** Hidden traps per floor (a telegraphed rockfall when stepped on), and Monster House foes added. */
  traps: number
  house: number
  reward: {
    /** Extra ₽ coins (of 50) in every prize pile and extra gems and item rolls beside them. */
    coins: number
    gems: number
    items: number
    /** Extra item rolls from the final chest, extra Rare Candies, and the egg its treasure leaves: the source of `EGG_SOURCES`. */
    chestItems: number
    chestCandies: number
    egg: 'place' | 'rift' | 'final'
    /** Extra wares on the Cristalário's table, and extra odds (0..1) of the shiny Sableye there. */
    wares: number
    shiny: number
  }
}

/** A hidden trap goes off when a player's foot comes within `trigger` px of it. */
export const CAVE_TRAP = { trigger: 18 } as const

export const CAVE_LEVELS: readonly CaveLevel[] = [
  { floors: 3, grid: 0, big: 0, ambush: 0, items: 0, packShift: 0, packSize: 1, leaderCells: 0, spawn: 1, time: 1, crystals: 1, traps: 0, house: 0, reward: { coins: 0, gems: 0, items: 0, chestItems: 0, chestCandies: 0, egg: 'place', wares: 0, shiny: 0 } },
  { floors: 3, grid: 1, big: 1, ambush: 0, items: 1, packShift: 0, packSize: 1.25, leaderCells: 1, spawn: 1.15, time: 0.95, crystals: 1, traps: 2, house: 2, reward: { coins: 1, gems: 1, items: 0, chestItems: 1, chestCandies: 0, egg: 'place', wares: 0, shiny: 0.02 } },
  { floors: 4, grid: 2, big: 1, ambush: 1, items: 1, packShift: 1, packSize: 1.4, leaderCells: 1, spawn: 1.3, time: 0.9, crystals: 0.85, traps: 3, house: 4, reward: { coins: 2, gems: 2, items: 1, chestItems: 2, chestCandies: 1, egg: 'rift', wares: 1, shiny: 0.04 } },
  { floors: 4, grid: 3, big: 2, ambush: 1, items: 2, packShift: 1, packSize: 1.6, leaderCells: 2, spawn: 1.5, time: 0.85, crystals: 0.7, traps: 4, house: 7, reward: { coins: 3, gems: 3, items: 1, chestItems: 3, chestCandies: 2, egg: 'rift', wares: 1, shiny: 0.06 } },
  { floors: 5, grid: 4, big: 2, ambush: 2, items: 2, packShift: 2, packSize: 1.8, leaderCells: 2, spawn: 1.7, time: 0.8, crystals: 0.55, traps: 5, house: 10, reward: { coins: 4, gems: 4, items: 2, chestItems: 4, chestCandies: 3, egg: 'final', wares: 2, shiny: 0.1 } },
]

/** The settings of level `n` (1 to 5; anything else is clamped). */
export const caveLevel = (n: number): CaveLevel => CAVE_LEVELS[Math.max(1, Math.min(CAVE_LEVEL_COUNT, Math.floor(n))) - 1]!

/**
 * Odds of each level for a cave opening at `minute` of the run: the deep ones only come late, and the first caves are mostly shallow.
 * `from` is the minute a level may first appear, `weight` how likely it is once open.
 */
export const CAVE_LEVEL_ODDS = [
  { from: 0, weight: 5 },
  { from: 3, weight: 4 },
  { from: 8, weight: 3 },
  { from: 13, weight: 2 },
  { from: 18, weight: 1.2 },
] as const

/** Draws the level of a cave opening at `time` seconds into the run (from an rng of its own, so the run's stream is left alone; later caves lean deeper). */
export const drawCaveLevel = (rng: Rng, time: number): number => {
  const minute = time / 60
  const open = CAVE_LEVEL_ODDS.map((o, i) => [i + 1, minute >= o.from ? o.weight * (1 + (i * minute) / 40) : 0] as const).filter(([, w]) => w > 0)
  return weightedPick(rng, open)
}

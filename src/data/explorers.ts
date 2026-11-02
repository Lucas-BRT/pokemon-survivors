import type { EnemyId } from './enemies'

/**
 * Explorers, the dungeon-only mode (`docs/explorers.md`): a run that goes down floor after floor, the theme changing every
 * `bossEvery` floors, a boss ending each block and a sub-boss every `subbossEvery` floors. Pure data and arithmetic on the depth
 * (1 is the first floor), so the rules (`game/explorers.ts`) and the screens ask the same table.
 */
export const EXPLORERS = {
  /** A boss guards every this-many floors' stairs, and the theme changes after it. */
  bossEvery: 20,
  /** A sub-boss guards the stairs of every this-many floors (the boss's floors are the boss's). */
  subbossEvery: 5,
  /** How much stronger the foes are per floor down: `power = 1 + perFloor × (depth − 1)`, and `perCycle` more for each time the themes have all been seen. */
  curve: { perFloor: 0.04, perCycle: 0.5 },
  /** The floor kinds that aren't fights, as `[every, offset]`: depth `d` is that kind when `d % every === offset`. The first match in `SPECIAL_ORDER` wins; boss and sub-boss floors come before all of them. */
  /** A floor's clock in seconds: `start` on the first, `perFloor` more each floor down, never under `min`. Zero ends the run. */
  clock: { start: 240, perFloor: -2, min: 120 },
  /** The cave level (1 to 5, `caveLevels.ts`) whose generator settings (grid size, big rooms, ambush rooms) a floor uses: one more every `levelEvery` floors. */
  generator: { levelEvery: 8 },
  /** Foes placed once, when a floor is laid out: `perRoom` in each room plus `perCell` for every grid cell past its first; a hall floor's rooms hold `hallFactor` times that. */
  population: { perRoom: 2, perCell: 1, hallFactor: 2 },
  special: { rest: [5, 1], market: [10, 3], hall: [7, 4], corridor: [6, 2] },
} as const

/** A floor's kind: what the team finds in it. */
export type FloorKind = 'normal' | 'subboss' | 'boss' | 'rest' | 'market' | 'hall' | 'corridor'

/** Which special kind wins when two fall on one floor. */
export const SPECIAL_ORDER = ['rest', 'market', 'hall', 'corridor'] as const satisfies readonly FloorKind[]

/** The shapes a floor's rooms may take instead of a rectangle (`game/roomShapes.ts`). */
export const ROOM_SHAPES = ['round', 'hex', 'diamond', 'ell', 'cross', 'ushape'] as const
export type RoomShape = (typeof ROOM_SHAPES)[number]

export type ExplorerThemeId = 'field' | 'forest' | 'cave'

/** How a theme's floors press the clock: the wind of the open air, or the cave's rockfall (the screen shakes, dust falls). */
export type ClockStyle = 'wind' | 'collapse'

/** How much of a theme's floors the dark covers: none (the open field), patches of faint shade (the forest) or all of it (the cave). */
export type DarkStyle = 'none' | 'patchy' | 'full'

export type ExplorerTheme = {
  clock: ClockStyle
  dark: DarkStyle
  /** The Pokémon that live here, with the depth (in floors into the theme's block, 1 to `bossEvery`) from which each one shows up. */
  species: ReadonlyArray<readonly [EnemyId, number]>
  /** The sub-boss of the theme (the floors that are multiples of `subbossEvery`) and its block's boss. */
  subboss: EnemyId
  boss: EnemyId
  /** The share (0 to 1) of a floor's rooms that aren't rectangles, and which shapes they take, by weight. */
  shapeShare: number
  shapes: ReadonlyArray<readonly [RoomShape, number]>
}

/** The three themes of the first release, in the order a run goes through them (and then around again, stronger). */
export const EXPLORER_THEMES = {
  field: {
    clock: 'wind',
    dark: 'none',
    species: [['caterpie', 1], ['weedle', 1], ['rattata', 1], ['pidgey', 1], ['sentret', 3], ['ledyba', 3], ['spinarak', 3], ['wurmple', 3], ['spearow', 6], ['metapod', 8], ['kakuna', 8], ['hoothoot', 10], ['butterfree', 14], ['beedrill', 14]],
    subboss: 'butterfree',
    boss: 'snorlax',
    shapeShare: 0.15,
    shapes: [['round', 3], ['hex', 1]],
  },
  forest: {
    clock: 'wind',
    dark: 'patchy',
    species: [['oddish', 1], ['paras', 1], ['venonat', 1], ['bellsprout', 1], ['pidgeotto', 4], ['gloom', 4], ['weepinbell', 6], ['exeggcute', 6], ['ariados', 8], ['ledian', 8], ['parasect', 10], ['teddiursa', 10], ['pinsir', 13], ['scyther', 13], ['tangela', 15], ['heracross', 15]],
    subboss: 'pinsir',
    boss: 'trevenantBoss',
    shapeShare: 0.4,
    shapes: [['round', 3], ['hex', 2], ['diamond', 1], ['ell', 2]],
  },
  cave: {
    clock: 'collapse',
    dark: 'full',
    species: [['zubat', 1], ['geodude', 1], ['sableye', 3], ['golbat', 5], ['onix', 8], ['graveler', 10], ['golem', 14]],
    subboss: 'golem',
    boss: 'onix',
    shapeShare: 0.75,
    shapes: [['round', 2], ['hex', 2], ['diamond', 2], ['ell', 2], ['cross', 2], ['ushape', 1]],
  },
} as const satisfies Record<ExplorerThemeId, ExplorerTheme>

/** The order a run meets the themes in. */
export const EXPLORER_ORDER = ['field', 'forest', 'cave'] as const satisfies readonly ExplorerThemeId[]

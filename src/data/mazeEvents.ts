import type { BiomeId } from './biomes'
import type { EnemyId } from './enemies'

/**
 * What happens in the overworld's hedge maze (`game/mazeRun.ts`; the maze itself is `data/landmarks.ts`'s `MAZE`): its dead ends hold
 * traps, small chests, a decoy chest and (sometimes) keys and a pair of rings; Pokémon hide in its hedges; the chest at its heart wakes a
 * guardian; and each biome gives it a rule of its own. Lines live in `i18n` (`landmarks.maze`).
 */

/** What a biome's maze is like: who hides in the hedges, who guards the chest and the rule of the ground and light inside. */
export type MazeKind = {
  hide: readonly EnemyId[]
  guard: readonly EnemyId[]
  /** `plain` nothing more, `ice` a slippery floor, `webs` a floor that slows everyone (webs and vines), `dark` the maze lit only round the players. */
  rule: 'plain' | 'ice' | 'webs' | 'dark'
}

export const MAZE_CAST = {
  meadow: { hide: ['foongus', 'bramblin', 'maractus'], guard: ['tangrowth'], rule: 'plain' },
  forest: { hide: ['carnivine', 'ferroseed', 'bramblin', 'joltik', 'galvantula'], guard: ['tangrowth', 'seismitoad'], rule: 'webs' },
  cave: { hide: ['dwebble', 'galvantula', 'trubbish', 'croagunk'], guard: ['golurk', 'bisharp'], rule: 'dark' },
  snow: { hide: ['vanillite', 'cryogonal'], guard: ['beartic', 'avalugg'], rule: 'ice' },
  tower: { hide: ['yamask', 'greavard', 'bramblin'], guard: ['cofagrigus'], rule: 'dark' },
} as const satisfies Record<BiomeId, MazeKind>

export const MAZE_RUN = {
  /** Px from a maze's box a player comes to before its run is built and its contents start to matter. */
  wake: 320,
  /** A chest, a key or a ring is touched this close (px); a hidden trap shows itself at `trapReveal`; a hidden Pokémon springs out at `ambushRadius`. */
  touch: 18,
  trapReveal: 44,
  ambushRadius: 38,
  /** Seconds standing at a chest to open it. */
  openTime: 0.6,
  /** Odds the heart's chest is locked behind keys, and how many keys it takes. */
  lockOdds: 0.6,
  keys: 3,
  /** The thieves that come for a key, one by one. */
  thieves: ['purrloin', 'pawniard'] as readonly EnemyId[],
  /** Odds that a small chest is a decoy, how many small chests the dead ends hold (the chambers each keep one more) and how many pairs of rings. */
  decoyOdds: 0.45,
  caches: 5,
  ringPairs: 2,
  /** The rare guardian (a legendary of the forest, in the meadow or the forest). */
  rare: { guard: 'virizion' as EnemyId, odds: 0.08, biomes: ['meadow', 'forest'] as readonly BiomeId[] },
  /** Pokémon hiding in the hedges: this many, plus one for every `perMinutes`, at most `max`. */
  hidden: { base: 8, perMinutes: 3, max: 16 },
  /** What a small chest holds: ₽ coins (of 50) and an item roll. */
  cacheCoins: 2,
  /** Seconds standing in a ring to step through it. */
  ringTime: 0.45,
  /** The heart's treasure: ₽ coins (of 50) and item rolls, and an egg. */
  heartCoins: 5,
  heartItems: 2,
} as const

/**
 * The big hedge maze, a site in the overworld (`game/grandMaze.ts`): `size`×`size` cells of `cell` px, each corridor `cell - wall` px wide
 * between hedges `wall` px thick, bigger than a screen, with several ways in. The terrain's cells are grouped in blocks of `block`×`block`;
 * a block holds one maze with chance `odds`, its box centered in `footprint`×`footprint` cells kept clear of scenery. Nothing within
 * `clearStart` px of the run's start (its box would crowd it).
 */
export const GRAND = {
  cell: 64,
  wall: 16,
  size: 29,
  block: 12,
  odds: 0.45,
  footprint: 7,
  clearStart: 1100,
  /** The heart's courtyard: an open square (cells a side) in the middle, ringed by four wings in a pinwheel around it. */
  court: 7,
  /** How each kind of wing is carved: `newest` is the growing tree's odds of continuing from the newest cell (1: long winding corridors, 0: many short branches), `braid` the share of dead ends given a second way out, `rooms` the open halls cut in it, `islands` the hedge islands in an open field (the garden). */
  wings: {
    avenues: { newest: 0.97, braid: 0.7, rooms: 0, islands: 0 },
    thicket: { newest: 0.3, braid: 0.1, rooms: 0, islands: 0 },
    halls: { newest: 0.8, braid: 0.5, rooms: 2, islands: 0 },
    garden: { newest: 0, braid: 0, rooms: 0, islands: 22 },
  },
  /** Side (cells) of a hall, and of the clearing left in the garden. */
  roomSize: 3,
  entrances: [4, 5],
  /** How many corridor steps the light of a player reaches, and the share of it each step keeps (a stepped, pixel-dithered fall-off). */
  reach: 5,
  falloff: [1, 0.94, 0.78, 0.58, 0.36, 0.16],
  /** How much of a lit cell's light leaks over a hedge into the cell beyond it (0..1), so the shade fades across the hedge instead of cutting at it. */
  leak: 0.4,
  /** What a cell the player has seen keeps of the light (0..1): a faint memory. */
  memory: 0.2,
} as const

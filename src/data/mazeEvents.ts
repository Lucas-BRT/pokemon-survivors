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
  /** Px from the maze's anchor a player comes to before its run is built and its dead ends start to matter. */
  wake: 300,
  /** A chest, a decoy or a trap is triggered this close (px); a hidden Pokémon springs out at `ambushRadius`. */
  touch: 16,
  ambushRadius: 34,
  /** Seconds standing at a small chest to open it. */
  openTime: 0.6,
  /** Odds the heart's chest is locked behind keys, and how many keys it takes. */
  lockOdds: 0.5,
  keys: 2,
  /** The thieves that come for a key, one by one. */
  thieves: ['purrloin', 'pawniard'] as readonly EnemyId[],
  /** Odds of a decoy chest, of a pair of rings and of the rare guardian (a legendary of the forest, in the meadow or the forest). */
  decoyOdds: 0.7,
  ringOdds: 0.45,
  rare: { guard: 'virizion' as EnemyId, odds: 0.08, biomes: ['meadow', 'forest'] as readonly BiomeId[] },
  /** Dead ends beyond these are traps: half spikes, half bombs. */
  caches: 2,
  /** Pokémon hiding in the hedges: this many, plus one for every `perMinutes`, at most `max`. */
  hidden: { base: 2, perMinutes: 4, max: 5 },
  /** What a small chest holds: ₽ coins (of 50) and an item roll. */
  cacheCoins: 2,
  /** Seconds standing in a ring to step through it. */
  ringTime: 0.45,
  /** How far (px) the players' light reaches in a dark maze, and how dark it is. */
  vision: 78,
  dark: 0.9,
} as const

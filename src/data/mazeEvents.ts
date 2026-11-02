import type { BiomeId } from './biomes'
import type { EnemyId } from './enemies'
import { hash2 } from '../engine/rng'

/**
 * What happens in the overworld's hedge maze (`game/mazeRun.ts`; the maze itself is `data/landmarks.ts`'s `MAZE`): its dead ends hold
 * traps, small chests, a decoy chest and (sometimes) keys and a pair of rings; Pokémon hide in its hedges; the chest at its heart wakes a
 * guardian; and each biome gives it a rule of its own. Lines live in `i18n` (`landmarks.maze`).
 */

/** A maze's theme: the Pokémon that live in it are of one kind (a family, a type, a trade), so a maze reads as a place of its own. */
export type MazeTheme = {
  id: string
  /** Who lives in it: hides in the hedges, springs out of decoys and is spawned in the corridors while someone is inside. */
  hide: readonly EnemyId[]
  /** Who guards the heart's chest. */
  guard: readonly EnemyId[]
}

/** What a biome's mazes are like: the themes one of them draws (each maze has one, from its seed) and the rule of the ground inside. */
export type MazeKind = {
  themes: readonly MazeTheme[]
  /** `plain` nothing more, `ice` a slippery floor, `webs` a floor that slows everyone (webs and vines). */
  rule: 'plain' | 'ice' | 'webs'
}

export const MAZE_CAST = {
  meadow: {
    themes: [
      { id: 'spores', hide: ['foongus', 'bramblin', 'maractus'], guard: ['tangrowth'] },
      { id: 'bugs', hide: ['joltik', 'dwebble', 'galvantula'], guard: ['galvantula'] },
      { id: 'swamp', hide: ['croagunk', 'trubbish', 'seismitoad'], guard: ['seismitoad'] },
    ],
    rule: 'plain',
  },
  forest: {
    themes: [
      { id: 'thorns', hide: ['carnivine', 'ferroseed', 'bramblin', 'foongus'], guard: ['tangrowth'] },
      { id: 'webs', hide: ['joltik', 'galvantula', 'dwebble'], guard: ['galvantula'] },
      { id: 'swamp', hide: ['croagunk', 'trubbish', 'seismitoad'], guard: ['seismitoad'] },
    ],
    rule: 'webs',
  },
  cave: {
    themes: [
      { id: 'iron', hide: ['pawniard', 'ferroseed', 'dwebble'], guard: ['bisharp'] },
      { id: 'junk', hide: ['trubbish', 'croagunk', 'purrloin'], guard: ['golurk'] },
      { id: 'webs', hide: ['joltik', 'galvantula', 'dwebble'], guard: ['galvantula'] },
    ],
    rule: 'plain',
  },
  snow: {
    themes: [
      { id: 'ice', hide: ['vanillite', 'cryogonal'], guard: ['avalugg', 'beartic'] },
      { id: 'bandits', hide: ['purrloin', 'pawniard', 'vanillite'], guard: ['bisharp'] },
    ],
    rule: 'ice',
  },
  tower: {
    themes: [
      { id: 'spirits', hide: ['yamask', 'greavard', 'bramblin'], guard: ['cofagrigus'] },
      { id: 'golems', hide: ['ferroseed', 'dwebble', 'pawniard'], guard: ['golurk'] },
    ],
    rule: 'plain',
  },
} as const satisfies Record<BiomeId, MazeKind>

/** Every theme id, in a fixed order: the `enter` event carries a theme's place in it (the shell names it from `landmarks.maze.themes`). */
export const MAZE_THEME_IDS = ['spores', 'bugs', 'swamp', 'thorns', 'webs', 'iron', 'junk', 'ice', 'bandits', 'spirits', 'golems'] as const

/** The theme of the maze with this seed in a biome: drawn from the seed alone, so every client and the replay agree. */
export const mazeTheme = (biome: BiomeId, seed: number): MazeTheme => {
  const themes: readonly MazeTheme[] = MAZE_CAST[biome].themes
  return themes[Math.floor(hash2(seed, 7, 41) * themes.length)]!
}

export const MAZE_RUN = {
  /** Px from a maze's box a player comes to before its run is built and its contents start to matter. */
  wake: 320,
  /** A chest, a key or a ring is touched this close (px); a hidden trap shows itself at `trapReveal`; a hidden Pokémon springs out at `ambushRadius`. */
  touch: 18,
  trapReveal: 44,
  ambushRadius: 38,
  /** The maze's own Pokémon that live in its corridors while someone is inside: this many, plus one for every `perMinutes` of the run, at most `max`, one more every `every` seconds, never closer than `away` px to a player nor in a straight line from one. */
  live: { base: 6, perMinutes: 2, max: 18, every: 2.5, away: 220 },
  /** Seconds standing at a chest to open it. */
  openTime: 1.5,
  /** Px from a chest's middle inside which standing opens it (the ring drawn on the ground). */
  chestRadius: 30,
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
  /** How far (px) a player sees a chest, a key or a Pokémon down a straight corridor, and how many corridor steps around them the minimap remembers. */
  sight: 360,
  reach: 3,
} as const

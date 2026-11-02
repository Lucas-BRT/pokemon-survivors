import type { DropSource } from './consumables'

/**
 * Landmarks: the map's points of interest. Each stands in a terrain cell the
 * way a mountain or a lake does (`game/terrain.ts` places them from the run's
 * seed, so the replay rebuilds the same map) and wears the biome's skin: an
 * abandoned cottage to walk into, a tunnel through a ridge, a hedge maze,
 * Unown ruins and an abandoned camp. Most keep a small treasure; the tunnel
 * takes whoever steps in out of its other mouth. Layouts are built in
 * `game/landmarkLayout.ts`, the rules in `game/landmarks.ts` and the art in
 * `render/landmarkPieces.ts`. Names and lines live in `i18n` (`landmarks`).
 */
export const LANDMARK_IDS = ['cottage', 'tunnel', 'ruins', 'camp'] as const

export type LandmarkId = (typeof LANDMARK_IDS)[number]

export const LANDMARK = {
  /** At most one landmark per block of `block`×`block` terrain cells, in one of its cells drawn from the seed: they never crowd. */
  block: 3,
  /** Odds a block holds one. */
  odds: 0.8,
  /** Relative odds of each landmark (the hedge maze is a site of its own, `game/grandMaze.ts`). */
  weights: { cottage: 3, tunnel: 2, ruins: 2, camp: 3 } satisfies Record<LandmarkId, number>,
  /** Standing this close to a treasure for `openTime` seconds opens it. */
  treasureRadius: 20,
  openTime: 0.6,
  /** Coming this close to a landmark names it on screen, once per landmark. */
  spotRadius: 150,
} as const

/** The tunnel: stand in one mouth to come out of the other, the horde left behind the ridge. */
export const TUNNEL = {
  /** Radius of a mouth's door (px) and the seconds standing in it to step in. */
  mouth: 12,
  enterTime: 0.4,
  /** Seconds underground. */
  travel: 1.3,
  /** Px south of the far mouth where the player comes out. */
  exitStep: 14,
} as const

/** What each landmark's treasure holds: ₽ coins (of `COIN_VALUES[1]`), item rolls, Oran Berries, Exp. Candy (in levels' worth) and an egg's chance. */
export type LandmarkLoot = { coins: number; drops: readonly DropSource[]; berries?: number; xp?: number; egg?: true }

export const LANDMARK_LOOT = {
  /** An old crate in the cottage's corner. */
  cottage: { coins: 2, drops: ['itemBall'] },
  /** The ruins' altar: the Unown's glyphs light up and spill Exp. Candy. */
  ruins: { coins: 1, drops: [], xp: 0.6 },
  /** A backpack someone left by the fire. */
  camp: { coins: 1, drops: ['berryTree'], berries: 2 },
} as const satisfies Partial<Record<LandmarkId, LandmarkLoot>>

export type TreasureLandmark = keyof typeof LANDMARK_LOOT

/**
 * Pieces of landmarks, sculpted per biome. `wallN`, `wallW`, `wallE` and
 * `wallS` are the cottage's walls (`wallS` in two halves around the door),
 * `hedge` one row of the maze, `ridge` the tunnel's mountain. The treasure
 * pieces (`crate`, `chest`, `altar`, `pack`) show open once looted.
 */
export type LandmarkPiece =
  | 'wallN' | 'wallW' | 'wallE' | 'wallS' | 'well' | 'fence' | 'crate' | 'table' | 'bed'
  | 'ridge' | 'cart'
  | 'chest' | 'mazeWall'
  | 'menhir' | 'altar' | 'column'
  | 'tent' | 'campfire' | 'log' | 'pack'

/** Flat art under a landmark (floors, paths, a plaza), drawn with the ground like a lake. */
export type LandmarkGround = 'floor' | 'rails' | 'plaza' | 'camp'

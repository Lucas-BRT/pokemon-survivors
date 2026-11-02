import type { EnemyId } from './enemies'

/**
 * Switches and numbers of the generated places (experiment, `docs/experiments/`).
 * The generators live in `game/procgen/`; flipping a switch off brings the old
 * hand-made layout back, so both can be compared on the same seed.
 */
export const PROCGEN = {
  /** Hedge mazes drawn from `generateMaze` instead of the six fixed patterns. */
  maze: true,
  /** Caves drawn by `generateFloorV2`: bigger floors, three of them, a clock per floor and ambush rooms. */
  cave: true,
  /** The generated maze's cells per side: a landmark fits `TERRAIN.cell - 2 * margin` = 244 px, so 7 cells of 32 px at most. */
  mazeSize: 7,
  /** How many distinct generated mazes a run's landmarks pick from (each is built once, by seed). */
  mazePatterns: 12,
  /** The growing tree's styles, taken in turn: long winding corridors, then more branches and loops. */
  mazeStyles: [
    { newest: 0.9, braid: 0 },
    { newest: 0.7, braid: 0.2 },
    { newest: 0.5, braid: 0.3 },
    { newest: 0.8, braid: 0.1 },
  ],
} as const

/** An ambush room's pack: the wild Pokémon it throws, how many by the room's size, and the leader of the deeper floors. */
export type CavePack = {
  /** The species the pack is drawn from (themed by depth). */
  mob: readonly EnemyId[]
  /** Pokémon in a one-cell room, and each extra cell of the room's size adds `perCell`. */
  base: number
  perCell: number
  /** A leader that comes with the pack in a room of at least `minCells` cells: an Alpha, or a plain tough Pokémon. */
  leader: { kind: EnemyId; minCells: number; alpha: boolean } | null
}

/** The generated cave's numbers (`game/dungeon.ts` `generateFloorV2`, `game/cave.ts`), by floor (the last entry serves the floors after it). */
export const CAVE_GEN = {
  /** Cells of rooms per floor; each cell is `DUNGEON.cell` px. */
  grids: [{ cols: 4, rows: 3 }, { cols: 4, rows: 4 }, { cols: 5, rows: 4 }],
  /** Big rooms per floor, and the shapes they may take (cells wide × cells tall): the ambush rooms are chosen among them. */
  big: [2, 3, 3],
  /** The most of a floor's cells its big rooms may take, so regular rooms and corridors are never squeezed out. */
  bigShare: 0.45,
  shapes: [
    [[2, 1], [1, 2], [2, 2]],
    [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]],
    [[2, 1], [2, 2], [3, 2], [2, 3], [3, 3]],
  ] as readonly (readonly (readonly [number, number])[])[],
  /** Share of a floor's cells left without a room (never one that would split the rest), so floors are not plain rectangles. */
  drop: [0.15, 0.2, 0.25],
  /**
   * Corridors added on top of the spanning tree, as a share of those that could be: loops, routes to choose from.
   * The stairs room never takes part in one: it hangs off a single corridor, so there is one way in.
   */
  loops: 0.3,
  /** Ambush rooms per floor (never more than the floor has big rooms to keep them in): a prize lies in each, more in bigger ones. */
  ambush: [1, 2, 2],
  /** Items lying around each floor, besides the ambush prizes. */
  items: [2, 3, 3],
  /** Seconds on each floor's clock, and the treasure chamber's. The wind warns when the clock is down to `wind`. */
  floorTime: [75, 90, 105],
  chamberTime: 60,
  wind: [30, 15, 6],
  /** Extra spawn rate per floor down (a share of the first floor's). */
  spawnPerFloor: 0.2,
  /** The ambush packs by floor: many weak ones up top, a leader with its own below. Never more than `packMax` in all. */
  packs: [
    { mob: ['zubat', 'diglett', 'geodude'], base: 6, perCell: 3, leader: null },
    { mob: ['geodude', 'roggenrola', 'aron'], base: 5, perCell: 2, leader: { kind: 'graveler', minCells: 4, alpha: true } },
    { mob: ['geodude', 'graveler', 'roggenrola'], base: 5, perCell: 2, leader: { kind: 'onix', minCells: 6, alpha: false } },
  ] as readonly CavePack[],
  packMax: 22,
} as const

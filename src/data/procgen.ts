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

/** The generated cave's numbers (`game/dungeon.ts` `generateFloorV2`, `game/cave.ts`), by floor (the last entry serves the floors after it). */
export const CAVE_GEN = {
  /** Cells of rooms per floor; each cell is `DUNGEON.cell` px. */
  grids: [{ cols: 4, rows: 3 }, { cols: 4, rows: 4 }, { cols: 5, rows: 4 }],
  /** Share of a floor's cells left without a room (never one that would split the rest), so floors are not plain rectangles. */
  drop: [0.15, 0.2, 0.25],
  /** Corridors added on top of the spanning tree, as a share of those that could be (at least one): routes to choose from. */
  loops: 0.3,
  /** Ambush rooms per floor: a prize lies in each, and the first step in springs the dark's pack. */
  ambush: [1, 2, 2],
  /** Items lying around each floor, besides the ambush prizes. */
  items: [2, 3, 3],
  /** Seconds on each floor's clock, and the treasure chamber's. The wind warns when the clock is down to `wind`. */
  floorTime: [75, 90, 105],
  chamberTime: 60,
  wind: [30, 15, 6],
  /** Extra spawn rate per floor down (a share of the first floor's). */
  spawnPerFloor: 0.2,
  /** The ambush pack: this many wild Pokémon, plus `perFloor` for each floor down. */
  pack: { base: 4, perFloor: 2 },
} as const

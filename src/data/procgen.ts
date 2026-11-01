/**
 * Switches and numbers of the generated places (experiment, `docs/experiments/`).
 * The generators live in `game/procgen/`; flipping a switch off brings the old
 * hand-made layout back, so both can be compared on the same seed.
 */
export const PROCGEN = {
  /** Hedge mazes drawn from `generateMaze` instead of the six fixed patterns. */
  maze: true,
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

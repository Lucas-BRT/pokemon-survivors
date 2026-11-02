/**
 * Dev-only knobs the debug menu (F4, `ui/debugMenu.ts`) turns while a run plays. Every one rests at 1, so the simulation is exactly
 * what it was unless a developer moves one; debug runs are never ranked.
 */
export const DEBUG_TUNE = {
  /** Multipliers on the horde's spawn rate and cap in the overworld. */
  world: 1,
  cap: 1,
  /** The same inside a place (the cave's dark spawns) and in a hedge maze's corridors (rate and cap together). */
  place: 1,
  placeCap: 1,
  maze: 1,
}

export const resetTune = () => {
  DEBUG_TUNE.world = 1
  DEBUG_TUNE.cap = 1
  DEBUG_TUNE.place = 1
  DEBUG_TUNE.placeCap = 1
  DEBUG_TUNE.maze = 1
}

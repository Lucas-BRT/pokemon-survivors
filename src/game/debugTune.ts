import type { PlayerStats } from './stats'

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
  /** Multiplier on the seconds a cave light source stays on once touched. */
  source: 1,
}

export const resetTune = () => {
  DEBUG_TUNE.world = 1
  DEBUG_TUNE.cap = 1
  DEBUG_TUNE.place = 1
  DEBUG_TUNE.placeCap = 1
  DEBUG_TUNE.maze = 1
  DEBUG_TUNE.source = 1
  for (const k of TUNED_STATS) delete DEBUG_STATS[k]
  DEBUG_RUN.scale = 1
  DEBUG_RUN.steps = 0
}

/** The stats the debug menu can add to (the numeric ones of `PlayerStats`). */
export const TUNED_STATS = ['maxHp', 'speed', 'might', 'area', 'cooldown', 'duration', 'amount', 'projectileSpeed', 'magnet', 'regen', 'armor', 'growth', 'greed', 'statusChance', 'statusDamage'] as const satisfies readonly (keyof PlayerStats)[]
export type TunedStat = (typeof TUNED_STATS)[number]

/** Amounts added to the player's stats after every recompute (`recomputeStats`); empty at rest. */
export const DEBUG_STATS: Partial<Record<TunedStat, number>> = {}

/** The run's clock for the shell's loop: `scale` times the real time (0 pauses), plus `steps` ticks to play at once (to step a paused run). */
export const DEBUG_RUN = { scale: 1, steps: 0 }

/** Adds the debug deltas to freshly computed stats. */
export const applyDebugStats = (stats: PlayerStats) => {
  for (const k of TUNED_STATS) {
    const d = DEBUG_STATS[k]
    if (d) stats[k] += d
  }
}

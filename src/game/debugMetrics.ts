/**
 * Dev-only timings of the shell's loop, read by the debug menu's Metrics tab (`ui/debugMetrics.ts`). Each series keeps its last
 * `KEEP` samples, in ms (steps per frame for `steps`). The shell pushes to them only in dev builds.
 */
export const KEEP = 240

export const METRICS = {
  /** Time between two frames (what the display delivers). */
  frame: [] as number[],
  /** CPU time one frame took in the shell (steps, drawing, HUD), for frames that moved the run. */
  work: [] as number[],
  /** Time the simulation steps of a frame took. */
  step: [] as number[],
  /** Time drawing the world took. */
  draw: [] as number[],
  /** Simulation ticks played in a frame. */
  steps: [] as number[],
  /** The slowest frame work seen since the last reset, and when (run time). */
  worst: { ms: 0, at: 0 },
}

export const sample = (series: number[], value: number) => {
  series.push(value)
  if (series.length > KEEP) series.shift()
}

export const resetMetrics = () => {
  for (const k of ['frame', 'work', 'step', 'draw', 'steps'] as const) METRICS[k].length = 0
  METRICS.worst = { ms: 0, at: 0 }
}

/** The average, the 95th percentile and the worst of a series. */
export const stats = (series: readonly number[]) => {
  if (series.length === 0) return { avg: 0, p95: 0, max: 0 }
  const sorted = [...series].sort((a, b) => a - b)
  return { avg: series.reduce((a, b) => a + b, 0) / series.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!, max: sorted[sorted.length - 1]! }
}

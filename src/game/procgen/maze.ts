import type { Rng } from '../../engine/rng'

/**
 * Generated mazes for the experiments in `docs/experiments/`. Pure and
 * seeded: the same rng gives the same maze, and only integer arithmetic and
 * array walks are used, so every engine agrees (the simulation may build these).
 *
 * A maze is `cols`×`rows` cells. `h[r][c]` is the wall on the north side of
 * cell (c, r) (row `rows` is the south edge) and `v[r][c]` the one on its west
 * side (column `cols` is the east edge): the same convention as `MazeWalls`
 * in `game/landmarkLayout.ts`, so a maze can be drawn by the same art.
 */
export type MazeGrid = { cols: number; rows: number; h: boolean[][]; v: boolean[][] }

export type Cell = { c: number; r: number }

/** A way out of a cell: its step and which wall it crosses. */
const DIRS = [
  { dc: 0, dr: -1 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
] as const

/** A maze with every wall standing. */
export const solidMaze = (cols: number, rows: number): MazeGrid => ({
  cols,
  rows,
  h: Array.from({ length: rows + 1 }, () => Array<boolean>(cols).fill(true)),
  v: Array.from({ length: rows }, () => Array<boolean>(cols + 1).fill(true)),
})

/** Whether one can step from (c, r) by (dc, dr): no wall on that side. */
export const canStep = (m: MazeGrid, c: number, r: number, dc: number, dr: number) =>
  dr === -1 ? !m.h[r]![c]! : dr === 1 ? !m.h[r + 1]![c]! : dc === -1 ? !m.v[r]![c]! : !m.v[r]![c + 1]!

/** Takes down the wall on that side of (c, r). */
const knock = (m: MazeGrid, c: number, r: number, dc: number, dr: number) => {
  if (dr === -1) m.h[r]![c] = false
  else if (dr === 1) m.h[r + 1]![c] = false
  else if (dc === -1) m.v[r]![c] = false
  else m.v[r]![c + 1] = false
}

const inside = (m: MazeGrid, c: number, r: number) => c >= 0 && r >= 0 && c < m.cols && r < m.rows

/** How many of a cell's sides are open (the maze's outside counts when its edge wall is down). */
export const openings = (m: MazeGrid, c: number, r: number) => DIRS.reduce((n, d) => n + (canStep(m, c, r, d.dc, d.dr) ? 1 : 0), 0)

/**
 * Carves a perfect maze with the growing tree: every step takes the newest
 * cell of the active list with odds `newest` and a random one otherwise.
 * `newest` 1 is the depth-first backtracker (long winding corridors), 0 is
 * Prim's (many short dead ends); in between is a dial for the maze's feel.
 */
export const growingTree = (rng: Rng, cols: number, rows: number, newest: number): MazeGrid => {
  const m = solidMaze(cols, rows)
  const seen = Array<boolean>(cols * rows).fill(false)
  const start = Math.floor(rng() * cols * rows)
  const active = [start]
  seen[start] = true
  while (active.length > 0) {
    const i = rng() < newest ? active.length - 1 : Math.floor(rng() * active.length)
    const cell = active[i]!
    const c = cell % cols
    const r = Math.floor(cell / cols)
    const free = DIRS.filter((d) => inside(m, c + d.dc, r + d.dr) && !seen[(r + d.dr) * cols + c + d.dc])
    if (free.length === 0) {
      active.splice(i, 1)
      continue
    }
    const d = free[Math.floor(rng() * free.length)]!
    knock(m, c, r, d.dc, d.dr)
    const next = (r + d.dr) * cols + c + d.dc
    seen[next] = true
    active.push(next)
  }
  return m
}

/** Dead ends: cells with a single way out (the maze's outside counts as one when its edge wall is down). */
export const deadEnds = (m: MazeGrid): Cell[] => {
  const out: Cell[] = []
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (openings(m, c, r) === 1) out.push({ c, r })
  return out
}

/**
 * Braids the maze: about `share` of its dead ends get a second way out
 * through a wall to a neighbor, which makes loops (a choice of route, and no
 * long walk back from a wrong turn). Prefers a neighbor that is a dead end
 * too, so one cut cures two.
 */
export const braid = (rng: Rng, m: MazeGrid, share: number) => {
  const ends = deadEnds(m)
  for (let i = ends.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[ends[i], ends[j]] = [ends[j]!, ends[i]!]
  }
  for (const { c, r } of ends) {
    if (openings(m, c, r) !== 1 || rng() >= share) continue
    const walls = DIRS.filter((d) => inside(m, c + d.dc, r + d.dr) && !canStep(m, c, r, d.dc, d.dr))
    if (walls.length === 0) continue
    const lone = walls.filter((d) => openings(m, c + d.dc, r + d.dr) === 1)
    const pool = lone.length > 0 ? lone : walls
    const d = pool[Math.floor(rng() * pool.length)]!
    knock(m, c, r, d.dc, d.dr)
  }
}

/** Steps from (c0, r0) to every cell (row-major; -1 where it can't reach), with each cell's parent for walking back. */
export const distances = (m: MazeGrid, c0: number, r0: number) => {
  const dist = Array<number>(m.cols * m.rows).fill(-1)
  const parent = Array<number>(m.cols * m.rows).fill(-1)
  const queue = [r0 * m.cols + c0]
  dist[queue[0]!] = 0
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!
    const c = cell % m.cols
    const r = Math.floor(cell / m.cols)
    for (const d of DIRS) {
      if (!canStep(m, c, r, d.dc, d.dr)) continue
      const next = (r + d.dr) * m.cols + c + d.dc
      if (!inside(m, c + d.dc, r + d.dr) || dist[next]! >= 0) continue
      dist[next] = dist[cell]! + 1
      parent[next] = cell
      queue.push(next)
    }
  }
  return { dist, parent }
}

/** The outer edge cells, with the side each one faces out of. */
export const edgeCells = (m: MazeGrid) => {
  const out: { c: number; r: number; side: 0 | 1 | 2 | 3 }[] = []
  for (let c = 0; c < m.cols; c++) {
    out.push({ c, r: 0, side: 0 })
    out.push({ c, r: m.rows - 1, side: 2 })
  }
  for (let r = 0; r < m.rows; r++) {
    out.push({ c: 0, r, side: 3 })
    out.push({ c: m.cols - 1, r, side: 1 })
  }
  return out
}

export type MazeLayout = { maze: MazeGrid; entrance: Cell & { side: 0 | 1 | 2 | 3 }; goal: Cell }

/**
 * Picks the way in and the treasure: the pair, an edge cell and any cell,
 * with the longest walk between them, so the heart is never a few steps from
 * the door (the walk is at least half the maze's diameter, since no cell is
 * closer to everything than that). Ties go to the first in a seeded shuffle.
 * Opens the way in on the edge wall.
 */
export const placeEnds = (rng: Rng, maze: MazeGrid): MazeLayout => {
  const edges = edgeCells(maze)
  for (let i = edges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[edges[i], edges[j]] = [edges[j]!, edges[i]!]
  }
  let best = { edge: edges[0]!, goal: 0, steps: -1 }
  for (const edge of edges) {
    const { dist } = distances(maze, edge.c, edge.r)
    dist.forEach((steps, cell) => {
      if (steps > best.steps) best = { edge, goal: cell, steps }
    })
  }
  const { edge } = best
  const d = DIRS[edge.side]!
  knock(maze, edge.c, edge.r, d.dc, d.dr)
  return { maze, entrance: edge, goal: { c: best.goal % maze.cols, r: Math.floor(best.goal / maze.cols) } }
}

export type MazeStyle = {
  cols: number
  rows: number
  /** The growing tree's odds of continuing from the newest cell (1 = long corridors, 0 = many short branches). */
  newest: number
  /** Share of dead ends given a second way out. */
  braid: number
}

/** A maze of the given style, its way in and its treasure placed. */
export const generateMaze = (rng: Rng, style: MazeStyle): MazeLayout => {
  const maze = growingTree(rng, style.cols, style.rows, style.newest)
  if (style.braid > 0) braid(rng, maze, style.braid)
  return placeEnds(rng, maze)
}

export type MazeMetrics = {
  cells: number
  /** Steps from the way in to the treasure. */
  path: number
  /** The longest shortest walk between any two cells. */
  diameter: number
  /** `path` over `diameter`. */
  reach: number
  deadEnds: number
  /** Open walls beyond a spanning tree's: the number of independent loops. */
  loops: number
  /** Turns on the walk from the way in to the treasure. */
  turns: number
  /** Cells with three or four ways out. */
  junctions: number
  /** Dead ends off the shortest walk: the wrong turns one can end up in. */
  wrongTurns: number
}

/** What a layout is like, for comparing generators (`procgen/lab.test.ts`) and for tests. */
export const mazeMetrics = ({ maze, entrance, goal }: MazeLayout): MazeMetrics => {
  const n = maze.cols * maze.rows
  const from = distances(maze, entrance.c, entrance.r)
  const path = from.dist[goal.r * maze.cols + goal.c]!
  let diameter = 0
  for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) diameter = Math.max(diameter, Math.max(...distances(maze, c, r).dist))
  // Open inner walls = edges of the cell graph.
  let edges = 0
  for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) edges += (c + 1 < maze.cols && canStep(maze, c, r, 1, 0) ? 1 : 0) + (r + 1 < maze.rows && canStep(maze, c, r, 0, 1) ? 1 : 0)
  // Walk back from the treasure along parents to count turns and the cells on the way.
  const walk: number[] = []
  for (let cell = goal.r * maze.cols + goal.c; cell >= 0; cell = from.parent[cell]!) walk.push(cell)
  walk.reverse()
  let turns = 0
  for (let i = 2; i < walk.length; i++) {
    const a = walk[i - 2]!
    const b = walk[i - 1]!
    const c = walk[i]!
    if (b - a !== c - b) turns++
  }
  const onWalk = new Set(walk)
  const ends = deadEnds(maze)
  let junctions = 0
  for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) if (openings(maze, c, r) >= 3) junctions++
  // A dead end the walk doesn't end in, one step off a cell on the walk (the walk's own ends don't count).
  const wrong = ends.filter(({ c, r }) => !onWalk.has(r * maze.cols + c)).length
  return {
    cells: n,
    path,
    diameter,
    reach: diameter > 0 ? path / diameter : 1,
    deadEnds: ends.length,
    loops: edges - (n - 1),
    turns,
    junctions,
    wrongTurns: wrong,
  }
}

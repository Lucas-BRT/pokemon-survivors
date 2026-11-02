import { GRAND } from '../data/mazeEvents'
import { TERRAIN } from '../data/terrain'
import { createRng, hash2, type Rng } from '../engine/rng'
import { braid, canStep, distances, growingTree, type Cell, type MazeGrid } from './procgen/maze'
import * as dm from '../engine/dmath'

/**
 * The big hedge maze as pure data (`data/mazeEvents.ts`'s `GRAND`): a site in the overworld drawn from the run's terrain seed (so a
 * replay finds the same ones), its grid carved by the growing tree and braided, chambers opened in it, several ways in cut through its
 * outer hedge and the heart's chamber put as far from all of them as the maze allows. Everything here is integer or `dm` arithmetic and
 * arrays: the simulation (collision through the terrain's features, sight, the dwellers' paths) and the art read it.
 */

export type Side = 0 | 1 | 2 | 3

/** A chamber: a block of cells without hedges inside. */
export type Chamber = { c: number; r: number; w: number; h: number }

export type MazeSite = {
  /** The terrain cell key of its footprint's first cell, unique per site. */
  key: number
  /** The terrain cell (cx, cy) its footprint starts at (`GRAND.footprint` cells a side are kept clear of scenery). */
  fx: number
  fy: number
  /** The box the corridors fill, in world px: its north-west corner and side. */
  x: number
  y: number
  side: number
  maze: MazeGrid
  entrances: Array<Cell & { side: Side }>
  chambers: Chamber[]
  /** The chamber holding the heart's chest. */
  heart: number
  /** Steps from the nearest way in to each cell (row-major). */
  fromIn: number[]
  /** Seed of its own: its contents (`mazeRun.ts`) and its art (`render/mazeArt.ts`) draw from it. */
  seed: number
}

const P = GRAND.cell
const T = GRAND.wall

const shuffle = <A,>(rng: Rng, a: A[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Takes down the walls inside a chamber, so its cells make one open room. */
const carve = (m: MazeGrid, { c, r, w, h }: Chamber) => {
  for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) {
    if (cc > c) m.v[rr]![cc] = false
    if (rr > r) m.h[rr]![cc] = false
  }
}

/** Cuts the outer hedge at the edge cell `e`. */
const open = (m: MazeGrid, e: Cell & { side: Side }) => {
  if (e.side === 0) m.h[0]![e.c] = false
  else if (e.side === 2) m.h[m.rows]![e.c] = false
  else if (e.side === 3) m.v[e.r]![0] = false
  else m.v[e.r]![m.cols] = false
}

/** Builds the maze of a site from its own seed. */
const carveSite = (seed: number): Pick<MazeSite, 'maze' | 'entrances' | 'chambers' | 'heart' | 'fromIn'> => {
  const rng = createRng(seed)
  const n = GRAND.size
  const maze = growingTree(rng, n, n, GRAND.newest)
  braid(rng, maze, GRAND.braid)
  // Chambers, none touching another or the outer ring.
  const chambers: Chamber[] = []
  const rs = GRAND.roomSize
  for (let tries = 0; tries < GRAND.rooms * 12 && chambers.length < GRAND.rooms; tries++) {
    const c = 2 + Math.floor(rng() * (n - rs - 3))
    const r = 2 + Math.floor(rng() * (n - rs - 3))
    if (chambers.some((o) => Math.abs(o.c - c) < rs + 3 && Math.abs(o.r - r) < rs + 3)) continue
    chambers.push({ c, r, w: rs, h: rs })
  }
  for (const room of chambers) carve(maze, room)
  // The ways in: spread over the four sides, a corner's width apart.
  const count = GRAND.entrances[0] + Math.floor(rng() * (GRAND.entrances[1] - GRAND.entrances[0] + 1))
  const sides = shuffle(rng, [0, 1, 2, 3] as Side[])
  const entrances: Array<Cell & { side: Side }> = []
  for (let i = 0; i < count; i++) {
    const side = sides[i % 4]!
    for (let tries = 0; tries < 20; tries++) {
      const k = 3 + Math.floor(rng() * (n - 6))
      const e = side === 0 ? { c: k, r: 0, side } : side === 2 ? { c: k, r: n - 1, side } : side === 3 ? { c: 0, r: k, side } : { c: n - 1, r: k, side }
      if (entrances.some((o) => o.side === side && Math.abs(o.c - e.c) + Math.abs(o.r - e.r) < 8)) continue
      entrances.push(e)
      open(maze, e)
      break
    }
  }
  // Steps from the nearest way in, and the chamber farthest from all of them for the heart.
  const fromIn: number[] = Array<number>(n * n).fill(Infinity)
  for (const e of entrances) distances(maze, e.c, e.r).dist.forEach((d, i) => d >= 0 && d < fromIn[i]! && (fromIn[i] = d))
  let heart = 0
  chambers.forEach((room, i) => {
    const mid = fromIn[(room.r + 1) * n + room.c + 1]!
    if (mid > fromIn[(chambers[heart]!.r + 1) * n + chambers[heart]!.c + 1]!) heart = i
  })
  return { maze, entrances, chambers, heart, fromIn }
}

/** Sites by the run's terrain seed and block (`(bx, by)` packed in one number): pure, built once each. */
const sitesBySeed = new Map<number, Map<number, MazeSite | null>>()

/** The maze of terrain block (bx, by) for the run's terrain `seed`, if the block has one (pure; built once). */
export const mazeSiteAt = (seed: number, bx: number, by: number): MazeSite | null => {
  let sites = sitesBySeed.get(seed)
  if (!sites) sitesBySeed.set(seed, (sites = new Map()))
  const id = (bx & 0xffff) * 0x10000 + (by & 0xffff)
  const known = sites.get(id)
  if (known !== undefined) return known
  let site: MazeSite | null = null
  const B = GRAND.block
  const F = GRAND.footprint
  if (hash2(bx, by, seed + 9101) < GRAND.odds) {
    const ax = bx * B + Math.floor(hash2(bx, by, seed + 9102) * (B - F + 1))
    const ay = by * B + Math.floor(hash2(bx, by, seed + 9103) * (B - F + 1))
    const C = TERRAIN.cell
    const side = GRAND.size * P
    const x = ax * C + (F * C - side) / 2
    const y = ay * C + (F * C - side) / 2
    // Never over the start of the run.
    const nx = Math.max(x, Math.min(0, x + side))
    const ny = Math.max(y, Math.min(0, y + side))
    if (nx * nx + ny * ny >= GRAND.clearStart * GRAND.clearStart) {
      const own = dm.round(hash2(bx, by, seed + 9104) * 0x7fffffff)
      site = { key: ((ax & 0x7fff) << 15) | (ay & 0x7fff), fx: ax, fy: ay, x: dm.round(x), y: dm.round(y), side, seed: own, ...carveSite(own) }
    }
  }
  sites.set(id, site)
  return site
}

/** The maze whose footprint holds terrain cell (cx, cy), if any. */
export const mazeSiteOfCell = (seed: number, cx: number, cy: number): MazeSite | null => {
  const B = GRAND.block
  const site = mazeSiteAt(seed, Math.floor(cx / B), Math.floor(cy / B))
  if (!site) return null
  const F = GRAND.footprint
  const { fx, fy } = site
  return cx >= fx && cx < fx + F && cy >= fy && cy < fy + F ? site : null
}

/** The maze whose box holds the world point (x, y), if any: one block lookup, so cheap enough for every enemy every tick. */
export const mazeSiteAtPoint = (seed: number, x: number, y: number): MazeSite | null => {
  const span = TERRAIN.cell * GRAND.block
  const site = mazeSiteAt(seed, Math.floor(x / span), Math.floor(y / span))
  return site && inBox(site, x, y) ? site : null
}

/** Every maze with a part within `r` px of (x, y). */
export const mazeSitesNear = (seed: number, x: number, y: number, r: number): MazeSite[] => {
  const C = TERRAIN.cell
  const B = GRAND.block
  const out: MazeSite[] = []
  for (let by = Math.floor((y - r) / C / B) - 1; by <= Math.floor((y + r) / C / B) + 1; by++) {
    for (let bx = Math.floor((x - r) / C / B) - 1; bx <= Math.floor((x + r) / C / B) + 1; bx++) {
      const s = mazeSiteAt(seed, bx, by)
      if (s && x + r > s.x && x - r < s.x + s.side && y + r > s.y && y - r < s.y + s.side) out.push(s)
    }
  }
  return out
}

/** Whether (x, y) is inside the box of `site`. */
export const inBox = (site: MazeSite, x: number, y: number) => x >= site.x && y >= site.y && x < site.x + site.side && y < site.y + site.side

const hWall = (m: MazeGrid, r: number, c: number) => r >= 0 && r <= m.rows && c >= 0 && c < m.cols && m.h[r]![c]!
const vWall = (m: MazeGrid, r: number, c: number) => r >= 0 && r < m.rows && c >= 0 && c <= m.cols && m.v[r]![c]!

/** The cell holding (x, y), clamped to the grid. */
export const cellAt = (site: MazeSite, x: number, y: number): Cell => ({
  c: Math.max(0, Math.min(site.maze.cols - 1, Math.floor((x - site.x) / P))),
  r: Math.max(0, Math.min(site.maze.rows - 1, Math.floor((y - site.y) / P))),
})

/** The center of cell (c, r), in world px. */
export const cellCenter = (site: MazeSite, c: number, r: number) => ({ x: site.x + (c + 0.5) * P, y: site.y + (r + 0.5) * P })

/** Whether there is hedge at world (x, y): the walls `wall` px thick along every cell border, and a post where they meet. */
export const isHedge = (site: MazeSite, x: number, y: number) => {
  // The outer hedge is centered on the box's edge: half of it lies outside.
  if (x < site.x - T / 2 || y < site.y - T / 2 || x >= site.x + site.side + T / 2 || y >= site.y + site.side + T / 2) return false
  const m = site.maze
  const lx = x - site.x
  const ly = y - site.y
  const c = Math.floor(lx / P)
  const r = Math.floor(ly / P)
  const fx = lx - c * P
  const fy = ly - r * P
  const h = T / 2
  const west = fx < h
  const east = fx >= P - h
  const north = fy < h
  const south = fy >= P - h
  // Each corner of the cell: a post if any of the four hedges meeting there stands.
  if (north && west) return hWall(m, r, c) || hWall(m, r, c - 1) || vWall(m, r, c) || vWall(m, r - 1, c)
  if (north && east) return hWall(m, r, c) || hWall(m, r, c + 1) || vWall(m, r, c + 1) || vWall(m, r - 1, c + 1)
  if (south && west) return hWall(m, r + 1, c) || hWall(m, r + 1, c - 1) || vWall(m, r, c) || vWall(m, r + 1, c)
  if (south && east) return hWall(m, r + 1, c) || hWall(m, r + 1, c + 1) || vWall(m, r, c + 1) || vWall(m, r + 1, c + 1)
  if (north) return hWall(m, r, c)
  if (south) return hWall(m, r + 1, c)
  if (west) return vWall(m, r, c)
  if (east) return vWall(m, r, c + 1)
  return false
}

/** Whether the straight line between two world points is clear of hedge (sampled every 4 px). */
export const clearBetween = (site: MazeSite, ax: number, ay: number, bx: number, by: number) => {
  const d = dm.hypot(bx - ax, by - ay)
  const n = Math.ceil(d / 4)
  for (let i = 1; i < n; i++) if (isHedge(site, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false
  return true
}

/** How far a ray from (x, y) at `angle` goes before it meets hedge (at most `max` px), by 3 px steps. */
export const rayLength = (site: MazeSite, x: number, y: number, angle: number, max: number) => {
  const dx = dm.cos(angle)
  const dy = dm.sin(angle)
  for (let d = 3; d < max; d += 3) if (isHedge(site, x + dx * d, y + dy * d)) return d
  return max
}

/** A straight run of hedge, in world px, as the terrain's solids see it (a horizontal or vertical segment with its half thickness). */
export type Run = { x0: number; y0: number; x1: number; y1: number }

/** Every hedge of the maze as the longest straight runs, ends and posts included. */
export const hedgeRuns = (site: MazeSite): Run[] => {
  const m = site.maze
  const runs: Run[] = []
  for (let r = 0; r <= m.rows; r++) {
    let from = -1
    for (let c = 0; c <= m.cols; c++) {
      const on = c < m.cols && m.h[r]![c]!
      if (on && from < 0) from = c
      if (!on && from >= 0) {
        runs.push({ x0: site.x + from * P - T / 2, y0: site.y + r * P, x1: site.x + c * P + T / 2, y1: site.y + r * P })
        from = -1
      }
    }
  }
  for (let c = 0; c <= m.cols; c++) {
    let from = -1
    for (let r = 0; r <= m.rows; r++) {
      const on = r < m.rows && m.v[r]![c]!
      if (on && from < 0) from = r
      if (!on && from >= 0) {
        runs.push({ x0: site.x + c * P, y0: site.y + from * P - T / 2, x1: site.x + c * P, y1: site.y + r * P + T / 2 })
        from = -1
      }
    }
  }
  return runs
}

/** The way from cell (c, r) toward the nearest cell of `target` (a row-major step count map): the neighbor with the fewest steps left. */
export const stepToward = (site: MazeSite, dist: readonly number[], c: number, r: number): Cell | null => {
  const m = site.maze
  let best: Cell | null = null
  let steps = dist[r * m.cols + c]!
  for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    if (!canStep(m, c, r, dc, dr)) continue
    const nc = c + dc
    const nr = r + dr
    if (nc < 0 || nr < 0 || nc >= m.cols || nr >= m.rows) continue
    const d = dist[nr * m.cols + nc]!
    if (d >= 0 && d < steps) {
      steps = d
      best = { c: nc, r: nr }
    }
  }
  return best
}

/** The maze nearest to (x, y) among the blocks around it (the dev console's way to find one), or null. */
export const nearestMaze = (seed: number, x: number, y: number, blocks = 10): MazeSite | null => {
  const span = TERRAIN.cell * GRAND.block
  const bx0 = Math.floor(x / span)
  const by0 = Math.floor(y / span)
  let best: MazeSite | null = null
  let bestD = Infinity
  for (let by = by0 - blocks; by <= by0 + blocks; by++) {
    for (let bx = bx0 - blocks; bx <= bx0 + blocks; bx++) {
      const s = mazeSiteAt(seed, bx, by)
      if (!s) continue
      const d = dm.hypot(s.x + s.side / 2 - x, s.y + s.side / 2 - y)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
  }
  return best
}

import { GRAND } from '../data/mazeEvents'
import { clearBetween, inBox, mazeSiteAtPoint, mazeSitesNear, type MazeSite } from '../game/grandMaze'
import { canStep } from '../game/procgen/maze'
import { context2d, createCanvas } from '../engine/pixelart'
import type { Game } from '../game/types'

/**
 * What the players see in a big hedge maze (`game/grandMaze.ts`): light by cells, as in the cave. Each player lights the cells within
 * `GRAND.reach` corridor steps of theirs (a walk through the openings, never through a hedge), stepped down by `GRAND.falloff` and
 * blended between cell centers with a 4×4 ordered dither, so the edge of the light is pixel art. The cells a player has been near stay
 * faintly known (also on the minimap). Anything in a dark cell, or around a corner out of line, is not drawn at all, so a chest can't
 * be told apart from a decoy from afar. Presentation only.
 */

type Ctx = CanvasRenderingContext2D

const seen = new WeakMap<MazeSite, Uint8Array>()

/** The cells of `site` the players have been near so far (row-major, 1 where seen). */
export const seenCells = (site: MazeSite) => {
  let s = seen.get(site)
  if (!s) seen.set(site, (s = new Uint8Array(site.maze.cols * site.maze.rows)))
  return s
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

type Lit = { key: string; light: Float32Array }
const cache = new WeakMap<MazeSite, Lit>()

/** The light of every cell of `site` for the players standing in it (0..1, row-major), redone only when one changes cell. */
const lightOf = (g: Game, site: MazeSite): Float32Array => {
  const m = site.maze
  const near = g.players.filter((p) => !p.gone && inBox(site, p.x, p.y))
  const cells = near.map((p) => {
    const c = Math.max(0, Math.min(m.cols - 1, Math.floor((p.x - site.x) / GRAND.cell)))
    const r = Math.max(0, Math.min(m.rows - 1, Math.floor((p.y - 6 - site.y) / GRAND.cell)))
    return r * m.cols + c
  })
  const key = cells.join(',')
  const known = cache.get(site)
  if (known && known.key === key) return known.light
  const light = known?.light ?? new Float32Array(m.cols * m.rows)
  light.fill(0)
  const seenIt = seenCells(site)
  const steps = new Int16Array(m.cols * m.rows)
  for (const from of cells) {
    steps.fill(-1)
    steps[from] = 0
    const queue = [from]
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i]!
      const d = steps[cell]!
      light[cell] = Math.max(light[cell]!, GRAND.falloff[d]!)
      seenIt[cell] = 1
      if (d >= GRAND.reach) continue
      const c = cell % m.cols
      const r = Math.floor(cell / m.cols)
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nr < 0 || nc >= m.cols || nr >= m.rows || !canStep(m, c, r, dc, dr)) continue
        const next = nr * m.cols + nc
        if (steps[next]! >= 0) continue
        steps[next] = d + 1
        queue.push(next)
      }
    }
  }
  cache.set(site, { key, light })
  return light
}

/** Whether a player sees the world point (x, y) when it lies in a maze: its cell is lit, and it is in the same or a neighboring cell or in a straight line. Always true outside a maze. */
export const mazeSees = (g: Game, x: number, y: number) => {
  const site = mazeSiteAtPoint(g.terrain.seed, x, y)
  if (!site) return true
  const m = site.maze
  const cell = Math.floor((y - site.y) / GRAND.cell) * m.cols + Math.floor((x - site.x) / GRAND.cell)
  if (!(lightOf(g, site)[cell]! > 0)) return false
  const reach = GRAND.cell * 1.5
  for (const p of g.players) {
    if (p.gone) continue
    const dx = p.x - x
    const dy = p.y - y
    if (dx * dx + dy * dy <= reach * reach || clearBetween(site, p.x, p.y, x, y)) return true
  }
  return false
}

let map: { canvas: HTMLCanvasElement; ctx: Ctx; w: number; h: number } | null = null

/** The dark over the mazes in view: each pixel's light is blended between the centers of the cells around it (never across a hedge), then cut into four dithered steps. */
export const drawMazeFog = (ctx: Ctx, g: Game, camX: number, camY: number) => {
  if (g.place.inside || g.rift.arena) return
  const { w, h } = g.view
  const P = GRAND.cell
  for (const site of mazeSitesNear(g.terrain.seed, camX + w / 2, camY + h / 2, Math.max(w, h) / 2 + 40)) {
    const x0 = Math.max(0, Math.floor(site.x - camX))
    const y0 = Math.max(0, Math.floor(site.y - camY))
    const x1 = Math.min(w, Math.ceil(site.x + site.side - camX))
    const y1 = Math.min(h, Math.ceil(site.y + site.side - camY))
    if (x1 <= x0 || y1 <= y0) continue
    // Drawn at half the screen's resolution, scaled back up with hard edges: the dither cells are 2 px.
    const mw = Math.ceil((x1 - x0) / 2)
    const mh = Math.ceil((y1 - y0) / 2)
    if (!map || map.w < mw || map.h < mh) {
      const canvas = createCanvas(Math.max(mw, map?.w ?? 0), Math.max(mh, map?.h ?? 0))
      map = { canvas, ctx: context2d(canvas), w: canvas.width, h: canvas.height }
    }
    const m = site.maze
    const light = lightOf(g, site)
    const known = seenCells(site)
    const level = (c: number, r: number) => {
      const i = r * m.cols + c
      return Math.max(light[i]!, known[i]! ? GRAND.memory : 0)
    }
    const img = map.ctx.createImageData(mw, mh)
    const d = img.data
    const inset = GRAND.wall / 2 + 2
    for (let my = 0; my < mh; my++) {
      const wy = camY + y0 + my * 2 + 1
      for (let mx = 0; mx < mw; mx++) {
        const wx = camX + x0 + mx * 2 + 1
        const k = (my * mw + mx) * 4
        // Outside the outer hedge there is no fog.
        if (wx < site.x - inset || wy < site.y - inset || wx > site.x + site.side + inset || wy > site.y + site.side + inset) {
          d[k + 3] = 0
          continue
        }
        const lx = (wx - site.x) / P
        const ly = (wy - site.y) / P
        const c = Math.max(0, Math.min(m.cols - 1, Math.floor(lx)))
        const r = Math.max(0, Math.min(m.rows - 1, Math.floor(ly)))
        // Toward the nearer neighbor on each axis: its light counts only where a corridor opens that way.
        const fx = lx - c - 0.5
        const fy = ly - r - 0.5
        const dc = fx < 0 ? -1 : 1
        const dr = fy < 0 ? -1 : 1
        const here = level(c, r)
        const sx = canStep(m, c, r, dc, 0) && c + dc >= 0 && c + dc < m.cols ? level(c + dc, r) : here
        const sy = canStep(m, c, r, 0, dr) && r + dr >= 0 && r + dr < m.rows ? level(c, r + dr) : here
        const tx = Math.abs(fx)
        const ty = Math.abs(fy)
        const L = here * (1 - tx) * (1 - ty) + sx * tx * (1 - ty) + sy * (1 - tx) * ty + (sx + sy - here) * tx * ty
        // Four steps, dithered on a 4×4 matrix over the 2 px cells.
        const t = (BAYER[(my & 3) * 4 + (mx & 3)]! + 0.5) / 16
        const q = Math.max(0, Math.min(1, L))
        const step = Math.floor(q * 3 + t)
        const dark = 1 - Math.min(3, step) / 3
        d[k] = 6
        d[k + 1] = 8
        d[k + 2] = 6
        d[k + 3] = Math.round(255 * 0.92 * dark)
      }
    }
    map.ctx.putImageData(img, 0, 0)
    const smoothing = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(map.canvas, 0, 0, mw, mh, x0, y0, mw * 2, mh * 2)
    ctx.imageSmoothingEnabled = smoothing
  }
}

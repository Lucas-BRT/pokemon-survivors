import { GRAND } from '../data/mazeEvents'
import { clearBetween, inBox, isHedge, mazeSiteAtPoint, mazeSitesNear, type MazeSite } from '../game/grandMaze'
import { context2d, createCanvas } from '../engine/pixelart'
import type { Game } from '../game/types'
import * as dm from '../engine/dmath'

/**
 * What the players see in a big hedge maze (`game/grandMaze.ts`): the hedges are taller than they are, so only what a straight line
 * from a player reaches shows: corridors fade out with the distance and the hedge's face is lit where a ray hits it. Past that
 * the maze is dark, and the cells a player has seen stay faintly known (also on the minimap). Anything behind a hedge (a chest, a key,
 * a Pokémon) is not drawn at all, so a chest can't be told apart from a decoy from afar. Presentation only.
 */

type Ctx = CanvasRenderingContext2D

const RAYS = 180
/** How far into a hedge the light reaches, so its face shows where a ray ends. */
const FACE = 10

const seen = new WeakMap<MazeSite, Uint8Array>()

/** The cells of `site` the players have seen so far (row-major, 1 where seen). */
export const seenCells = (site: MazeSite) => {
  let s = seen.get(site)
  if (!s) seen.set(site, (s = new Uint8Array(site.maze.cols * site.maze.rows)))
  return s
}

/** How far a player at (x, y) sees in each of `RAYS` directions, in a maze. */
const look = (site: MazeSite, x: number, y: number, out: Float32Array) => {
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    let d = 3
    for (; d < GRAND.vision; d += 3) if (isHedge(site, x + dx * d, y + dy * d)) break
    out[i] = d
  }
}

const smooth = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return k * k * (3 - 2 * k)
}

/** Whether a player sees the world point (x, y) when it lies in a maze: nothing in the way within `vision`. Always true outside a maze. */
export const mazeSees = (g: Game, x: number, y: number) => {
  const site = mazeSiteAtPoint(g.terrain.seed, x, y)
  if (!site) return true
  for (const p of g.players) {
    if (p.gone) continue
    if (dm.sq(p.x - x) + dm.sq(p.y - y) <= GRAND.vision * GRAND.vision && clearBetween(site, p.x, p.y, x, y)) return true
  }
  return false
}

let map: { canvas: HTMLCanvasElement; ctx: Ctx; w: number; h: number } | null = null
const rays: Float32Array[] = []

/** The dark over the mazes in view, with the light of each player's sight cut out of it. */
export const drawMazeFog = (ctx: Ctx, g: Game, camX: number, camY: number) => {
  if (g.place.inside || g.rift.arena) return
  const { w, h } = g.view
  for (const site of mazeSitesNear(g.terrain.seed, camX + w / 2, camY + h / 2, Math.max(w, h) / 2 + 40)) {
    // The part of the box on the screen, half the screen's resolution.
    const x0 = Math.max(0, Math.floor(site.x - camX))
    const y0 = Math.max(0, Math.floor(site.y - camY))
    const x1 = Math.min(w, Math.ceil(site.x + site.side - camX))
    const y1 = Math.min(h, Math.ceil(site.y + site.side - camY))
    if (x1 <= x0 || y1 <= y0) continue
    const mw = Math.ceil((x1 - x0) / 2)
    const mh = Math.ceil((y1 - y0) / 2)
    if (!map || map.w < mw || map.h < mh) {
      const canvas = createCanvas(Math.max(mw, map?.w ?? 0), Math.max(mh, map?.h ?? 0))
      map = { canvas, ctx: context2d(canvas), w: canvas.width, h: canvas.height }
    }
    const m = map
    // Who can light it, and how far each sees.
    const lit: Array<{ x: number; y: number; ray: Float32Array }> = []
    for (const p of g.players) {
      if (p.gone || dm.sq(Math.max(site.x - p.x, 0, p.x - (site.x + site.side))) + dm.sq(Math.max(site.y - p.y, 0, p.y - (site.y + site.side))) > GRAND.vision * GRAND.vision) continue
      const ray = (rays[lit.length] ??= new Float32Array(RAYS))
      look(site, p.x, p.y - 6, ray)
      lit.push({ x: p.x, y: p.y - 6, ray })
      // What a player sees stays known: the cells along each ray.
      if (inBox(site, p.x, p.y)) {
        const known = seenCells(site)
        for (let i = 0; i < RAYS; i++) {
          const a = (i / RAYS) * Math.PI * 2
          for (let d = 0; d <= ray[i]!; d += 16) {
            const cx = Math.floor((p.x + Math.cos(a) * d - site.x) / GRAND.cell)
            const cy = Math.floor((p.y - 6 + Math.sin(a) * d - site.y) / GRAND.cell)
            if (cx >= 0 && cy >= 0 && cx < site.maze.cols && cy < site.maze.rows) known[cy * site.maze.cols + cx] = 1
          }
        }
      }
    }
    const known = seenCells(site)
    const img = m.ctx.createImageData(mw, mh)
    const d = img.data
    const inset = GRAND.wall / 2 + 2
    for (let my = 0; my < mh; my++) {
      const wy = camY + y0 + my * 2 + 1
      for (let mx = 0; mx < mw; mx++) {
        const wx = camX + x0 + mx * 2 + 1
        // The fog sits inside the outer hedge: its edge fades over 12 px, so the maze never ends in a line.
        const edge = Math.min(wx - (site.x + inset), site.x + site.side - inset - wx, wy - (site.y + inset), site.y + site.side - inset - wy)
        const mask = smooth(edge / 12 + 0.5)
        let light = 0
        const cell = Math.floor((wy - site.y) / GRAND.cell) * site.maze.cols + Math.floor((wx - site.x) / GRAND.cell)
        if (cell >= 0 && cell < known.length && known[cell]) light = GRAND.memory
        for (const q of lit) {
          const dx = wx - q.x
          const dy = wy - q.y
          const dist = Math.hypot(dx, dy)
          if (dist > GRAND.vision) continue
          const f = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * RAYS
          const i = Math.floor(f)
          const reach = q.ray[i]! * (1 - (f - i)) + q.ray[(i + 1) % RAYS]! * (f - i)
          if (dist > reach + FACE) continue
          const fall = 1 - smooth((dist / GRAND.vision - GRAND.fadeFrom) / (1 - GRAND.fadeFrom))
          // The edge of the lit area, where a ray ends in a hedge, is soft over a few px.
          const edgeSoft = 1 - smooth((dist - reach) / FACE)
          light = Math.max(light, fall * edgeSoft)
        }
        const k = (my * mw + mx) * 4
        d[k] = 6
        d[k + 1] = 8
        d[k + 2] = 6
        d[k + 3] = Math.round(255 * 0.94 * (1 - light) * mask)
      }
    }
    m.ctx.putImageData(img, 0, 0)
    const smoothing = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(m.canvas, 0, 0, mw, mh, x0, y0, mw * 2, mh * 2)
    ctx.imageSmoothingEnabled = smoothing
  }
}

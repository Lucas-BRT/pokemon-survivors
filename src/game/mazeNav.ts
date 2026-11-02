import { cellAt, cellCenter, clearBetween, inBox, isHedge, mazeSiteAtPoint, stepToward, type MazeSite } from './grandMaze'
import { distances } from './procgen/maze'
import type { Game } from './types'
import * as dm from '../engine/dmath'

/** How the horde and the maze's own Pokémon move around the big hedge maze (`grandMaze.ts`); the contents are `mazeRun.ts`. */

/**
 * The horde stays out of a maze: an enemy of the overworld that ends up inside one is put back on the nearest side of its box (the
 * maze's own Pokémon, `Enemy.home`, stay in). True when it moved one.
 */
export const evict = (g: Game, e: { x: number; y: number; home?: number }, margin = 4) => {
  if (e.home !== undefined) return false
  const site = mazeSiteAtPoint(g.terrain.seed, e.x, e.y)
  if (site) {
    const left = e.x - site.x
    const right = site.x + site.side - e.x
    const top = e.y - site.y
    const bottom = site.y + site.side - e.y
    const least = Math.min(left, right, top, bottom)
    if (least === left) e.x = site.x - margin
    else if (least === right) e.x = site.x + site.side + margin
    else if (least === top) e.y = site.y - margin
    else e.y = site.y + site.side + margin
    return true
  }
  return false
}

/** The distances (steps) to a player's cell, kept while that player stays in it: a maze's Pokémon follow them down these. */
const reach = new WeakMap<MazeSite, Map<number, { cell: number; dist: number[] }>>()

/**
 * Where a maze's own Pokémon at `e` heads to get to player `p`: straight at them when the way is clear, else the middle of the next
 * cell along the shortest walk (it never tries a hedge). Null when `p` isn't in this maze or it can go straight.
 */
export const mazeWaypoint = (g: Game, e: { x: number; y: number }, p: { x: number; y: number; slot: number }) => {
  const site = mazeSiteAtPoint(g.terrain.seed, e.x, e.y)
  if (!site || !inBox(site, p.x, p.y)) return null
  if (dm.sq(p.x - e.x) + dm.sq(p.y - e.y) < 160 * 160 && clearBetween(site, e.x, e.y, p.x, p.y)) return null
  const here = cellAt(site, p.x, p.y)
  const cell = here.r * site.maze.cols + here.c
  let by = reach.get(site)
  if (!by) reach.set(site, (by = new Map()))
  let known = by.get(p.slot)
  if (!known || known.cell !== cell) by.set(p.slot, (known = { cell, dist: distances(site.maze, here.c, here.r).dist }))
  const at = cellAt(site, e.x, e.y)
  const next = stepToward(site, known.dist, at.c, at.r)
  return next ? cellCenter(site, next.c, next.r) : null
}


/** Whether a hedge stands between two world points: only a segment touching a maze's box can be blocked, so this is a point lookup for everything else. */
export const hedgeBetween = (g: Game, ax: number, ay: number, bx: number, by: number) => {
  const site = mazeSiteAtPoint(g.terrain.seed, ax, ay) ?? mazeSiteAtPoint(g.terrain.seed, bx, by)
  return site !== null && !clearBetween(site, ax, ay, bx, by)
}

/** Whether (x, y) is hedge: where a shot of the walls' kind stops. */
export const inHedge = (g: Game, x: number, y: number) => {
  const site = mazeSiteAtPoint(g.terrain.seed, x, y)
  return site !== null && isHedge(site, x, y)
}

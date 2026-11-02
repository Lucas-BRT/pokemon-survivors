import { GRAND } from '../data/mazeEvents'
import { clearBetween, inBox, mazeSiteAtPoint, type MazeSite } from '../game/grandMaze'
import { canStep } from '../game/procgen/maze'
import type { Game } from '../game/types'

/**
 * What the players see in a big hedge maze (`game/grandMaze.ts`): the hedges are taller than they are, so a chest, a key or a Pokémon
 * is drawn only when a straight line from a player reaches it (or it is right beside them). Anything behind a hedge isn't drawn at
 * all, so a chest can't be told apart from a decoy from afar. The floor and the hedges themselves are always drawn: there is no shade.
 * The cells a player has walked near are remembered for the minimap. Presentation only.
 */

const seen = new WeakMap<MazeSite, Uint8Array>()

/** The cells of `site` the players have been near so far (row-major, 1 where seen). */
export const seenCells = (site: MazeSite) => {
  let s = seen.get(site)
  if (!s) seen.set(site, (s = new Uint8Array(site.maze.cols * site.maze.rows)))
  return s
}

const lastCell = new WeakMap<MazeSite, string>()

/** Remembers the cells within `GRAND.reach` corridor steps of each player standing in a maze (redone only when one changes cell). */
export const rememberMazes = (g: Game) => {
  if (g.place.inside || g.rift.arena) return
  for (const site of new Set(g.players.filter((p) => !p.gone).map((p) => mazeSiteAtPoint(g.terrain.seed, p.x, p.y)).filter((s): s is MazeSite => s !== null))) {
    const m = site.maze
    const from = g.players.filter((p) => !p.gone && inBox(site, p.x, p.y)).map((p) => Math.floor((p.y - site.y) / GRAND.cell) * m.cols + Math.floor((p.x - site.x) / GRAND.cell))
    const key = from.join(',')
    if (lastCell.get(site) === key) continue
    lastCell.set(site, key)
    const known = seenCells(site)
    for (const start of from) {
      const steps = new Map<number, number>([[start, 0]])
      const queue = [start]
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i]!
        const d = steps.get(cell)!
        known[cell] = 1
        if (d >= GRAND.reach) continue
        const c = cell % m.cols
        const r = Math.floor(cell / m.cols)
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nc = c + dc
          const nr = r + dr
          if (nc < 0 || nr < 0 || nc >= m.cols || nr >= m.rows || !canStep(m, c, r, dc, dr)) continue
          const next = nr * m.cols + nc
          if (steps.has(next)) continue
          steps.set(next, d + 1)
          queue.push(next)
        }
      }
    }
  }
}

/** Whether a player sees the world point (x, y) when it lies in a maze: within `GRAND.sight` in a straight line, or right beside them. Always true outside a maze. */
export const mazeSees = (g: Game, x: number, y: number) => {
  const site = mazeSiteAtPoint(g.terrain.seed, x, y)
  if (!site) return true
  const near = GRAND.cell * 1.5
  for (const p of g.players) {
    if (p.gone) continue
    const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
    if (d2 <= near * near || (d2 <= GRAND.sight * GRAND.sight && clearBetween(site, p.x, p.y, x, y))) return true
  }
  return false
}

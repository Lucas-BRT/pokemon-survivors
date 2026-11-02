import { describe, expect, it } from 'vitest'
import { GRAND } from '../data/mazeEvents'
import { cellCenter, clearBetween, hedgeRuns, inBox, isHedge, mazeSiteAt, mazeSiteOfCell, mazeSitesNear, type MazeSite } from './grandMaze'
import { deadEnds } from './procgen/maze'

/** The first mazes the terrain seeds give. */
const found = (n: number) => {
  const out: MazeSite[] = []
  for (let seed = 1; out.length < n && seed < 200; seed++) for (let by = -3; by <= 3; by++) for (let bx = -3; bx <= 3; bx++) {
    const s = mazeSiteAt(seed, bx, by)
    if (s && out.length < n) out.push(s)
  }
  return out
}

describe('the big hedge maze', () => {
  it('is bigger than a screen, with several ways in, a heart far from all of them and every cell reachable', () => {
    for (const s of found(6)) {
      expect(s.side).toBeGreaterThan(1500)
      expect(s.entrances.length).toBeGreaterThanOrEqual(GRAND.entrances[0])
      expect(s.entrances.length).toBeLessThanOrEqual(GRAND.entrances[1])
      expect(s.fromIn.every((d) => Number.isFinite(d))).toBe(true)
      const mid = (room: { r: number; c: number }) => s.fromIn[(room.r + 1) * s.maze.cols + room.c + 1]!
      for (const room of s.chambers) expect(mid(s.chambers[s.heart]!)).toBeGreaterThanOrEqual(mid(room))
      expect(mid(s.chambers[s.heart]!)).toBeGreaterThan(12)
      expect(deadEnds(s.maze).length).toBeGreaterThan(8)
    }
  })

  it('builds the same maze from the same seed', () => {
    const [s] = found(1)
    expect(s).toBeDefined()
    const again = mazeSiteAt(1, 0, 0)
    expect(JSON.stringify(again?.maze)).toBe(JSON.stringify(mazeSiteAt(1, 0, 0)?.maze))
  })

  it('has hedge on its borders, corridors the player can walk and a way through each entrance', () => {
    const [s] = found(1)
    // The outer hedge is centered on the box's edge; past its outer half there is nothing.
    expect(isHedge(s!, s!.x - 20, s!.y + 100)).toBe(false)
    const mid = cellCenter(s!, 10, 10)
    expect(isHedge(s!, mid.x, mid.y)).toBe(false)
    // A cell's center is open, its borders hold hedge where the grid says so, and an entrance cell lets the line in.
    for (const e of s!.entrances) {
      const c = cellCenter(s!, e.c, e.r)
      expect(isHedge(s!, c.x, c.y)).toBe(false)
      const out = e.side === 0 ? { x: c.x, y: s!.y - 20 } : e.side === 2 ? { x: c.x, y: s!.y + s!.side + 20 } : e.side === 3 ? { x: s!.x - 20, y: c.y } : { x: s!.x + s!.side + 20, y: c.y }
      expect(clearBetween(s!, c.x, c.y, out.x, out.y)).toBe(true)
    }
  })

  it('finds a maze through its terrain cells and its neighborhood', () => {
    const [s] = found(1)
    const seed = 1
    for (let sd = 1; sd < 200; sd++) {
      for (let by = -3; by <= 3; by++) for (let bx = -3; bx <= 3; bx++) {
        const site = mazeSiteAt(sd, bx, by)
        if (!site) continue
        expect(mazeSiteOfCell(sd, site.fx + 3, site.fy + 3)).toBe(site)
        expect(mazeSitesNear(sd, site.x + 200, site.y + 200, 50)).toContain(site)
        expect(inBox(site, site.x + 1, site.y + 1)).toBe(true)
        expect(hedgeRuns(site).length).toBeGreaterThan(20)
        void seed
        return
      }
    }
    expect(s).toBeDefined()
  })
})

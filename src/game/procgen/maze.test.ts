import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine/rng'
import { braid, deadEnds, distances, generateMaze, growingTree, mazeMetrics, openings } from './maze'

const STYLE = { cols: 9, rows: 9, newest: 0.7, braid: 0 }

describe('generated mazes', () => {
  it('carve a perfect maze: every cell reachable and exactly one walk between any two', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = growingTree(createRng(seed), 7, 5, 0.6)
      const { dist } = distances(m, 0, 0)
      expect(dist.every((d) => d >= 0)).toBe(true)
      // A tree over 35 cells has 34 open inner walls.
      let open = 0
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) open += (c + 1 < m.cols && !m.v[r]![c + 1] ? 1 : 0) + (r + 1 < m.rows && !m.h[r + 1]![c] ? 1 : 0)
      expect(open).toBe(34)
    }
  })

  it('build the same maze from the same seed, and another from another', () => {
    expect(generateMaze(createRng(9), STYLE)).toEqual(generateMaze(createRng(9), STYLE))
    expect(generateMaze(createRng(9), STYLE)).not.toEqual(generateMaze(createRng(10), STYLE))
  })

  it('braid dead ends into loops, and leave the maze whole', () => {
    const m = growingTree(createRng(3), 9, 9, 0.7)
    const before = deadEnds(m).length
    braid(createRng(4), m, 1)
    expect(deadEnds(m).length).toBeLessThan(before)
    expect(distances(m, 0, 0).dist.every((d) => d >= 0)).toBe(true)
    expect(mazeMetrics({ maze: m, entrance: { c: 0, r: 0, side: 0 }, goal: { c: 8, r: 8 } }).loops).toBeGreaterThan(0)
  })

  it('open the way in on the outer wall and put the treasure far from it', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const layout = generateMaze(createRng(seed), { ...STYLE, braid: 0.25 })
      const { maze, entrance, goal } = layout
      expect(entrance.c === 0 || entrance.r === 0 || entrance.c === maze.cols - 1 || entrance.r === maze.rows - 1).toBe(true)
      expect(openings(maze, entrance.c, entrance.r)).toBeGreaterThanOrEqual(2)
      expect(goal).not.toEqual({ c: entrance.c, r: entrance.r })
      // No cell is nearer to everything than half the diameter, so the walk is never shorter than that.
      expect(mazeMetrics(layout).reach).toBeGreaterThanOrEqual(0.5)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { MAZE_RUN } from '../data/mazeEvents'
import { createGame } from './game'
import { spawnMapEvent } from './mapEvents'
import { hintLocked, keysLeft, mazeLocked, updateMazes } from './mazeRun'
import { featureAt, type Landmark } from './terrain'
import type { Game } from './types'

/** A run with the player beside the first hedge maze its terrain holds (the seed picks where). */
const nearMaze = (seed = 3) => {
  for (let s = seed; ; s++) {
    const g: Game = createGame('charmander', { w: 480, h: 270 }, s)
    for (let cy = -14; cy <= 14; cy++) {
      for (let cx = -14; cx <= 14; cx++) {
        const lm: Landmark | undefined = featureAt(g.terrain.seed, cx, cy)?.landmark
        if (lm?.id !== 'maze') continue
        Object.assign(g.player, { x: lm.x, y: lm.y - 30 })
        return { g, lm }
      }
    }
    if (s > seed + 40) throw new Error('no maze found')
  }
}

describe('the hedge maze at play', () => {
  it('builds its run once a player comes near, the same for every run of the seed', () => {
    const a = nearMaze()
    const b = nearMaze()
    updateMazes(a.g, 1 / 60, spawnMapEvent)
    updateMazes(b.g, 1 / 60, spawnMapEvent)
    const run = a.g.mazes.get(a.lm.cell)!
    expect(run).toBeDefined()
    expect(run.caches.length).toBeGreaterThan(0)
    expect(run.hidden.length).toBeGreaterThanOrEqual(MAZE_RUN.hidden.base)
    expect(JSON.stringify(run)).toBe(JSON.stringify(b.g.mazes.get(b.lm.cell)))
  })

  it('keeps the heart’s chest locked until every key is in, and tells whoever stands there', () => {
    const { g, lm } = nearMaze()
    updateMazes(g, 1 / 60, spawnMapEvent)
    const run = g.mazes.get(lm.cell)!
    run.keys.push({ x: lm.x, y: lm.y - 30, taken: false })
    expect(mazeLocked(g, lm.cell)).toBe(true)
    g.events.length = 0
    hintLocked(g, lm.cell)
    expect(g.events.some((e) => e.kind === 'maze' && e.moment === 'locked')).toBe(true)
    // Standing on the key takes it.
    updateMazes(g, 1 / 60, spawnMapEvent)
    expect(keysLeft(g, lm.cell)).toBe(run.keys.filter((k) => !k.taken).length)
    for (const k of run.keys) k.taken = true
    expect(mazeLocked(g, lm.cell)).toBe(false)
  })

  it('opens a small chest after standing at it a moment, and a decoy’s Pokémon jumps out', () => {
    const { g, lm } = nearMaze()
    updateMazes(g, 1 / 60, spawnMapEvent)
    const run = g.mazes.get(lm.cell)!
    const cache = run.caches[0]!
    Object.assign(g.player, { x: cache.x, y: cache.y })
    const before = g.enemies.length
    for (let i = 0; i < Math.ceil((MAZE_RUN.openTime + 0.1) * 60); i++) updateMazes(g, 1 / 60, spawnMapEvent)
    expect(cache.open).toBe(true)
    if (cache.decoy) expect(g.enemies.length).toBeGreaterThan(before)
  })

  it('springs a Pokémon out of the hedges when a player comes close, once', () => {
    const { g, lm } = nearMaze()
    updateMazes(g, 1 / 60, spawnMapEvent)
    const h = g.mazes.get(lm.cell)!.hidden[0]!
    Object.assign(g.player, { x: h.x, y: h.y })
    updateMazes(g, 1 / 60, spawnMapEvent)
    expect(h.fired).toBe(true)
    const n = g.enemies.length
    updateMazes(g, 1 / 60, spawnMapEvent)
    expect(g.enemies.length).toBe(n)
  })

  it('carries a player through a ring to the other one', () => {
    for (let seed = 3; seed < 40; seed++) {
      const { g, lm } = nearMaze(seed)
      updateMazes(g, 1 / 60, spawnMapEvent)
      const run = g.mazes.get(lm.cell)!
      if (run.rings.length < 2) continue
      const [a, b] = run.rings as [{ x: number; y: number }, { x: number; y: number }]
      Object.assign(g.player, { x: a.x, y: a.y })
      for (let i = 0; i < Math.ceil((MAZE_RUN.ringTime + 0.1) * 60); i++) updateMazes(g, 1 / 60, spawnMapEvent)
      expect(Math.hypot(g.player.x - b.x, g.player.y - b.y)).toBeLessThan(20)
      return
    }
    expect.fail('no maze with rings in 40 seeds')
  })
})

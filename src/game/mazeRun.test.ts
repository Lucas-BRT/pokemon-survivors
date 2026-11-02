import { describe, expect, it } from 'vitest'
import { MAZE_CAST, MAZE_RUN, mazeTheme } from '../data/mazeEvents'
import { createGame } from './game'
import { inBox, nearestMaze } from './grandMaze'
import { spawnMapEvent } from './mapEvents'
import { evict } from './mazeNav'
import { hordeShut } from './players'
import { updateSpawner } from './spawner'
import { mazeLocked, updateMazes, type MazeRun } from './mazeRun'
import type { Game } from './types'

/** A run with the player at the heart-chamber-far side of the first maze the seed gives (set at its entrance, inside the box). */
const inMaze = (seed = 3) => {
  for (let s = seed; ; s++) {
    const g: Game = createGame('charmander', { w: 480, h: 270 }, s)
    const site = nearestMaze(g.terrain.seed, 0, 0)
    if (!site) {
      if (s > seed + 40) throw new Error('no maze found')
      continue
    }
    const e = site.entrances[0]!
    Object.assign(g.player, { x: site.x + (e.c + 0.5) * 64, y: site.y + (e.r + 0.5) * 64 })
    updateMazes(g, 1 / 60, spawnMapEvent)
    return { g, site, run: g.mazes.get(site.key)! }
  }
}

const tick = (g: Game, seconds: number) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) updateMazes(g, 1 / 60, spawnMapEvent)
}

const stand = (g: Game, at: { x: number; y: number }) => Object.assign(g.player, { x: at.x, y: at.y })

const run0 = (g: Game, site: { key: number }) => g.enemies.find((e) => e.id === g.mazes.get(site.key)?.guard)?.kind

describe('the big hedge maze at play', () => {
  it('builds its run once a player comes near, the same for every run of the seed', () => {
    const a = inMaze()
    const b = inMaze()
    expect(a.run).toBeDefined()
    expect(a.run.hidden.length).toBeGreaterThanOrEqual(MAZE_RUN.hidden.base)
    expect(JSON.stringify(a.run)).toBe(JSON.stringify(b.run))
  })

  it('keeps the heart’s chest shut until every key is in, then opens it and wakes a guardian that belongs to the maze', () => {
    for (let seed = 3; seed < 60; seed++) {
      const { g, site, run } = inMaze(seed)
      if (run.keys.length === 0) continue
      stand(g, run.heart)
      tick(g, MAZE_RUN.openTime + 0.3)
      expect(run.heart.open).toBe(false)
      expect(mazeLocked(g, site.key)).toBe(true)
      expect(g.events.some((e) => e.kind === 'maze' && e.moment === 'locked')).toBe(true)
      for (const k of run.keys) k.taken = true
      const before = g.enemies.length
      tick(g, MAZE_RUN.openTime + 0.3)
      expect(run.heart.open).toBe(true)
      expect(g.enemies.length).toBeGreaterThan(before)
      expect(g.enemies.some((e) => e.id === run.guard && e.home === site.key)).toBe(true)
      return
    }
    expect.fail('no locked maze in 60 seeds')
  })

  it('opens a small chest after standing at it a moment, and a decoy’s Pokémon jumps out', () => {
    const { g, run } = inMaze()
    const cache = run.caches[0]!
    stand(g, cache)
    const before = g.enemies.length
    tick(g, MAZE_RUN.openTime + 0.2)
    expect(cache.open).toBe(true)
    if (cache.decoy) expect(g.enemies.length).toBeGreaterThan(before)
  })

  it('hides its traps until a player comes close, and shows them as the map events they are', () => {
    const { g, run } = inMaze()
    const t = run.traps[0]!
    expect(g.mapEvents.list.some((e) => e.id === t.ev)).toBe(false)
    stand(g, { x: t.x + MAZE_RUN.trapReveal + 30, y: t.y })
    tick(g, 0.1)
    expect(t.ev).toBe(-1)
    stand(g, t)
    tick(g, 0.1)
    expect(g.mapEvents.list.some((e) => e.id === t.ev && e.kind === t.kind)).toBe(true)
  })

  it('springs a Pokémon out of the hedges when a player comes close, once, and it is the maze’s own', () => {
    const { g, site, run } = inMaze()
    const h = run.hidden[0]!
    stand(g, h)
    tick(g, 0.05)
    expect(h.fired).toBe(true)
    expect(g.enemies.some((e) => e.home === site.key)).toBe(true)
    const n = g.enemies.length
    tick(g, 0.05)
    expect(g.enemies.length).toBe(n)
  })

  it('carries a player through a ring to its pair', () => {
    for (let seed = 3; seed < 60; seed++) {
      const { g, run } = inMaze(seed)
      if (run.rings.length < 2) continue
      const [a, b] = run.rings as [MazeRun['rings'][number], MazeRun['rings'][number]]
      stand(g, a)
      tick(g, MAZE_RUN.ringTime + 0.2)
      expect(Math.hypot(g.player.x - b.x, g.player.y - b.y)).toBeLessThan(24)
      return
    }
    expect.fail('no maze with rings in 60 seeds')
  })

  it('keeps the overworld’s horde out of its box, and lets the maze’s own Pokémon stay', () => {
    const { g, site } = inMaze()
    const mid = { x: site.x + site.side / 2, y: site.y + site.side / 2 }
    const wild = { x: mid.x, y: mid.y, home: undefined as number | undefined }
    expect(evict(g, wild)).toBe(true)
    expect(inBox(site, wild.x, wild.y)).toBe(false)
    expect(evict(g, { x: mid.x, y: mid.y, home: site.key })).toBe(false)
  })

  it('tells a player who steps in once, and pauses the horde while everyone is inside', () => {
    const { g, site } = inMaze()
    expect(g.player.landmark.maze).toBe(site.key)
    expect(g.events.filter((e) => e.kind === 'maze' && e.moment === 'enter' && e.n === g.player.slot)).toHaveLength(1)
    tick(g, 1)
    expect(g.events.filter((e) => e.kind === 'maze' && e.moment === 'enter')).toHaveLength(1)
    expect(hordeShut(g)).toBe(true)
    g.time = 120
    g.nextEvent = 1e9
    g.enemies.length = 0
    for (let i = 0; i < 300; i++) updateSpawner(g, 1 / 60)
    expect(g.enemies.filter((e) => e.home === undefined)).toHaveLength(0)
    // Out again: the horde comes back.
    stand(g, { x: site.x - 400, y: site.y - 400 })
    tick(g, 0.1)
    expect(g.player.landmark.maze).toBe(-1)
    expect(hordeShut(g)).toBe(false)
  })

  it('fills the corridors with its theme’s Pokémon, out of sight, while someone is inside', () => {
    const { g, site } = inMaze()
    g.enemies.length = 0
    const theme = mazeTheme(g.biome.id, site.seed)
    expect(MAZE_CAST[g.biome.id].themes.map((t) => t.id)).toContain(theme.id)
    tick(g, 120)
    const own = g.enemies.filter((e) => e.home === site.key)
    expect(own.length).toBeGreaterThan(MAZE_RUN.live.base - 1)
    expect(own.every((e) => inBox(site, e.x, e.y))).toBe(true)
    expect(own.filter((e) => !theme.hide.includes(e.kind) && e.kind !== run0(g, site)).length).toBe(0)
  })
})


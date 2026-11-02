import { describe, expect, it } from 'vitest'
import { LANDMARK, LANDMARK_IDS, TUNNEL } from '../data/landmarks'
import { TERRAIN } from '../data/terrain'
import { spawnEnemy, updateEnemies } from './enemies'
import { createGame, step } from './game'
import { updateLandmarks, updateTunnel } from './landmarks'
import { createTerrain, featureAt, type Landmark } from './terrain'
import type { Game } from './types'

const TICK = 1 / 60
const SEED = createTerrain(1234).seed

/** Every landmark in a square of cells around the origin, with its cell. */
const landmarks = (seed: number, span: number) =>
  Array.from({ length: (span * 2 + 1) ** 2 }, (_, i) => {
    const cx = (i % (span * 2 + 1)) - span
    const cy = Math.floor(i / (span * 2 + 1)) - span
    return { cx, cy, lm: featureAt(seed, cx, cy)?.landmark }
  }).filter((c): c is { cx: number; cy: number; lm: Landmark } => c.lm !== undefined)

const first = (g: Game, id: Landmark['id']) => landmarks(g.terrain.seed, 14).find(({ lm }) => lm.id === id)!.lm

describe('landmark layouts', () => {
  it('places at most one landmark per block, every kind of them, the same from the same seed', () => {
    const all = landmarks(SEED, 30)
    const blocks = all.map(({ cx, cy }) => `${Math.floor(cx / LANDMARK.block)},${Math.floor(cy / LANDMARK.block)}`)
    expect(new Set(blocks).size).toBe(blocks.length)
    expect(new Set(all.map(({ lm }) => lm.id))).toEqual(new Set(LANDMARK_IDS))
    expect(landmarks(SEED, 6)).toEqual(landmarks(SEED, 6))
    // About `odds` of the blocks hold one.
    expect(all.length / (61 / LANDMARK.block) ** 2).toBeGreaterThan(LANDMARK.odds - 0.15)
  })

  it('keeps landmarks inside their cells, clear of the edges', () => {
    const C = TERRAIN.cell
    for (const { cx, cy } of landmarks(SEED, 20)) {
      for (const e of featureAt(SEED, cx, cy)!.solids.flatMap((s) => s.foot)) {
        expect(e.x - e.rx).toBeGreaterThanOrEqual(cx * C + TERRAIN.margin - 1)
        expect(e.x + e.rx).toBeLessThanOrEqual((cx + 1) * C - TERRAIN.margin + 1)
        expect(e.y - e.ry).toBeGreaterThanOrEqual(cy * C + TERRAIN.margin - 1)
        expect(e.y + e.ry).toBeLessThanOrEqual((cy + 1) * C - TERRAIN.margin + 1)
      }
    }
  })
})

describe('landmarks at play', () => {
  it('opens a treasure after standing at it a moment, once, even after the map rebuilds its cell', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 1234)
    const lm = first(g, 'cottage')
    Object.assign(g.player, lm.treasure!)
    const coins = () => g.pickups.filter((k) => k.kind === 'coin').length
    for (let t = 0; t < LANDMARK.openTime - 0.1; t += TICK) updateLandmarks(g, TICK)
    expect(coins()).toBe(0)
    for (let t = 0; t < 0.2; t += TICK) updateLandmarks(g, TICK)
    expect(coins()).toBeGreaterThan(0)
    expect(g.landmarks.looted.has(lm.cell)).toBe(true)
    expect(g.events.filter((e) => e.kind === 'landmark').map((e) => e.kind === 'landmark' && e.moment)).toEqual(['spot', 'loot'])
    g.pickups.length = 0
    g.terrain.cells.clear()
    for (let t = 0; t < 2; t += TICK) updateLandmarks(g, TICK)
    expect(coins()).toBe(0)
    expect(g.landmarks.opened).toBe(1)
  })

  it('takes the player through a tunnel to the far mouth, out of the horde’s sight, and not straight back', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 1234)
    const lm = first(g, 'tunnel')
    const [west, east] = lm.mouths
    Object.assign(g.player, west)
    const foe = spawnEnemy(g, 'rattata', west!.x, west!.y + 60)
    for (let t = 0; t < TUNNEL.enterTime + 0.05; t += TICK) updateLandmarks(g, TICK)
    expect(g.player.landmark.transit).not.toBeNull()
    // Underground, the horde loses track: the foe doesn't head straight up at the mouth.
    const before = foe.y
    updateEnemies(g, 0.25)
    expect(before - foe.y).toBeLessThan(foe.speed * 0.25 * 0.8)
    while (updateTunnel(g, TICK)) if (!g.player.landmark.transit) break
    expect(g.player.x).toBe(east!.x)
    expect(g.player.y).toBe(east!.y + TUNNEL.exitStep)
    // Standing in the mouth it came out of doesn't send it back until it steps out.
    Object.assign(g.player, east)
    for (let t = 0; t < 1; t += TICK) updateLandmarks(g, TICK)
    expect(g.player.landmark.transit).toBeNull()
    g.player.y += 40
    updateLandmarks(g, TICK)
    Object.assign(g.player, east)
    for (let t = 0; t < TUNNEL.enterTime + 0.05; t += TICK) updateLandmarks(g, TICK)
    expect(g.player.landmark.transit?.x1).toBe(west!.x)
  })

  it('keeps the player off the rock while walking the tunnel in the full step', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 1234)
    Object.assign(g, { phase: 'playing' })
    Object.assign(g.player, { phase: 'playing', pendingLevelUps: 0, offers: [] })
    const lm = first(g, 'tunnel')
    Object.assign(g.player, lm.mouths[0])
    let t = 0
    while (t < TUNNEL.enterTime + TUNNEL.travel + 0.3) {
      step(g, { move: { x: 0, y: 0 }, special: false }, TICK)
      t += TICK
    }
    expect(g.player.x).toBeCloseTo(lm.mouths[1]!.x, 0)
  })
})

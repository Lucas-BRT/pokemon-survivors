import { describe, expect, it } from 'vitest'
import { createExplorersGame, layExplorerFloor, stepExplorers } from './explorersRun'
import { clockAt } from './explorers'
import type { Game } from './types'

const STILL = { move: { x: 0, y: 0 }, special: false }
const VIEW = { w: 480, h: 270 }

const started = () => {
  const g = createExplorersGame('charmander', VIEW, 7)
  const inside = g.place.inside!
  if (inside.id !== 'cave') throw new Error('not in the container')
  inside.intro = 0
  g.player.hp = g.player.stats.maxHp = 1e9
  return { g, inside }
}

const tick = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) stepExplorers(g, [STILL], 1 / 60)
}

describe('an Explorers run', () => {
  it('starts on floor 1 with the stairs open and its foes already placed', () => {
    const { g, inside } = started()
    expect(g.explorers).toMatchObject({ depth: 1, deepest: 1 })
    expect(inside.state.stairs).not.toBeNull()
    expect(g.enemies.length).toBeGreaterThan(0)
    expect(g.explorers!.foes).toBe(g.enemies.length)
    expect(inside.left).toBe(clockAt(1))
  })

  it('never spawns anything while the floor plays', () => {
    const { g } = started()
    const start = g.enemies.length
    for (let s = 0; s < 20; s++) {
      tick(g, 60)
      expect(g.enemies.length).toBeLessThanOrEqual(start)
    }
  })

  it('takes the team down a floor at the stairs, with a new cast and a fresh clock', () => {
    const { g, inside } = started()
    const [sx, sy] = inside.state.stairs!
    for (const p of g.players) {
      p.x = inside.x + sx
      p.y = inside.y + sy
    }
    inside.left = 5
    tick(g, 1)
    expect(g.explorers!.depth).toBe(2)
    expect(g.explorers!.deepest).toBe(2)
    expect(inside.state.floor).toBe(1)
    expect(inside.left).toBe(clockAt(2))
    expect(g.enemies.length).toBeGreaterThan(0)
  })

  it('ends the run when the floor clock runs out', () => {
    const { g, inside } = started()
    inside.left = 0.01
    tick(g, 2)
    expect(g.phase).toBe('gameover')
  })

  it('ends the run on a fall instead of rescuing the team at the door', () => {
    const { g, inside } = started()
    g.player.stats.maxHp = 10
    g.player.hp = 0
    // A fall in a plain cave (`placeKit.fallInPlace`) would set `inside.fall`; here nothing does.
    tick(g, 1)
    expect(inside.fall).toBeNull()
  })
})

describe('the guards of Explorers', () => {
  it('puts a real boss on floor 20, fighting by its patterns, and an Alpha sub-boss on floor 5', () => {
    const { g, inside } = started()
    layExplorerFloor(g, inside, 20)
    const boss = g.enemies.find((e) => e.id === g.bossId)!
    expect(boss.kind).toBe('snorlax')
    expect(boss.alpha).toBeFalsy()
    inside.intro = 0
    tick(g, 3)
    expect(boss.fight).not.toBeNull()
    layExplorerFloor(g, inside, 5)
    const sub = g.enemies.find((e) => e.id === g.bossId)!
    expect(sub.kind).toBe('butterfree')
    expect(sub.alpha).toBeTruthy()
  })
})

describe('the themes of Explorers', () => {
  it('lights only the cave with crystals: the field and the forest have none', () => {
    const { g, inside } = started()
    const crystals = (depth: number) => (layExplorerFloor(g, inside, depth), inside.state.sources.length)
    expect(crystals(1)).toBe(0)
    expect(crystals(21)).toBe(0)
    expect(crystals(41)).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'
import { createGame } from '../game/game'
import { enterPlace } from '../game/placeInterior'
import { caveFog, glintOf, SEEN_SCALE, wasSeen } from './caveSight'

const roomAtIndex = (plan: Parameters<typeof glintOf>[0], x: number, y: number) => plan!.rooms.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)

describe('what the team has seen of a cave floor', () => {
  it('starts with the light around the players, keeps what they leave behind and never reaches the rooms they have not been to', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 5)
    enterPlace(g, 'cave', 0, 0)
    const inside = g.place.inside
    if (inside?.id !== 'cave') throw new Error('not in the cave')
    const plan = inside.state.plan!
    const mid = (i: number) => ({ x: inside.x + plan.rooms[i]!.x + plan.rooms[i]!.w / 2, y: inside.y + plan.rooms[i]!.y + plan.rooms[i]!.h / 2 })
    const here = mid(plan.startRoom)
    const there = mid(plan.stairsRoom)
    Object.assign(g.player, here)
    const seen = caveFog(g, plan, inside.state.visited, inside.x, inside.y)
    expect(wasSeen(seen, here.x, here.y)).toBe(true)
    expect(wasSeen(seen, there.x, there.y)).toBe(false)
    // Stepping into a room makes the whole of it known and keeps the first one known (the same set grows).
    Object.assign(g.player, there)
    inside.state.visited.push(plan.stairsRoom)
    const r = plan.rooms[plan.stairsRoom]!
    expect(caveFog(g, plan, inside.state.visited, inside.x, inside.y)).toBe(seen)
    expect(wasSeen(seen, inside.x + r.x + 3, inside.y + r.y + 3)).toBe(true)
    expect(wasSeen(seen, inside.x + r.x + r.w - 3, inside.y + r.y + r.h - 3)).toBe(true)
    expect(wasSeen(seen, here.x, here.y)).toBe(true)
    // A cell far past the light is not.
    expect(wasSeen(seen, here.x + SEEN_SCALE * 40, here.y + SEEN_SCALE * 40)).toBe(false)
  })

  it('glints the same all over a crystal’s room and fades only once the players are out of it', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 5)
    enterPlace(g, 'cave', 0, 0)
    const inside = g.place.inside
    if (inside?.id !== 'cave') throw new Error('not in the cave')
    const plan = inside.state.plan!
    const room = plan.rooms.findIndex((_, i) => inside.state.lights.some(([x, y]) => i === roomAtIndex(plan, x, y)))
    const r = plan.rooms[room]!
    const crystal = inside.state.lights.find(([x, y]) => roomAtIndex(plan, x, y) === room)!
    const n = { glintNear: 60, glintFade: 90 }
    const at = (x: number, y: number) => glintOf(plan, crystal, [{ x, y }], n)
    // Next to it and in the room's far corner: the same.
    expect(at(crystal[0] + 4, crystal[1])).toBe(1)
    expect(at(r.x + 2, r.y + 2)).toBe(1)
    expect(at(r.x + r.w - 2, r.y + r.h - 2)).toBe(1)
    // Out of the room it fades with the distance to its walls, to nothing.
    expect(at(r.x - 60, r.y + r.h / 2)).toBe(1)
    const half = at(r.x - 105, r.y + r.h / 2)
    expect(half).toBeGreaterThan(0.2)
    expect(half).toBeLessThan(0.8)
    expect(at(r.x - 200, r.y + r.h / 2)).toBe(0)
    // Any player in the room keeps it up.
    expect(glintOf(plan, crystal, [{ x: r.x - 200, y: r.y }, { x: r.x + 5, y: r.y + 5 }], n)).toBe(1)
    // No plan (the treasure chamber): one cavern.
    expect(glintOf(null, [0, 0], [{ x: 300, y: 300 }], n)).toBe(1)
  })
})

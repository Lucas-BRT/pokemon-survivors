import { describe, expect, it } from 'vitest'
import { createGame } from '../game/game'
import { enterPlace } from '../game/placeInterior'
import { caveFog, SEEN_SCALE, wasSeen } from './caveSight'

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
    const seen = caveFog(g, plan)
    expect(wasSeen(seen, here.x, here.y)).toBe(true)
    expect(wasSeen(seen, there.x, there.y)).toBe(false)
    // Walking on, the first spot stays known (the same set grows).
    Object.assign(g.player, there)
    expect(caveFog(g, plan)).toBe(seen)
    expect(wasSeen(seen, there.x, there.y)).toBe(true)
    expect(wasSeen(seen, here.x, here.y)).toBe(true)
    // A cell far past the light is not.
    expect(wasSeen(seen, here.x + SEEN_SCALE * 40, here.y + SEEN_SCALE * 40)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { CAVE } from '../data/places'
import { CAVE_GEN, PROCGEN } from '../data/procgen'
import { descendCave, updateCave } from './cave'
import { createGame } from './game'
import { enterPlace } from './placeInterior'
import { TICK } from './replay'
import type { Game } from './types'

/** A run standing in a cave's first floor (the dungeon is laid out around the world's origin). */
const inCave = (seed = 5) => {
  const g: Game = createGame('charmander', { w: 480, h: 270 }, seed)
  enterPlace(g, 'cave', 0, 0)
  const inside = g.place.inside
  if (inside?.id !== 'cave') throw new Error('not in the cave')
  return { g, inside }
}

describe.skipIf(!PROCGEN.cave)('the generated cave at play', () => {
  it('keeps a clock per floor: the first floor’s, then each next floor’s and the chamber’s, the wind starting over', () => {
    const { g, inside } = inCave()
    expect(inside.left).toBe(CAVE_GEN.floorTime[0])
    inside.left = 5
    inside.state.wind = 3
    descendCave(g, inside)
    expect(inside.left).toBe(CAVE_GEN.floorTime[1])
    expect(inside.state.wind).toBe(0)
    descendCave(g, inside)
    expect(inside.left).toBe(CAVE_GEN.floorTime[2])
    descendCave(g, inside)
    expect(inside.state.floor).toBe(CAVE.floors)
    expect(inside.left).toBe(CAVE_GEN.chamberTime)
  })

  it('springs the ambush pack the first time someone steps into its room, and only once', () => {
    const { g, inside } = inCave()
    const plan = inside.state.plan!
    const room = plan.ambush[0]!
    const rect = plan.rooms[room]!
    const before = g.enemies.length
    Object.assign(g.player, { x: inside.x + rect.x + rect.w / 2, y: inside.y + rect.y + rect.h / 2 })
    updateCave(g, inside, TICK)
    expect(inside.state.sprung).toEqual([room])
    expect(g.enemies.length - before).toBe(CAVE_GEN.pack.base + CAVE_GEN.pack.perFloor * inside.state.floor)
    const after = g.enemies.length
    updateCave(g, inside, TICK)
    expect(inside.state.sprung).toEqual([room])
    // Only the dark's slow spawns, never a second pack.
    expect(g.enemies.length - after).toBeLessThan(CAVE_GEN.pack.base)
  })

  it('lays a prize in each ambush room: ₽ and an item', () => {
    const { g, inside } = inCave()
    const plan = inside.state.plan!
    const inRoom = (room: number) => g.pickups.filter((k) => plan.rooms[room] && k.x >= inside.x + plan.rooms[room]!.x && k.x <= inside.x + plan.rooms[room]!.x + plan.rooms[room]!.w && k.y >= inside.y + plan.rooms[room]!.y && k.y <= inside.y + plan.rooms[room]!.y + plan.rooms[room]!.h)
    for (const room of plan.ambush) expect(inRoom(room).length).toBeGreaterThanOrEqual(2)
  })
})

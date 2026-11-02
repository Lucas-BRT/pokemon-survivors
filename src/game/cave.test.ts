import { describe, expect, it } from 'vitest'
import { CAVE } from '../data/places'
import { CAVE_GEN, PROCGEN } from '../data/procgen'
import { descendCave, updateCave } from './cave'
import { chooseOffer, createGame, step } from './game'
import { spawnEnemy } from './enemies'
import { roomAt } from './dungeon'
import { enterPlace } from './placeInterior'
import { TICK } from './replay'
import type { Game } from './types'

const STILL = { move: { x: 0, y: 0 }, special: false }

/** Plays `seconds` of the run, taking the first card of any pick screen that comes up. */
const play = (g: Game, seconds: number) => {
  const end = g.now + seconds
  while (g.now < end) {
    if (g.phase !== 'playing') chooseOffer(g, g.player.offers[0]!)
    step(g, STILL, TICK)
  }
}

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

  it('springs the pack of the floor, as many as the room is big, the first time someone steps into the room, and only once', () => {
    const { g, inside } = inCave()
    const plan = inside.state.plan!
    const room = plan.ambush[0]!
    const rect = plan.rooms[room]!
    const pack = CAVE_GEN.packs[0]!
    const before = g.enemies.length
    Object.assign(g.player, { x: inside.x + rect.x + 24, y: inside.y + rect.y + 24 })
    updateCave(g, inside, TICK)
    expect(inside.state.sprung).toEqual([room])
    expect(g.enemies.length - before).toBe(Math.min(CAVE_GEN.packMax, pack.base + pack.perCell * (plan.sizes[room]! - 1)))
    expect(g.enemies.slice(before).every((e) => pack.mob.includes(e.kind))).toBe(true)
    const after = g.enemies.length
    updateCave(g, inside, TICK)
    expect(inside.state.sprung).toEqual([room])
    // Only the dark's slow spawns, never a second pack.
    expect(g.enemies.length - after).toBeLessThan(pack.base)
  })

  it('brings the deeper floors’ leader with the pack, in a room big enough for it', () => {
    const { g, inside } = inCave(11)
    descendCave(g, inside)
    descendCave(g, inside)
    const plan = inside.state.plan!
    const pack = CAVE_GEN.packs[2]!
    const lead = pack.leader!
    for (const room of plan.ambush) {
      const rect = plan.rooms[room]!
      const before = g.enemies.length
      Object.assign(g.player, { x: inside.x + rect.x + 24, y: inside.y + rect.y + 24 })
      updateCave(g, inside, TICK)
      const born = g.enemies.slice(before)
      expect(born.some((e) => e.kind === lead.kind)).toBe(plan.sizes[room]! >= lead.minCells)
      expect(born.filter((e) => e.kind !== lead.kind).every((e) => pack.mob.includes(e.kind))).toBe(true)
    }
  })

  it('lays a prize in each ambush room: ₽ and an item', () => {
    const { g, inside } = inCave()
    const plan = inside.state.plan!
    const inRoom = (room: number) => g.pickups.filter((k) => plan.rooms[room] && k.x >= inside.x + plan.rooms[room]!.x && k.x <= inside.x + plan.rooms[room]!.x + plan.rooms[room]!.w && k.y >= inside.y + plan.rooms[room]!.y && k.y <= inside.y + plan.rooms[room]!.y + plan.rooms[room]!.h)
    for (const room of plan.ambush) expect(inRoom(room).length).toBeGreaterThanOrEqual(2)
  })
})

describe.skipIf(!PROCGEN.caveSight)('what the cave’s walkers see', () => {
  /** The player in the start room and the world px of the middle of room `i`. */
  const setup = () => {
    const { g, inside } = inCave(7)
    inside.intro = 0
    const plan = inside.state.plan!
    const mid = (i: number) => ({ x: inside.x + plan.rooms[i]!.x + plan.rooms[i]!.w / 2, y: inside.y + plan.rooms[i]!.y + plan.rooms[i]!.h / 2 })
    Object.assign(g.player, mid(plan.startRoom))
    // No moves: a shot that reached a walker would alert it (that is its own case below).
    g.player.moves.length = 0
    return { g, inside, plan, mid }
  }

  it('leave one in another room unaware, and make one in the player’s own room (within range) hunt for `memory` seconds', () => {
    const { g, plan, mid } = setup()
    const far = spawnEnemy(g, 'zubat', mid(plan.stairsRoom).x, mid(plan.stairsRoom).y)
    const near = spawnEnemy(g, 'zubat', g.player.x + 60, g.player.y)
    step(g, STILL, TICK)
    expect(far.alert).toBe(0)
    expect(near.alert).toBe(CAVE.sight.memory)
  })

  it('remember a player lost from sight for `memory` seconds, then go back to ambling about', () => {
    const { g, plan, mid } = setup()
    const e = spawnEnemy(g, 'zubat', mid(plan.stairsRoom).x, mid(plan.stairsRoom).y)
    e.alert = CAVE.sight.memory
    play(g, CAVE.sight.memory - 0.5)
    expect(e.alert).toBeGreaterThan(0)
    play(g, 1)
    expect(e.alert).toBe(0)
  })

  it('turn on the player who hit them from anywhere, and hunt with the ambush’s longer memory when sprung', () => {
    const { g, inside, plan, mid } = setup()
    const e = spawnEnemy(g, 'zubat', mid(plan.stairsRoom).x, mid(plan.stairsRoom).y)
    e.flash = 0.16
    step(g, STILL, TICK)
    expect(e.alert).toBe(CAVE.sight.memory)
    const room = plan.ambush[0]!
    const rect = plan.rooms[room]!
    const before = g.enemies.length
    Object.assign(g.player, { x: inside.x + rect.x + 24, y: inside.y + rect.y + 24 })
    updateCave(g, inside, TICK)
    const pack = g.enemies.slice(before)
    expect(pack.length).toBeGreaterThan(0)
    expect(pack.every((m) => m.alert === CAVE.sight.ambush)).toBe(true)
  })

  it('keep a far unaware walker where the cave put it, instead of wrapping it back in front of the player', () => {
    const { g, plan, mid } = setup()
    const e = spawnEnemy(g, 'zubat', mid(plan.stairsRoom).x, mid(plan.stairsRoom).y)
    const room = roomAt(plan, e.x - g.place.inside!.x, e.y - g.place.inside!.y)
    play(g, 3)
    expect(roomAt(plan, e.x - g.place.inside!.x, e.y - g.place.inside!.y)).toBe(room)
  })
})

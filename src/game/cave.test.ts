import { describe, expect, it } from 'vitest'
import { caveLevel, drawCaveLevel } from '../data/caveLevels'
import { LIGHT_KINDS } from '../data/lightSources'
import { createRng } from '../engine/rng'
import { CAVE } from '../data/places'
import { CAVE_GEN, PROCGEN } from '../data/procgen'
import { descendCave, updateCave } from './cave'
import { updateAttacks } from './attacks'
import { spawnAttack } from './spawn'
import { chooseOffer, createGame, step } from './game'
import { spawnEnemy } from './enemies'
import { dormant, roomAt } from './dungeon'
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
const inCave = (seed = 5, level = 1) => {
  const g: Game = createGame('charmander', { w: 480, h: 270 }, seed)
  enterPlace(g, 'cave', 0, 0, level)
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
    expect(inside.state.floor).toBe(caveLevel(1).floors)
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
      // The leader takes the HP bar.
      if (plan.sizes[room]! >= lead.minCells) expect(g.bossId).toBe(born.find((e) => e.kind === lead.kind)!.id)
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
    // A room the team has not entered sleeps, flash or not; it wakes once the team is in.
    step(g, STILL, TICK)
    expect(e.alert).toBe(0)
    inside.state.visited.push(plan.stairsRoom)
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

describe.skipIf(!PROCGEN.cave)('rooms and the rock at play', () => {
  const midOf = (inside: ReturnType<typeof inCave>['inside'], i: number) => {
    const r = inside.state.plan!.rooms[i]!
    return { x: inside.x + r.x + r.w / 2, y: inside.y + r.y + r.h / 2 }
  }

  it('wakes a room’s Pokémon only once someone has entered it, and aims at none before', () => {
    const { g, inside } = inCave(7)
    const plan = inside.state.plan!
    const far = plan.stairsRoom
    expect(inside.state.visited).toEqual([plan.startRoom])
    // A corner of the room, clear of the stairs that stand in it.
    const at = { x: inside.x + plan.rooms[far]!.x + 6, y: inside.y + plan.rooms[far]!.y + 6 }
    const e = spawnEnemy(g, 'rattata', at.x, at.y)
    expect(dormant(plan, inside.state.visited, e.x - inside.x, e.y - inside.y)).toBe(true)
    Object.assign(g.player, at)
    updateCave(g, inside, TICK)
    expect(inside.state.visited).toContain(far)
    expect(dormant(plan, inside.state.visited, e.x - inside.x, e.y - inside.y)).toBe(false)
  })

  it('stops a shot at the rock unless it is a ghost or psychic one', () => {
    const { g, inside } = inCave(7)
    const plan = inside.state.plan!
    const r = plan.rooms[plan.startRoom]!
    const mid = midOf(inside, plan.startRoom)
    Object.assign(g.player, mid)
    // Straight out through the room's top wall, away from any corridor mouth.
    const shoot = (type: 'fire' | 'ghost') => spawnAttack(g, { move: 'ember', type, visual: 'ember', x: inside.x + r.x + 6, y: inside.y + r.y + 6, shape: { kind: 'circle', r: 4 }, motion: { kind: 'linear', vx: 0, vy: -200 }, damage: 1, knockback: 0, ttl: 2 })
    const fire = shoot('fire')
    const ghost = shoot('ghost')
    updateAttacks(g, 0.5)
    expect(fire.age).toBeGreaterThanOrEqual(fire.ttl)
    expect(ghost.age).toBeLessThan(ghost.ttl)
  })
})

describe.skipIf(!PROCGEN.cave)('the dark’s spawns', () => {
  it('never come into a room a player stands in', () => {
    const { g, inside } = inCave(7)
    const plan = inside.state.plan!
    const r = plan.rooms[plan.startRoom]!
    Object.assign(g.player, { x: inside.x + r.x + r.w / 2, y: inside.y + r.y + r.h / 2 })
    // The start room is the only one visited and the player is in it: nothing may spawn, however long they stay.
    for (let i = 0; i < 6000; i++) updateCave(g, inside, TICK)
    expect(g.enemies.length).toBe(0)
  })
})

describe.skipIf(!PROCGEN.cave)('the cave’s light sources', () => {
  it('turn on when a player walks up to them, and stay on', () => {
    const { g, inside } = inCave(7)
    const { x: lx, y: ly } = inside.state.sources[0]!
    const { rx, time, blink } = LIGHT_KINDS.crystal
    const on = () => inside.state.sources.map((k, i) => (k.on ? i : -1)).filter((i) => i >= 0)
    expect(on()).toEqual([])
    // Near, but not against it: nothing.
    Object.assign(g.player, { x: inside.x + lx + rx + 8, y: inside.y + ly })
    updateCave(g, inside, TICK)
    expect(on()).toEqual([])
    Object.assign(g.player, { x: inside.x + lx + rx - 3, y: inside.y + ly })
    updateCave(g, inside, TICK)
    expect(on()).toContain(0)
    // It stays on after the player walks off, then goes off.
    Object.assign(g.player, { x: inside.x + lx + 400, y: inside.y + ly })
    updateCave(g, inside, time - blink)
    expect(on()).toContain(0)
    updateCave(g, inside, blink + 1)
    expect(on()).toEqual([])
  })

  it('grows with its level: more floors, bigger floors, a shorter clock, hidden traps and a richer chest', () => {
    const shallow = inCave(5, 1)
    const deep = inCave(5, 5)
    expect(caveLevel(5).floors).toBeGreaterThan(caveLevel(1).floors)
    expect(deep.inside.left).toBeLessThan(shallow.inside.left)
    expect(deep.inside.state.plan!.rooms.length).toBeGreaterThan(shallow.inside.state.plan!.rooms.length)
    expect(shallow.inside.state.traps).toHaveLength(0)
    expect(deep.inside.state.traps).toHaveLength(caveLevel(5).traps)
    for (let i = 0; i < caveLevel(5).floors; i++) descendCave(deep.g, deep.inside)
    expect(deep.inside.state.floor).toBe(caveLevel(5).floors)
    expect(deep.inside.state.chest).not.toBeNull()
    const before = deep.g.pickups.length
    deep.inside.state.house = true
    Object.assign(deep.g.player, { x: deep.inside.x + deep.inside.state.chest!.x, y: deep.inside.y + deep.inside.state.chest!.y })
    for (let i = 0; i < 120; i++) updateCave(deep.g, deep.inside, TICK)
    expect(deep.inside.state.chest!.open).toBe(true)
    expect(deep.g.pickups.length - before).toBeGreaterThan(8)
  })

  it('springs a hidden trap once, as a rockfall under whoever stepped on it', () => {
    const { g, inside } = inCave(5, 3)
    const trap = inside.state.traps[0]!
    Object.assign(g.player, { x: inside.x + trap.x, y: inside.y + trap.y })
    const before = g.hazards.length
    updateCave(g, inside, TICK)
    expect(trap.done).toBe(true)
    expect(g.hazards.length).toBe(before + 1)
    updateCave(g, inside, TICK)
    expect(g.hazards.length).toBe(before + 1)
  })

  it('draws a level for an entrance from the time of the run: only the shallow ones early', () => {
    for (let seed = 1; seed < 40; seed++) {
      const early = drawCaveLevel(createRng(seed), 60)
      expect(early).toBe(1)
    }
    const deep = Array.from({ length: 200 }, (_, i) => drawCaveLevel(createRng(i + 1), 1500))
    expect(Math.max(...deep)).toBeGreaterThanOrEqual(4)
  })
})

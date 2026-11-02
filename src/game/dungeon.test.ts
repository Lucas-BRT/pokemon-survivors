import { describe, expect, it } from 'vitest'
import { createRng } from '../engine/rng'
import { fits, keepOn } from './arenaFloor'
import { CAVE_GEN } from '../data/procgen'
import { dungeonNav, floorShapes, generateFloor, generateFloorV2, roomAt, roomDistances, type DungeonFloor } from './dungeon'

const floors = (index: number) => Array.from({ length: 40 }, (_, seed) => generateFloor(createRng(seed + 1), index))

const onFloor = (f: DungeonFloor, [x, y]: readonly [number, number], r = 0) => floorShapes(f).some((s) => fits(s, x, y, r))

describe('generateFloor', () => {
  it('joins every room, puts the stairs in the room the most corridors away and everything else on the floor', () => {
    for (const index of [0, 1]) {
      for (const f of floors(index)) {
        const dist = roomDistances(f, [f.startRoom])
        expect(dist.every((d) => Number.isFinite(d))).toBe(true)
        expect(dist[f.stairsRoom]).toBe(Math.max(...dist))
        expect(roomAt(f, ...f.stairs)).toBe(f.stairsRoom)
        expect(roomAt(f, ...f.start)).toBe(f.startRoom)
        for (const p of [...f.items, ...f.crystals, ...f.rocks]) expect(onFloor(f, p, 4)).toBe(true)
      }
    }
  })

  it('leaves room for the player along every corridor', () => {
    for (const f of floors(1)) {
      for (const link of f.links) {
        for (const [x, y] of link.path) expect(onFloor(f, [x, y], 12)).toBe(true)
      }
    }
  })

  it('funnels a body a few px off a corridor line into it, instead of catching it on the corner', () => {
    for (const f of floors(1)) {
      const shapes = floorShapes(f)
      for (const link of f.links) {
        const room = f.rooms[link.a]!
        const [cx, cy] = link.path[0]!
        const across = link.path[1]![0] !== cx
        // A body as wide as `PLAYER_FOOT` 16 px off the line (7 past where it fits the corridor), walking straight out of the room.
        for (const off of [-16, 16]) {
          const o = across ? { x: room.x + room.w - 24, y: cy + off } : { x: cx + off, y: room.y + room.h - 24 }
          for (let i = 0; i < 40; i++) {
            if (across) o.x += 1.5
            else o.y += 1.5
            keepOn(shapes, [], o, 8)
          }
          expect(across ? o.x : o.y).toBeGreaterThan((across ? room.x + room.w : room.y + room.h) + 20)
        }
      }
    }
  })

  it('lays out the same floor from the same seed', () => {
    expect(generateFloor(createRng(9), 1)).toEqual(generateFloor(createRng(9), 1))
  })
})

describe('dungeonNav', () => {
  it('sends a walker in another room into the corridor toward the player, and lets one in the same room go straight', () => {
    for (const f of floors(1)) {
      const [px, py] = f.start
      const nav = dungeonNav(f, px, py)!
      const dist = roomDistances(f, [f.startRoom])
      const out = { x: 0, y: 0 }
      expect(nav(px + 3, py + 3, out)).toBe(false)
      const far = f.rooms.findIndex((_, i) => dist[i]! > 0)
      const r = f.rooms[far]!
      expect(nav(r.x + r.w / 2, r.y + r.h / 2, out)).toBe(true)
      // The waypoint is the first bend of a corridor out of that room, toward a room one corridor closer.
      const link = f.links.find((l) => (l.a === far && l.path[1]![0] === out.x && l.path[1]![1] === out.y) || (l.b === far && l.path[2]![0] === out.x && l.path[2]![1] === out.y))
      expect(link).toBeDefined()
      expect(dist[link!.a === far ? link!.b : link!.a]).toBe(dist[far]! - 1)
    }
  })
})

describe('generateFloorV2', () => {
  const floors2 = (index: number) => Array.from({ length: 60 }, (_, seed) => generateFloorV2(createRng(seed + 1), index))

  it('joins every room (some grid cells left empty), with loops to choose routes from, the stairs the most corridors away', () => {
    for (const index of [0, 1, 2]) {
      const grid = CAVE_GEN.grids[index]!
      for (const f of floors2(index)) {
        const dist = roomDistances(f, [f.startRoom])
        expect(dist.every((d) => Number.isFinite(d))).toBe(true)
        expect(dist[f.stairsRoom]).toBe(Math.max(...dist))
        expect(f.rooms.length).toBeLessThan(grid.cols * grid.rows)
        expect(f.rooms.length).toBeGreaterThanOrEqual(Math.floor(grid.cols * grid.rows * (1 - CAVE_GEN.drop[index]!)))
        // A tree: one corridor fewer than rooms, so one way between any two rooms (loops only if `CAVE_GEN.loops` asks).
        if (CAVE_GEN.loops === 0) expect(f.links.length).toBe(f.rooms.length - 1)
        else expect(f.links.length).toBeGreaterThanOrEqual(f.rooms.length - 1)
        expect(roomAt(f, ...f.stairs)).toBe(f.stairsRoom)
        expect(roomAt(f, ...f.start)).toBe(f.startRoom)
      }
    }
  })

  it.skipIf(CAVE_GEN.loops !== 0)('has one way to the stairs: every room but the start is reached through one corridor from the room before it, and no room is joined twice', () => {
    for (const index of [0, 1, 2]) {
      for (const f of floors2(index)) {
        const dist = roomDistances(f, [f.startRoom])
        // Each room has exactly one neighbor one step nearer to the start (a loop would give a second way in).
        f.rooms.forEach((_, room) => {
          if (room === f.startRoom) return
          const nearer = f.links.filter((l) => (l.a === room && dist[l.b] === dist[room]! - 1) || (l.b === room && dist[l.a] === dist[room]! - 1))
          expect(nearer).toHaveLength(1)
          // And none of its other corridors leads to a room as near as it.
          for (const l of f.links.filter((l) => l.a === room || l.b === room)) expect(dist[l.a === room ? l.b : l.a]).not.toBe(dist[room])
        })
        const pairs = f.links.map((l) => `${l.a}-${l.b}`)
        expect(new Set(pairs).size).toBe(pairs.length)
      }
    }
  })

  it('sets rooms aside as ambushes, each with its prize inside it, never the start or the stairs', () => {
    for (const index of [0, 1, 2]) {
      for (const f of floors2(index)) {
        expect(f.ambush).toHaveLength(CAVE_GEN.ambush[index]!)
        expect(new Set(f.ambush).size).toBe(f.ambush.length)
        expect(f.prizes).toHaveLength(f.ambush.length)
        f.ambush.forEach((room, i) => {
          expect(room).not.toBe(f.startRoom)
          expect(room).not.toBe(f.stairsRoom)
          expect(roomAt(f, ...f.prizes[i]!)).toBe(room)
        })
        for (const p of [...f.items, ...f.crystals, ...f.rocks, ...f.prizes]) expect(onFloor(f, p, 4)).toBe(true)
      }
    }
  })

  it('leaves room for the player along every corridor, and lays out the same floor from the same seed', () => {
    for (const f of floors2(2)) for (const link of f.links) for (const [x, y] of link.path) expect(onFloor(f, [x, y], 12)).toBe(true)
    expect(generateFloorV2(createRng(9), 2)).toEqual(generateFloorV2(createRng(9), 2))
    expect(generateFloorV2(createRng(9), 2)).not.toEqual(generateFloorV2(createRng(10), 2))
  })
})

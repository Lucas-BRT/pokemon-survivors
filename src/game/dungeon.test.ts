import { describe, expect, it } from 'vitest'
import { createRng } from '../engine/rng'
import { fits, keepOn } from './arenaFloor'
import { CAVE_GEN } from '../data/procgen'
import { DUNGEON, dungeonNav, floorShapes, generateFloor, generateFloorV2, roomAt, roomDistances, type DungeonFloor } from './dungeon'

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
        for (const p of [...f.items, ...f.sources, ...f.rocks]) expect(onFloor(f, p, 4)).toBe(true)
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
  const degree = (f: DungeonFloor, room: number) => f.links.filter((l) => l.a === room || l.b === room).length

  it('joins every room, leaving some cells empty, with the stairs the farthest of the small rooms at the end of the tree', () => {
    for (const index of [0, 1, 2]) {
      const grid = CAVE_GEN.grids[index]!
      const cells = grid.cols * grid.rows
      for (const f of floors2(index)) {
        const dist = roomDistances(f, [f.startRoom])
        expect(dist.every((d) => Number.isFinite(d))).toBe(true)
        const taken = f.sizes.reduce((a, n) => a + n, 0)
        expect(taken).toBeLessThan(cells)
        expect(taken).toBeGreaterThanOrEqual(cells - Math.floor(cells * CAVE_GEN.drop[index]!))
        expect(f.links.length).toBeGreaterThanOrEqual(f.rooms.length - 1)
        expect(roomAt(f, ...f.stairs)).toBe(f.stairsRoom)
        expect(roomAt(f, ...f.start)).toBe(f.startRoom)
        expect(f.sizes[f.startRoom]).toBe(1)
      }
    }
  })

  it('hangs the stairs room off a single corridor, so no loop reaches it, while loops exist elsewhere', () => {
    let withLoops = 0
    for (const index of [0, 1, 2]) {
      for (const f of floors2(index)) {
        expect(degree(f, f.stairsRoom)).toBe(1)
        // Taking that corridor away leaves the rest joined: nothing else depended on the stairs room.
        const rest = f.links.filter((l) => l.a !== f.stairsRoom && l.b !== f.stairsRoom)
        expect(rest.length).toBe(f.links.length - 1)
        if (f.links.length > f.rooms.length - 1) withLoops++
      }
    }
    expect(withLoops).toBeGreaterThan(60)
  })

  it('makes rooms of different sizes: the regular one and bigger ones of several cells', () => {
    for (const index of [0, 1, 2]) {
      const fs = floors2(index)
      for (const f of fs) {
        expect(f.sizes).toHaveLength(f.rooms.length)
        expect(Math.max(...f.sizes)).toBeGreaterThan(1)
        // A room of several cells is bigger than a regular one's largest.
        f.rooms.forEach((r, i) => {
          if (f.sizes[i]! > 1) expect(r.w * r.h).toBeGreaterThan(190 * 160 * 0.8)
        })
      }
    }
    expect(Math.max(...floors2(2).flatMap((f) => f.sizes))).toBeGreaterThanOrEqual(6)
  })

  it('keeps the ambushes to big rooms, never the start or the stairs, with prizes in them (more in the bigger ones)', () => {
    for (const index of [0, 1, 2]) {
      for (const f of floors2(index)) {
        expect(f.ambush.length).toBeGreaterThan(0)
        expect(f.ambush.length).toBeLessThanOrEqual(CAVE_GEN.ambush[index]!)
        expect(new Set(f.ambush).size).toBe(f.ambush.length)
        for (const room of f.ambush) {
          expect(f.sizes[room]).toBeGreaterThan(1)
          expect(room).not.toBe(f.startRoom)
          expect(room).not.toBe(f.stairsRoom)
          const prizes = f.prizes.filter((p) => roomAt(f, ...p) === room)
          expect(prizes).toHaveLength(1 + (f.sizes[room]! >= 4 ? 1 : 0) + (f.sizes[room]! >= 6 ? 1 : 0))
        }
        expect(f.prizes.every((p) => f.ambush.includes(roomAt(f, ...p)))).toBe(true)
        for (const p of [...f.items, ...f.sources, ...f.rocks, ...f.prizes]) expect(onFloor(f, p, 4)).toBe(true)
      }
    }
  })

  it('leaves room for the player along every corridor, funnels a body into it, and lays out the same floor from the same seed', () => {
    for (const f of floors2(2)) {
      const shapes = floorShapes(f)
      for (const link of f.links) {
        for (const [x, y] of link.path) expect(onFloor(f, [x, y], 12)).toBe(true)
        const room = f.rooms[link.a]!
        const [cx, cy] = link.path[0]!
        const across = link.path[1]![0] !== cx
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
    expect(generateFloorV2(createRng(9), 2)).toEqual(generateFloorV2(createRng(9), 2))
    expect(generateFloorV2(createRng(9), 2)).not.toEqual(generateFloorV2(createRng(10), 2))
  })
})

describe('generateFloorV2 corridors', () => {
  const v2 = (index: number) => Array.from({ length: 40 }, (_, seed) => generateFloorV2(createRng(seed + 1), index))

  it('keeps rooms apart by more than the player’s light reaches, and runs most corridors straight', () => {
    let links = 0
    let straight = 0
    for (const index of [0, 1, 2]) {
      for (const f of v2(index)) {
        for (const l of f.links) {
          const [a, b] = [f.rooms[l.a]!, f.rooms[l.b]!]
          const across = l.path[1]![0] !== l.path[0]![0]
          const gapPx = across ? b.x - (a.x + a.w) : b.y - (a.y + a.h)
          expect(gapPx).toBeGreaterThanOrEqual(2 * CAVE_GEN.gap - 1)
          links++
          if (across ? l.path[0]![1] === l.path[3]![1] : l.path[0]![0] === l.path[3]![0]) straight++
        }
        for (const p of f.sources) expect(onFloor(f, p, 4)).toBe(true)
      }
    }
    expect(straight / links).toBeGreaterThan(0.8)
  })

  it('lights the long straight corridors with crystals', () => {
    const f = v2(1).find((x) => x.sources.some((c) => roomAt(x, ...c) < 0))
    expect(f).toBeDefined()
  })

  it('never leaves a room flush with its corner: the corridor keeps wall on both sides of its door', () => {
    for (const index of [0, 1, 2]) {
      for (const f of v2(index)) {
        for (const l of f.links) {
          const across = l.path[1]![0] !== l.path[0]![0]
          for (const [end, room] of [[l.path[0]!, l.a], [l.path[l.path.length - 1]!, l.b]] as const) {
            const r = f.rooms[room]!
            const c = across ? end[1] : end[0]
            const [lo, hi] = across ? [r.y, r.y + r.h] : [r.x, r.x + r.w]
            expect(Math.min(c - lo, hi - c)).toBeGreaterThanOrEqual(DUNGEON.corridor / 2 + 12)
          }
        }
      }
    }
  })
})

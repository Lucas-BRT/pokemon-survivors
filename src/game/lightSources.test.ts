import { describe, expect, it } from 'vitest'
import { LIGHT_FIELD } from '../data/lightSources'
import { CAVE } from '../data/places'
import { createRng } from '../engine/rng'
import { DUNGEON, generateFloorV2, type DungeonFloor } from './dungeon'
import { atDepth, attenuation, playersDistance, seenLevels, spaceEnergies, spaceLevels, type LightSource } from './lightSources'
import { hostOf, spaceSdf, spacesOf, subtractRect, type Shape } from './spaces'

const n = { ...CAVE.lit, ...LIGHT_FIELD }

const floor = (): DungeonFloor => generateFloorV2(createRng(11), 1)

const spaceAt = (plan: DungeonFloor, x: number, y: number) => hostOf(spacesOf(plan), x, y)
const distToSpace = (plan: DungeonFloor, s: number, x: number, y: number) => Math.max(0, spaceSdf(spacesOf(plan), s, x, y))
const spaceRects = (plan: DungeonFloor, s: number) => spacesOf(plan).spaces[s]!.region.filter((sh): sh is Extract<Shape, { kind: 'rect' }> => sh.kind === 'rect')
const spaceArea = (plan: DungeonFloor, s: number) => spacesOf(plan).spaces[s]!.area

const source = (x: number, y: number, on = true): LightSource => ({ x, y, kind: 'crystal', on, left: 20, age: 5 })

const middle = (plan: DungeonFloor, room: number) => {
  const r = plan.rooms[room]!
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** A room that is not the one standing farthest away, with another room well away from it. */
const pair = (plan: DungeonFloor) => {
  const a = plan.startRoom
  let b = a
  let far = 0
  plan.rooms.forEach((_, i) => {
    const d = distToSpace(plan, a, middle(plan, i).x, middle(plan, i).y)
    if (d > far) ((far = d), (b = i))
  })
  return { a, b, far }
}

describe('a cave’s light sources', () => {
  it('give no light at all while off: every space stays at its floor level', () => {
    const plan = floor()
    const sources = plan.sources.map(([x, y]) => source(x, y, false))
    expect(spaceEnergies(spacesOf(plan), sources, n).every((e) => e === 0)).toBe(true)
    expect(spaceLevels(spacesOf(plan), sources, n).every((l) => Math.abs(l - n.floor) < 1e-9)).toBe(true)
  })

  it('light the space they stand in, and a corridor’s also the rooms it opens into', () => {
    const plan = floor()
    const inRoom = plan.sources.find(([x, y]) => spaceAt(plan, x, y) >= 0 && spaceAt(plan, x, y) < plan.rooms.length)!
    const room = spaceAt(plan, inRoom[0], inRoom[1])
    const e = spaceEnergies(spacesOf(plan), [source(inRoom[0], inRoom[1])], n)
    expect(e[room]).toBe(1)
    expect(e.filter((x, s) => s !== room && x > 0)).toEqual([])
    const inCorridor = plan.sources.find(([x, y]) => spaceAt(plan, x, y) >= plan.rooms.length)
    if (inCorridor) {
      const corridor = spaceAt(plan, inCorridor[0], inCorridor[1])
      const ec = spaceEnergies(spacesOf(plan), [source(inCorridor[0], inCorridor[1])], n)
      expect(ec[corridor]).toBe(1)
      expect(ec.slice(0, plan.rooms.length).some((x) => x > 0 && x < 1)).toBe(true)
    }
  })

  it('more sources on, or a smaller space, mean more light, never above the ceiling', () => {
    const plan = floor()
    const [x, y] = plan.sources.find(([sx, sy]) => spaceAt(plan, sx, sy) === plan.startRoom) ?? [middle(plan, plan.startRoom).x, middle(plan, plan.startRoom).y]
    const one = spaceLevels(spacesOf(plan), [source(x, y)], n)[plan.startRoom]!
    const two = spaceLevels(spacesOf(plan), [source(x, y), source(x + 1, y + 1)], n)[plan.startRoom]!
    expect(two).toBeGreaterThan(one)
    expect(two).toBeLessThanOrEqual(n.max)
    expect(one).toBeGreaterThan(n.floor)
  })
})

describe('how the light is seen from another space', () => {
  it('attenuation is 1 inside, keeps a floor of α while it is near, and fades to nothing past D_v + D_f', () => {
    expect(attenuation(0, n)).toBe(1)
    let before = 1
    for (let d = 10; d <= n.remoteReach; d += 40) {
      const a = attenuation(d, n)
      expect(a).toBeLessThanOrEqual(before)
      expect(a).toBeGreaterThanOrEqual(n.remoteMin - 1e-9)
      before = a
    }
    expect(attenuation(n.remoteReach + n.remoteFade, n)).toBe(0)
    expect(attenuation(n.remoteReach + n.remoteFade + 500, n)).toBe(0)
  })

  it('with no source on, a visited room is at its floor level wherever the players are, and a space not visited is dark', () => {
    const plan = floor()
    const levels = spaceLevels(spacesOf(plan), [], n)
    const { a, b } = pair(plan)
    const near = seenLevels(spacesOf(plan), levels, (s) => s === a, [middle(plan, a)], n)
    const far = seenLevels(spacesOf(plan), levels, (s) => s === a, [middle(plan, b)], n)
    expect(near.level[a]).toBeCloseTo(n.floor)
    expect(far.level[a]).toBeCloseTo(n.floor)
    expect(near.level[b]).toBe(0)
    expect(near.level.slice(plan.rooms.length).every((l) => l === 0)).toBe(true)
  })

  it('a room with a source on is the same all over it, and weaker (but still above its floor) from another room, weakening with the distance', () => {
    const plan = floor()
    const { a, b } = pair(plan)
    const lamp = source(middle(plan, a).x, middle(plan, a).y)
    const levels = spaceLevels(spacesOf(plan), [lamp], n)
    const r = plan.rooms[a]!
    const corner = (x: number, y: number) => seenLevels(spacesOf(plan), levels, (s) => s === a, [{ x, y }], n).level[a]!
    // Next to the lamp, in any corner of the room: the same, the room's own level.
    expect(corner(lamp.x, lamp.y)).toBeCloseTo(levels[a]!)
    expect(corner(r.x + 2, r.y + 2)).toBeCloseTo(levels[a]!)
    expect(corner(r.x + r.w - 2, r.y + r.h - 2)).toBeCloseTo(levels[a]!)
    // From the other room: weaker than inside, above the floor.
    const from = middle(plan, b)
    const remote = corner(from.x, from.y)
    expect(remote).toBeLessThan(levels[a]!)
    expect(remote).toBeGreaterThan(n.floor)
    // And the farther the weaker.
    let before = Infinity
    for (const d of [0, 50, 150, 300, 500]) {
      const level = corner(r.x - d, r.y + r.h / 2)
      expect(level).toBeLessThanOrEqual(before)
      before = level
    }
  })

  it('light comes only from the nearest player, and a space not visited gets none however strong the source', () => {
    const plan = floor()
    const { a, b } = pair(plan)
    const levels = spaceLevels(spacesOf(plan), [source(middle(plan, a).x, middle(plan, a).y)], n)
    const both = seenLevels(spacesOf(plan), levels, (s) => s === a, [middle(plan, a), middle(plan, b)], n)
    expect(both.level[a]).toBeCloseTo(levels[a]!)
    expect(playersDistance(spacesOf(plan), a, [middle(plan, a), middle(plan, b)])).toBe(0)
    expect(seenLevels(spacesOf(plan), levels, () => false, [middle(plan, a)], n).level[a]).toBe(0)
  })
})

describe('the deeper the floor, the darker a room that nobody lit', () => {
  it('multiplies the floor level by `depth` for each floor down, and lights still bring a room up from there', () => {
    expect(atDepth(n, 0).floor).toBeCloseTo(n.floor)
    let before = n.floor
    for (let f = 1; f <= 4; f++) {
      const d = atDepth(n, f)
      expect(d.floor).toBeCloseTo(n.floor * n.depth ** f)
      expect(d.floor).toBeLessThan(before)
      before = d.floor
    }
    const plan = floor()
    const none = (f: number) => spaceLevels(spacesOf(plan), [], atDepth(n, f))[plan.startRoom]!
    expect(none(3)).toBeLessThan(none(0))
    // A source on lifts the room above its dark start on every floor, and the ceiling stays the same.
    const [x, y] = [middle(plan, plan.startRoom).x, middle(plan, plan.startRoom).y]
    for (const f of [0, 2, 4]) {
      const lit1 = spaceLevels(spacesOf(plan), [source(x, y)], atDepth(n, f))[plan.startRoom]!
      expect(lit1).toBeGreaterThan(none(f))
      expect(lit1).toBeLessThanOrEqual(n.max)
    }
    // A visited room with nothing on is at the dark start of its floor from anywhere.
    const levels = spaceLevels(spacesOf(plan), [], atDepth(n, 3))
    const seen = seenLevels(spacesOf(plan), levels, (s) => s === plan.startRoom, [middle(plan, plan.startRoom)], atDepth(n, 3))
    expect(seen.level[plan.startRoom]).toBeCloseTo(atDepth(n, 3).floor)
  })
})

describe('the floor of a corridor', () => {
  const inter = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

  it('takes a rectangle out of another into pieces that do not overlap it and add up to what is left', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    const q = { x: 30, y: 10, w: 40, h: 20 }
    const pieces = subtractRect(r, q)
    expect(pieces.reduce((a, p) => a + p.w * p.h, 0)).toBe(100 * 50 - 40 * 20)
    for (const p of pieces) expect(inter(p, q)).toBe(0)
    expect(subtractRect(r, { x: 200, y: 0, w: 5, h: 5 })).toEqual([r])
  })

  it('is only what lies between the rooms: never inside one, no thicker than the corridor, nothing of the corridor lost', () => {
    let raw = 0
    let clipped = 0
    for (let seed = 1; seed <= 12; seed++) {
      for (const index of [0, 1, 2]) {
        const plan = generateFloorV2(createRng(seed), index)
        plan.links.forEach((link, l) => {
          const pieces = spaceRects(plan, plan.rooms.length + l)
          // Never inside a room, and no more than one corridor thick.
          for (const p of pieces) {
            for (const room of plan.rooms) expect(inter(p, room)).toBeLessThan(1e-6)
            expect(Math.min(p.w, p.h)).toBeLessThanOrEqual(DUNGEON.corridor + 1e-6)
          }
          // Everything of the corridor that was outside the rooms is still there (sampled on the raw stretches).
          for (const r of link.rects) {
            for (let i = 0; i <= 8; i++) {
              for (let j = 0; j <= 8; j++) {
                const x = r.x + (r.w * (i + 0.5)) / 9
                const y = r.y + (r.h * (j + 0.5)) / 9
                if (plan.rooms.some((room) => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h)) continue
                expect(pieces.some((p) => x >= p.x - 1e-6 && x <= p.x + p.w + 1e-6 && y >= p.y - 1e-6 && y <= p.y + p.h + 1e-6)).toBe(true)
              }
            }
          }
          raw += link.rects.reduce((a, r) => a + r.w * r.h, 0)
          clipped += spaceArea(plan, plan.rooms.length + l)
        })
      }
    }
    // The raw stretches claimed far more than the corridors are.
    expect(clipped).toBeLessThan(raw * 0.8)
    expect(clipped).toBeGreaterThan(0)
  })
})

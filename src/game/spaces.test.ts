import { describe, expect, it } from 'vitest'
import { LIGHT_FIELD } from '../data/lightSources'
import { CAVE } from '../data/places'
import { atDepth, attenuation, playersDistance, seenLevels, spaceDistances, spaceEnergies, spaceLevels, type LightSource } from './lightSources'
import { chamberOf, hostOf, makeSpace, regionSdf, shapeArea, shapeSdf, spaceMapOf, spaceSdf, type Shape } from './spaces'

const n = { ...CAVE.lit, ...LIGHT_FIELD }
const source = (x: number, y: number, on = true): LightSource => ({ x, y, kind: 'crystal', on, left: 20, age: 5 })

/** An L: a 100×100 square with its top-right 50×50 corner cut out (concave at (50, 50)). */
const L: Shape = { kind: 'poly', pts: [[0, 0], [50, 0], [50, 50], [100, 50], [100, 100], [0, 100]] }
/** A star with five points: concave, its edges at angles. */
const STAR: Shape = {
  kind: 'poly',
  pts: Array.from({ length: 10 }, (_, i): [number, number] => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 100 : 40
    return [Math.cos(a) * r, Math.sin(a) * r]
  }),
}

describe('shapes: the signed distance and the area', () => {
  it('rectangle: negative inside (the distance to the nearest side), the distance to it outside', () => {
    const r: Shape = { kind: 'rect', x: 0, y: 0, w: 40, h: 20 }
    expect(shapeSdf(r, 20, 10)).toBe(-10)
    expect(shapeSdf(r, 5, 10)).toBe(-5)
    expect(shapeSdf(r, 60, 10)).toBe(20)
    expect(shapeSdf(r, 43, 24)).toBeCloseTo(5)
    expect(shapeArea(r)).toBe(800)
  })

  it('circle: the distance to the middle less the radius', () => {
    const c: Shape = { kind: 'circle', x: 10, y: 10, r: 30 }
    expect(shapeSdf(c, 10, 10)).toBe(-30)
    expect(shapeSdf(c, 50, 10)).toBeCloseTo(10)
    expect(shapeArea(c)).toBeCloseTo(Math.PI * 900)
  })

  it('a concave polygon: inside and outside right, even in the notch, with the distance to the nearest edge', () => {
    expect(shapeArea(L)).toBe(7500)
    // Inside the arms, and the notch (outside) at the cut-out corner.
    expect(shapeSdf(L, 25, 25)).toBeLessThan(0)
    expect(shapeSdf(L, 75, 75)).toBeLessThan(0)
    expect(shapeSdf(L, 75, 25)).toBeGreaterThan(0)
    // 25 px from both edges of the notch's corner at (50, 50) is not 25: the nearest edge point is the corner (or its sides).
    expect(shapeSdf(L, 75, 25)).toBeCloseTo(25)
    expect(shapeSdf(L, 60, 40)).toBeCloseTo(10)
    expect(shapeSdf(L, 25, 75)).toBe(-25)
  })

  it('a star: the notches between its points are outside, its middle and its points inside; the same in either point order', () => {
    expect(shapeSdf(STAR, 0, 0)).toBeLessThan(0)
    expect(shapeSdf(STAR, 0, -90)).toBeLessThan(0)
    // Between two points, at the radius of the points: outside.
    const a = ((1 / 10) * 2 + 0.5 / 5) * Math.PI - Math.PI / 2
    expect(shapeSdf(STAR, Math.cos(a) * 60, Math.sin(a) * 60)).toBeGreaterThan(0)
    const reversed: Shape = { kind: 'poly', pts: [...STAR.pts].reverse() }
    for (const [x, y] of [[0, 0], [0, -90], [60, 60], [-30, 20]] as const) expect(shapeSdf(reversed, x, y)).toBeCloseTo(shapeSdf(STAR, x, y))
    expect(shapeArea(STAR)).toBeGreaterThan(0)
  })

  it('a region is as near as its nearest shape, and a space adds the areas up', () => {
    const region: Shape[] = [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { kind: 'circle', x: 100, y: 0, r: 5 }]
    expect(regionSdf(region, 50, 5)).toBeCloseTo(40)
    const space = makeSpace('room', region)
    expect(space.area).toBeCloseTo(100 + Math.PI * 25)
    expect(space.bounds).toEqual({ x0: 0, y0: -5, x1: 105, y1: 10 })
  })
})

describe('the light on a floor of other shapes', () => {
  // A floor of three spaces: an L-shaped hall, a star-shaped cavern at the end of a corridor, and the corridor between them.
  const hall = makeSpace('room', [L])
  const corridor = makeSpace('corridor', [{ kind: 'rect', x: 100, y: 60, w: 100, h: 20 }])
  const cavern = makeSpace('room', [{ ...STAR, pts: STAR.pts.map(([x, y]) => [x + 300, y + 70] as const) }])
  const map = spaceMapOf([hall, corridor, cavern], [{ a: 0, b: 1, x: 100, y: 70 }, { a: 1, b: 2, x: 200, y: 70 }])

  it('finds the space that holds a point, whatever its shape', () => {
    expect(hostOf(map, 25, 25)).toBe(0)
    expect(hostOf(map, 75, 25)).toBe(-1)
    expect(hostOf(map, 150, 70)).toBe(1)
    expect(hostOf(map, 300, 70)).toBe(2)
    expect(map.neighbors[1]).toEqual([0, 2])
  })

  it('lights a space from its sources by its own area: the same source lights a smaller space more', () => {
    const levels = spaceLevels(map, [source(25, 25), source(300, 70)], n)
    expect(levels[0]).toBeGreaterThan(n.floor)
    expect(levels[2]).toBeGreaterThan(n.floor)
    // The star covers more than the L-shaped hall: the same one source lights it less.
    expect(cavern.area).toBeGreaterThan(hall.area)
    expect(levels[0]!).toBeGreaterThan(levels[2]!)
    // A source in the corridor lights the spaces it opens into, less the farther.
    const e = spaceEnergies(map, [source(150, 70)], n)
    expect(e[1]).toBe(1)
    expect(e[0]! + e[2]!).toBeGreaterThanOrEqual(0)
  })

  it('weakens the light seen from another space by the distance to it, and keeps the room it is in at full', () => {
    const levels = spaceLevels(map, [source(25, 25)], n)
    const here = seenLevels(map, levels, () => true, [{ x: 25, y: 75 }], n)
    const there = seenLevels(map, levels, () => true, [{ x: 300, y: 70 }], n)
    expect(here.level[0]).toBeCloseTo(levels[0]!)
    expect(there.level[0]!).toBeLessThan(here.level[0]!)
    expect(there.level[0]!).toBeGreaterThan(n.floor)
    // The distance is the walk: from the cavern to its door, then the corridor to the hall's door.
    expect(playersDistance(map, 0, [{ x: 300, y: 70 }])).toBeCloseTo(100 + 100)
    expect(playersDistance(map, 1, [{ x: 300, y: 70 }])).toBeCloseTo(100)
    expect(playersDistance(map, 2, [{ x: 300, y: 70 }])).toBe(0)
    expect(attenuation(playersDistance(map, 0, [{ x: 25, y: 75 }]), n)).toBe(1)
  })

  it('a corridor has no base of its own, a room does', () => {
    const levels = spaceLevels(map, [], n)
    const seen = seenLevels(map, levels, () => true, [{ x: 25, y: 25 }], n)
    expect(seen.level[0]).toBeCloseTo(n.floor)
    expect(seen.level[1]).toBeCloseTo(0)
    expect(seen.level[2]).toBeCloseTo(n.floor)
  })
})

describe('the light goes round the rock, not through it', () => {
  // Two rooms side by side with a thin wall between them (10 px), joined only by a long corridor round the bottom.
  const a = makeSpace('room', [{ kind: 'rect', x: 0, y: 0, w: 100, h: 100 }])
  const b = makeSpace('room', [{ kind: 'rect', x: 110, y: 0, w: 100, h: 100 }])
  const way = { ...makeSpace('corridor', [{ kind: 'rect', x: 40, y: 100, w: 130, h: 20 }]), walk: 300 }
  const map = spaceMapOf([a, b, way], [{ a: 0, b: 2, x: 50, y: 100 }, { a: 2, b: 1, x: 160, y: 100 }])

  it('measures the way one walks: a room behind a wall is as far as the way round', () => {
    const player = [{ x: 50, y: 50 }]
    // Straight through the wall it is 10 px; round by the corridor: to the door (50), the corridor's walk (300).
    expect(Math.max(0, spaceSdf(map, 1, 50, 50))).toBeCloseTo(60)
    const far = spaceDistances(map, player)
    expect(far[0]).toBe(0)
    expect(far[2]).toBeCloseTo(50)
    expect(far[1]).toBeCloseTo(50 + 300)
    // So the light of a lamp in the next room is far weaker than the straight line would say.
    const levels = spaceLevels(map, [source(150, 50)], n)
    const seen = seenLevels(map, levels, () => true, player, n)
    expect(seen.factor[1]!).toBeCloseTo(attenuation(350, n))
    expect(seen.factor[1]!).toBeLessThan(attenuation(60, n))
  })

  it('takes the nearest of several players, and a player in the rock counts at the nearest space plus the way to it', () => {
    const both = spaceDistances(map, [{ x: 50, y: 50 }, { x: 150, y: 50 }])
    expect(both).toEqual([0, 0, expect.closeTo(50, 5)])
    const rock = spaceDistances(map, [{ x: 105, y: 50 }])
    // Five px out of room a (or b): that nearest room is at 5, the other round the corridor.
    expect(Math.min(rock[0]!, rock[1]!)).toBeCloseTo(5)
    expect(Math.max(rock[0]!, rock[1]!)).toBeGreaterThan(300)
  })

  it('a space nobody can walk to is as far as the straight line to it', () => {
    const lone = spaceMapOf([a, makeSpace('room', [{ kind: 'rect', x: 300, y: 0, w: 10, h: 10 }])], [])
    expect(spaceDistances(lone, [{ x: 50, y: 50 }])[1]).toBeCloseTo(Math.hypot(250, 40))
  })
})

describe('the treasure chamber is a space like the others', () => {
  const key = {}
  const chamber = chamberOf(key, { x: 0, y: 0, r: 120 })

  it('is one round space: lit by its sources, its own area, the same at any depth rule', () => {
    expect(chamberOf(key, { x: 0, y: 0, r: 120 })).toBe(chamber)
    expect(chamber.spaces).toHaveLength(1)
    expect(chamber.spaces[0]!.area).toBeCloseTo(Math.PI * 120 * 120)
    expect(hostOf(chamber, 100, 30)).toBe(0)
    expect(hostOf(chamber, 130, 0)).toBe(-1)
    const dark = spaceLevels(chamber, [], atDepth(n, 3))[0]!
    const lit3 = spaceLevels(chamber, [source(0, 60), source(60, 0), source(-60, 0)], atDepth(n, 3))[0]!
    expect(lit3).toBeGreaterThan(dark)
    expect(dark).toBeCloseTo(atDepth(n, 3).floor)
    // Seen from inside it is the level it has; the sources on count.
    const seen = seenLevels(chamber, spaceLevels(chamber, [source(0, 60)], n), () => true, [{ x: 0, y: 0 }], n)
    expect(seen.factor[0]).toBe(1)
    expect(seen.level[0]!).toBeGreaterThan(n.floor)
  })
})

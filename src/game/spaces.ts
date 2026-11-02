import type { DungeonFloor, Rect } from './dungeon'
import * as dm from '../engine/dmath'

/**
 * The shapes the cave's light works on, whatever they are. A *region* is a few non-overlapping shapes (a rectangle, a circle or a
 * simple polygon, convex or not); a *space* is a region with a kind (a room, a corridor, the treasure chamber), its area and the
 * spaces next to it; a floor is a `SpaceMap`. Everything the light needs of a place is asked of the region:
 *
 *  - `sdf(x, y)`: the signed distance to it, negative inside (the nearest shape's, so a union is the minimum);
 *  - `area`: the floor it covers (the shapes' areas added up: they must not overlap);
 *  - `bounds`: its box, to leave out what is far from the screen.
 *
 * So a new shape of dungeon (a hexagonal hall, an L-shaped cave, a round chamber) is a new way of building a `SpaceMap`, and the energy,
 * the level, the fall-off with distance and the drawing (`lightSources.ts`, `render/caveDark.ts`, the minimap) stay as they are.
 * Pure arithmetic through `dmath`: every engine agrees.
 */

export type Pt = readonly [number, number]

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  /** A simple polygon (its edges don't cross), convex or concave, its points in either order. */
  | { kind: 'poly'; pts: readonly Pt[] }

export type Region = readonly Shape[]

export type Bounds = { x0: number; y0: number; x1: number; y1: number }

export type SpaceKind = 'room' | 'corridor' | 'chamber'

export type Space = {
  kind: SpaceKind
  region: Region
  area: number
  bounds: Bounds
  /** Whether a visited space of this kind starts at the cave's floor level `L0` (rooms do; a corridor only has what its sources add). */
  base: boolean
  /** The walk through it from one of its two doors to the other, when it isn't the straight line between them (a corridor's bent path). */
  walk?: number
}

/** Where two spaces meet: a corridor's mouth on a room's wall. */
export type Door = { a: number; b: number; x: number; y: number }

export type SpaceMap = { spaces: readonly Space[]; doors: readonly Door[]; neighbors: readonly (readonly number[])[] }

/** Distance from (x, y) to the segment a-b. */
const segmentDistance = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
  return dm.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

/** Whether (x, y) is inside the simple polygon (the even-odd rule: a ray to the right crosses an odd number of edges). */
const insidePoly = (pts: readonly Pt[], x: number, y: number) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!
    const [bx, by] = pts[i]!
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside
  }
  return inside
}

/** The signed distance from (x, y) to a shape: negative inside, 0 on its edge, the distance to it outside. */
export const shapeSdf = (s: Shape, x: number, y: number): number => {
  switch (s.kind) {
    case 'rect': {
      const dx = Math.max(s.x - x, 0, x - (s.x + s.w))
      const dy = Math.max(s.y - y, 0, y - (s.y + s.h))
      if (dx > 0 || dy > 0) return dm.hypot(dx, dy)
      return -Math.min(x - s.x, s.x + s.w - x, y - s.y, s.y + s.h - y)
    }
    case 'circle':
      return dm.hypot(x - s.x, y - s.y) - s.r
    case 'poly': {
      let best = Infinity
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) best = Math.min(best, segmentDistance(x, y, s.pts[j]![0], s.pts[j]![1], s.pts[i]![0], s.pts[i]![1]))
      return insidePoly(s.pts, x, y) ? -best : best
    }
  }
}

/** The signed distance to a region: the nearest of its shapes. */
export const regionSdf = (region: Region, x: number, y: number) => {
  let best = Infinity
  for (const s of region) best = Math.min(best, shapeSdf(s, x, y))
  return best
}

/** The area of a shape (a polygon's by the shoelace formula). */
export const shapeArea = (s: Shape): number => {
  switch (s.kind) {
    case 'rect':
      return s.w * s.h
    case 'circle':
      return Math.PI * s.r * s.r
    case 'poly': {
      let a = 0
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) a += s.pts[j]![0] * s.pts[i]![1] - s.pts[i]![0] * s.pts[j]![1]
      return Math.abs(a) / 2
    }
  }
}

export const shapeBounds = (s: Shape): Bounds => {
  switch (s.kind) {
    case 'rect':
      return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h }
    case 'circle':
      return { x0: s.x - s.r, y0: s.y - s.r, x1: s.x + s.r, y1: s.y + s.r }
    case 'poly':
      return { x0: Math.min(...s.pts.map((p) => p[0])), y0: Math.min(...s.pts.map((p) => p[1])), x1: Math.max(...s.pts.map((p) => p[0])), y1: Math.max(...s.pts.map((p) => p[1])) }
  }
}

/** A space from its shapes (which must not overlap): its area and its box worked out. */
export const makeSpace = (kind: SpaceKind, region: Region, base = kind !== 'corridor'): Space => {
  const boxes = region.map(shapeBounds)
  return {
    kind,
    region,
    area: region.reduce((a, s) => a + shapeArea(s), 0),
    bounds: { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) },
    base,
  }
}

/** The signed distance from (x, y) to space `s` of the map. */
export const spaceSdf = (map: SpaceMap, s: number, x: number, y: number) => regionSdf(map.spaces[s]!.region, x, y)

/** The space holding (x, y): the first whose region contains it (rooms come before corridors), or -1 in the rock. */
export const hostOf = (map: SpaceMap, x: number, y: number) => {
  for (let s = 0; s < map.spaces.length; s++) if (spaceSdf(map, s, x, y) <= 0) return s
  return -1
}

/* ---------------- A dungeon floor's spaces ---------------- */

/** What is left of rectangle `r` once `q` is taken out of it: up to four rectangles that don't overlap `q` (`r` itself when they don't touch). */
export const subtractRect = (r: Rect, q: Rect): Rect[] => {
  const x0 = Math.max(r.x, q.x)
  const y0 = Math.max(r.y, q.y)
  const x1 = Math.min(r.x + r.w, q.x + q.w)
  const y1 = Math.min(r.y + r.h, q.y + q.h)
  if (x0 >= x1 || y0 >= y1) return [r]
  const out: Rect[] = []
  if (y0 > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: y0 - r.y })
  if (y1 < r.y + r.h) out.push({ x: r.x, y: y1, w: r.w, h: r.y + r.h - y1 })
  if (x0 > r.x) out.push({ x: r.x, y: y0, w: x0 - r.x, h: y1 - y0 })
  if (x1 < r.x + r.w) out.push({ x: x1, y: y0, w: r.x + r.w - x1, h: y1 - y0 })
  return out
}

/**
 * The floor a corridor really is: its stretches (`Link.rects`, each a segment of the corridor's path widened by the corridor's width, and
 * running half that past both ends so the bends join) *minus the rooms*. The path starts and ends at a point inside each room, so the raw
 * stretches run well into the rooms (a big room's middle is far from its wall); counted whole, a corridor would claim part of every room
 * it opens into: a tint, an area and a distance that are not the corridor's. Clipped to what lies between the rooms, each piece is at
 * most one corridor wide (`DUNGEON.corridor`) and as long as the gap it crosses plus the bend's overlap.
 */
const corridorFloor = (rooms: readonly Rect[], rects: readonly Rect[]): Rect[] =>
  rects.flatMap((raw) => rooms.reduce<Rect[]>((pieces, room) => pieces.flatMap((p) => subtractRect(p, room)), [raw])).filter((r) => r.w > 0.5 && r.h > 0.5)

/** Where a corridor's path crosses the wall of the room it leaves (`from` is its first point inside the room, `toward` the next). */
const wallCrossing = (room: Rect, from: Pt, toward: Pt): Pt => {
  const across = toward[0] !== from[0]
  const sign = Math.sign(across ? toward[0] - from[0] : toward[1] - from[1])
  const wall = across ? (sign > 0 ? room.x + room.w : room.x) : sign > 0 ? room.y + room.h : room.y
  return across ? [wall, from[1]] : [from[0], wall]
}

/** The length of a corridor's path from the wall of one room to the wall of the other (the path itself starts and ends inside the rooms). */
const wayBetweenDoors = (rooms: readonly Rect[], l: DungeonFloor['links'][number]) => {
  const n = l.path.length
  const total = l.path.slice(1).reduce((a, p, i) => a + dm.hypot(p[0] - l.path[i]![0], p[1] - l.path[i]![1]), 0)
  const [ax, ay] = wallCrossing(rooms[l.a]!, l.path[0]!, l.path[1]!)
  const [bx, by] = wallCrossing(rooms[l.b]!, l.path[n - 1]!, l.path[n - 2]!)
  return Math.max(0, total - dm.hypot(ax - l.path[0]![0], ay - l.path[0]![1]) - dm.hypot(bx - l.path[n - 1]![0], by - l.path[n - 1]![1]))
}

const floors = new WeakMap<object, SpaceMap>()

/** Links join spaces: build a map from spaces and the pairs that meet at a point. */
const mapOf = (spaces: readonly Space[], doors: readonly Door[]): SpaceMap => {
  const neighbors: number[][] = spaces.map(() => [])
  for (const d of doors) {
    if (!neighbors[d.a]!.includes(d.b)) neighbors[d.a]!.push(d.b)
    if (!neighbors[d.b]!.includes(d.a)) neighbors[d.b]!.push(d.a)
  }
  return { spaces, doors, neighbors }
}

/**
 * The spaces of a dungeon floor (`dungeon.ts`): its rooms (index = the room's) then its corridors (index = `rooms.length` + the link's),
 * with a door where each corridor leaves each of its two rooms. Built once per floor.
 */
export const spacesOf = (plan: Pick<DungeonFloor, 'rooms' | 'links'>): SpaceMap => {
  const known = floors.get(plan)
  if (known) return known
  const rect = (r: Rect): Shape => ({ kind: 'rect', x: r.x, y: r.y, w: r.w, h: r.h })
  const spaces: Space[] = [
    ...plan.rooms.map((r) => makeSpace('room', [rect(r)])),
    ...plan.links.map((l) => ({ ...makeSpace('corridor', corridorFloor(plan.rooms, l.rects).map(rect)), walk: wayBetweenDoors(plan.rooms, l) })),
  ]
  const doors: Door[] = plan.links.flatMap((l, i) => {
    const n = l.path.length
    const corridor = plan.rooms.length + i
    const [ax, ay] = wallCrossing(plan.rooms[l.a]!, l.path[0]!, l.path[1]!)
    const [bx, by] = wallCrossing(plan.rooms[l.b]!, l.path[n - 1]!, l.path[n - 2]!)
    return [
      { a: l.a, b: corridor, x: ax, y: ay },
      { a: corridor, b: l.b, x: bx, y: by },
    ]
  })
  const map = mapOf(spaces, doors)
  floors.set(plan, map)
  return map
}

/** A map of one space: the treasure chamber (a circle, `x`, `y` its middle in floor px) or any single shape. */
export const singleSpace = (kind: SpaceKind, region: Region): SpaceMap => mapOf([makeSpace(kind, region)], [])

const chambers = new WeakMap<object, SpaceMap>()

/** The treasure chamber's space, built once per chamber (keyed by its layout object). */
export const chamberOf = (key: object, circle: { x: number; y: number; r: number }): SpaceMap => {
  let map = chambers.get(key)
  if (!map) chambers.set(key, (map = singleSpace('chamber', [{ kind: 'circle', x: circle.x, y: circle.y, r: circle.r }])))
  return map
}

/** Builds a `SpaceMap` from spaces and doors written by hand (a new dungeon shape, a test). */
export const spaceMapOf = mapOf

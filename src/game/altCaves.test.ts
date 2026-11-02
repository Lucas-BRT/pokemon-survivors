import { describe, expect, it } from 'vitest'
import { PLACE_FEET } from '../data/places'
import type { Ellipse } from '../data/terrain'
import { createGame } from './game'
import { ALT_CAVES, ALT_CAVE_IDS } from './altCaves'
import { relayCave, stagePlan } from './cave'
import { buildNavGraph, pathField } from './dungeonGraph'
import { floorShapes, roomAt, type DungeonFloor, type Rect } from './dungeon'
import { fits } from './arenaFloor'
import { enterPlace } from './placeInterior'
import { hostOf, spacesOf } from './spaces'

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

const feetOf = (plan: DungeonFloor): Ellipse[] => [
  ...plan.rocks.map(([x, y]) => ({ ...PLACE_FEET.caveRock[0]!, x: x + PLACE_FEET.caveRock[0]!.x, y: y + PLACE_FEET.caveRock[0]!.y })),
  ...plan.sources.map(([x, y]) => ({ ...PLACE_FEET.crystal[0]!, x: x + PLACE_FEET.crystal[0]!.x, y: y + PLACE_FEET.crystal[0]!.y })),
]

describe.each(ALT_CAVE_IDS)('the AltCave "%s"', (id) => {
  const plan = ALT_CAVES[id].build()

  it('has rooms that do not overlap, with corridors that join exactly their two rooms and never cross each other', () => {
    plan.rooms.forEach((a, i) => plan.rooms.forEach((b, j) => i < j && expect(overlap(a, b)).toBe(0)))
    plan.links.forEach((link, l) => {
      for (const r of link.rects) {
        plan.rooms.forEach((room, i) => {
          if (i !== link.a && i !== link.b) expect(overlap(r, room), `corridor ${l} crosses room ${i}`).toBe(0)
        })
      }
    })
    const pieces = plan.links.map((_, l) => spacesOf(plan).spaces[plan.rooms.length + l]!.region.filter((s) => s.kind === 'rect') as Array<Rect & { kind: 'rect' }>)
    pieces.forEach((a, i) => pieces.forEach((b, j) => i < j && a.forEach((p) => b.forEach((q) => expect(overlap(p, q), `corridors ${i} and ${j} overlap`).toBeLessThan(1)))))
  })

  it('puts the start, the stairs, the sources and the rocks on the floor, the start and the stairs in their rooms', () => {
    const map = spacesOf(plan)
    expect(roomAt(plan, ...plan.start)).toBe(plan.startRoom)
    expect(roomAt(plan, ...plan.stairs)).toBe(plan.stairsRoom)
    for (const [x, y] of [...plan.sources, ...plan.rocks]) expect(hostOf(map, x, y), `${x},${y} is in the rock`).toBeGreaterThanOrEqual(0)
    expect(plan.sizes).toHaveLength(plan.rooms.length)
  })

  it('keeps each shaped room\'s rectangle inside its shape, and its outline inside the room', () => {
    plan.rooms.forEach((r, i) => {
      if (!plan.shapes?.[i]) return
      for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as const) expect(roomAt(plan, x, y), `room ${i}'s corner`).toBe(i)
      // Each corner of a piece, pulled 2 px toward that piece's middle (on the edge itself the inside test is a coin flip), is still this room's.
      for (const { pts } of plan.shapes[i]!) {
        const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length
        const my = pts.reduce((a, p) => a + p[1], 0) / pts.length
        for (const [x, y] of pts) {
          const d = Math.hypot(mx - x, my - y)
          expect(roomAt(plan, x + ((mx - x) * 2) / d, y + ((my - y) * 2) / d), `room ${i}'s outline`).toBe(i)
        }
      }
    })
  })

  it('lets a body walk the whole of every shaped room (the walls fit it inside one piece at a time)', () => {
    const pieces = floorShapes(plan)
    const R = 22 // as wide as a corridor lets a body be
    const STEP = 6
    plan.rooms.forEach((rect, i) => {
      if (!plan.shapes?.[i]) return
      const all = plan.shapes[i]!.flatMap((q) => q.pts)
      const x0 = Math.min(...all.map((p) => p[0]))
      const y0 = Math.min(...all.map((p) => p[1]))
      const cols = Math.ceil((Math.max(...all.map((p) => p[0])) - x0) / STEP) + 1
      const rows = Math.ceil((Math.max(...all.map((p) => p[1])) - y0) / STEP) + 1
      const ok = (c: number, r: number) => roomAt(plan, x0 + c * STEP, y0 + r * STEP) === i && pieces.some((s) => fits(s, x0 + c * STEP, y0 + r * STEP, R))
      const start = [Math.round((rect.x + rect.w / 2 - x0) / STEP), Math.round((rect.y + rect.h / 2 - y0) / STEP)] as const
      const seen = new Set<number>([start[1] * cols + start[0]])
      const todo = [start]
      for (let k = todo.pop(); k; k = todo.pop()) {
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = k[0] + dc
          const r = k[1] + dr
          if (c < 0 || r < 0 || c >= cols || r >= rows || seen.has(r * cols + c) || !ok(c, r)) continue
          seen.add(r * cols + c)
          todo.push([c, r])
        }
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (ok(c, r)) expect(seen.has(r * cols + c), `room ${i}: ${x0 + c * STEP},${y0 + r * STEP} is cut off`).toBe(true)
    })
  })

  it('is walkable: the nav graph reaches every room from the start', () => {
    const graph = buildNavGraph(plan, feetOf(plan))
    const field = pathField(graph, plan, plan.start[0], plan.start[1])!
    expect(field).not.toBeNull()
    graph.byRoom.forEach((ids, room) => expect(ids.some((n) => Number.isFinite(field.D[n]!)), `room ${room} is cut off`).toBe(true))
  })

  it('can be built into a running cave at any depth, keeping its sources', () => {
    const g = createGame('charmander', { w: 480, h: 270 }, 5)
    enterPlace(g, 'cave', 0, 0)
    const inside = g.place.inside
    if (inside?.id !== 'cave') throw new Error('not in the cave')
    inside.state.floor = 2
    stagePlan(plan)
    relayCave(g, inside)
    expect(inside.state.plan).toBe(plan)
    expect(inside.state.floor).toBe(2)
    expect(inside.state.sources).toHaveLength(plan.sources.length)
    expect(inside.state.sources.every((k) => !k.on)).toBe(true)
  })
})

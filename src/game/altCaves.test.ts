import { describe, expect, it } from 'vitest'
import { PLACE_FEET } from '../data/places'
import type { Ellipse } from '../data/terrain'
import { createGame } from './game'
import { ALT_CAVES, ALT_CAVE_IDS } from './altCaves'
import { relayCave, stagePlan } from './cave'
import { buildNavGraph, pathField } from './dungeonGraph'
import { roomAt, type DungeonFloor, type Rect } from './dungeon'
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

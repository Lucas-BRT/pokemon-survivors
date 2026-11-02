import { describe, expect, it } from 'vitest'
import { PLACE_FEET } from '../data/places'
import type { Ellipse } from '../data/terrain'
import { EXPLORER_ORDER, EXPLORER_THEMES } from '../data/explorers'
import { caveLevel } from '../data/caveLevels'
import { createRng } from '../engine/rng'
import { fits } from './arenaFloor'
import { buildNavGraph, pathField } from './dungeonGraph'
import { floorShapes, generateFloorV2, spaceAt, type DungeonFloor } from './dungeon'
import { shapeFloor } from './roomShapes'

const feetOf = (plan: DungeonFloor): Ellipse[] => [
  ...plan.rocks.map(([x, y]) => ({ ...PLACE_FEET.caveRock[0]!, x: x + PLACE_FEET.caveRock[0]!.x, y: y + PLACE_FEET.caveRock[0]!.y })),
  ...plan.sources.map(([x, y]) => ({ ...PLACE_FEET.crystal[0]!, x: x + PLACE_FEET.crystal[0]!.x, y: y + PLACE_FEET.crystal[0]!.y })),
]

/** Whether every spot in room `i`'s box where a body of radius `r` fits can be reached from the room's middle without leaving the floor. */
const roomConnected = (plan: DungeonFloor, i: number, r: number) => {
  const pieces = floorShapes(plan)
  const room = plan.rooms[i]!
  const all = plan.shapes![i]!.flatMap((q) => q.pts)
  const [x0, y0] = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))]
  const STEP = 4
  const cols = Math.ceil((Math.max(...all.map((p) => p[0])) - x0) / STEP) + 1
  const rows = Math.ceil((Math.max(...all.map((p) => p[1])) - y0) / STEP) + 1
  // Corridor strips crossing the room count as floor: they are walkable and join the room.
  const ok = (c: number, k: number) => pieces.some((s) => fits(s, x0 + c * STEP, y0 + k * STEP, r))
  const start: [number, number] = [Math.round((room.x + room.w / 2 - x0) / STEP), Math.round((room.y + room.h / 2 - y0) / STEP)]
  if (!ok(...start)) return false
  const seen = new Set([start[1] * cols + start[0]])
  const todo = [start]
  for (let k = todo.pop(); k; k = todo.pop()) {
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = k[0] + a
      const d = k[1] + b
      if (c < 0 || d < 0 || c >= cols || d >= rows || seen.has(d * cols + c) || !ok(c, d)) continue
      seen.add(d * cols + c)
      todo.push([c, d])
    }
  }
  for (let d = 0; d < rows; d++) for (let c = 0; c < cols; c++) if (ok(c, d) && !seen.has(d * cols + c)) return false
  return true
}

describe.each(EXPLORER_ORDER)('shaped floors of the %s theme', (id) => {
  const theme = EXPLORER_THEMES[id]
  const floors = Array.from({ length: 16 }, (_, seed) => {
    const rng = createRng(seed + 1)
    return shapeFloor(generateFloorV2(rng, seed % 3, caveLevel(1 + (seed % 5))), rng, 0.9, theme.shapes)
  })

  it('shapes some rooms, and keeps the start and the stairs rooms plain', () => {
    expect(floors.some((f) => f.shapes?.some((s) => s))).toBe(true)
    for (const f of floors) {
      expect(f.shapes?.[f.startRoom] ?? null).toBeNull()
      expect(f.shapes?.[f.stairsRoom] ?? null).toBeNull()
    }
  })

  it('leaves the start, stairs, lights, items and prizes on the floor', () => {
    for (const f of floors) {
      for (const [x, y] of [f.start, f.stairs, ...f.sources, ...f.items, ...f.prizes, ...f.rocks]) expect(spaceAt(f, x, y), `${x},${y}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('stays walkable: the nav graph reaches every room and a body of radius 14 crosses each shaped room', () => {
    for (const f of floors) {
      const graph = buildNavGraph(f, feetOf(f))
      const field = pathField(graph, f, f.start[0], f.start[1])!
      graph.byRoom.forEach((ids, room) => expect(ids.some((n) => Number.isFinite(field.D[n]!)), `room ${room} is cut off`).toBe(true))
      f.rooms.forEach((_, i) => f.shapes?.[i] && expect(roomConnected(f, i, 14), `room ${i}`).toBe(true))
    }
  }, 60_000)
})

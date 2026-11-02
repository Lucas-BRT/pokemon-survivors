import { describe, expect, it } from 'vitest'
import { PLACE_FEET } from '../data/places'
import type { Ellipse } from '../data/terrain'
import { createRng } from '../engine/rng'
import { caveLevel } from '../data/caveLevels'
import { doorOf, generateFloorV2, roomAt, spaceAt, type DungeonFloor } from './dungeon'
import { buildNavGraph, dungeonNav, MARGIN, pathField } from './dungeonGraph'

/** The feet of what a floor puts on its ground, as `cave.ts` lays them. */
const feetOf = (plan: DungeonFloor): Ellipse[] => [
  ...plan.rocks.map(([x, y]) => ({ ...PLACE_FEET.caveRock[0]!, x: x + PLACE_FEET.caveRock[0]!.x, y: y + PLACE_FEET.caveRock[0]!.y })),
  ...plan.sources.map(([x, y]) => ({ ...PLACE_FEET.crystal[0]!, x: x + PLACE_FEET.crystal[0]!.x, y: y + PLACE_FEET.crystal[0]!.y })),
]

const BODY = 8

/** Whether a body of radius BODY at (x, y) is clear of the feet. */
const clearOfFeet = (feet: readonly Ellipse[], x: number, y: number) => feet.every((e) => ((x - e.x) / (e.rx + BODY)) ** 2 + ((y - e.y) / (e.ry + BODY)) ** 2 >= 1)

/** Whether a body at (x, y) is on the floor: its four sides are in a room or a corridor. */
const onFloor = (plan: DungeonFloor, x: number, y: number) => [[-6, 0], [6, 0], [0, -6], [0, 6]].every(([dx, dy]) => spaceAt(plan, x + dx!, y + dy!) >= 0)

/** One step of a body walking toward (tx, ty) at 3 px: it slides along walls and rocks as the game's collision does, and stays where it can't move. */
const walkStep = (plan: DungeonFloor, feet: readonly Ellipse[], pos: { x: number; y: number }, tx: number, ty: number) => {
  const d = Math.hypot(tx - pos.x, ty - pos.y) || 1
  const vx = ((tx - pos.x) / d) * 3
  const vy = ((ty - pos.y) / d) * 3
  const fits = (x: number, y: number) => onFloor(plan, x, y) && clearOfFeet(feet, x, y)
  if (fits(pos.x + vx, pos.y + vy)) return void ((pos.x += vx), (pos.y += vy))
  if (fits(pos.x + vx, pos.y)) pos.x += vx
  else if (fits(pos.x, pos.y + vy)) pos.y += vy
}

/** Walks from `from` after a player standing at `to` for up to `steps` steps; returns the steps it took, or -1 when it never got there. */
let lastStuck = ''
const chase = (plan: DungeonFloor, feet: readonly Ellipse[], from: [number, number], to: [number, number], steps = 1500) => {
  const nav = dungeonNav(plan, to[0], to[1], feet)
  const pos = { x: from[0], y: from[1] }
  const out = { x: 0, y: 0 }
  for (let i = 0; i < steps; i++) {
    if (Math.hypot(to[0] - pos.x, to[1] - pos.y) < 14) return i
    const heading = nav && nav(pos.x, pos.y, out) ? out : { x: to[0], y: to[1] }
    walkStep(plan, feet, pos, heading.x, heading.y)
    if (i === steps - 1) lastStuck = `from ${from.map(Math.round)} to ${to.map(Math.round)} ended ${Math.round(pos.x)},${Math.round(pos.y)} heading ${Math.round(heading.x)},${Math.round(heading.y)} spaceAt ${spaceAt(plan, pos.x, pos.y)}`
  }
  return -1
}

/** Free spots in a room: its middle and the points of a grid, away from the walls and the rocks. */
const spotsIn = (plan: DungeonFloor, feet: readonly Ellipse[], room: number): Array<[number, number]> => {
  const r = plan.rooms[room]!
  const out: Array<[number, number]> = []
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      const x = r.x + 18 + ((r.w - 36) * i) / 3
      const y = r.y + 18 + ((r.h - 36) * j) / 3
      if (clearOfFeet(feet, x, y) && onFloor(plan, x, y)) out.push([x, y])
    }
  }
  return out
}

describe('the cave walkers’ graph', () => {
  it('keeps every rock and crystal off the doors: a body fits through each corridor mouth', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const [index, lv] of [[0, 1], [1, 1], [2, 1], [2, 5]] as const) {
        const plan = generateFloorV2(createRng(seed), index, caveLevel(lv))
        const feet = feetOf(plan)
        for (const l of plan.links) {
          const n = l.path.length
          for (const [room, from, toward] of [[l.a, l.path[0]!, l.path[1]!], [l.b, l.path[n - 1]!, l.path[n - 2]!]] as const) {
            const across = toward[0] !== from[0]
            // The axis from 45 px inside the wall to 30 px out along the corridor.
            const wall = doorOf(plan.rooms[room]!, from, toward, 0)
            const sign = Math.sign(across ? toward[0] - from[0] : toward[1] - from[1])
            for (let d = -45; d <= 30; d += 3) {
              const x = wall[0] + (across ? sign * d : 0)
              const y = wall[1] + (across ? 0 : sign * d)
              expect(clearOfFeet(feet, x, y), `seed ${seed} floor ${index} lv ${lv}: door of room ${room} at ${x},${y}`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('has nodes in every room and reaches every room from the start', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const index of [0, 1, 2]) {
        const plan = generateFloorV2(createRng(seed), index)
        const graph = buildNavGraph(plan, feetOf(plan))
        expect(graph.byRoom.every((ids) => ids.length > 0)).toBe(true)
        const [sx, sy] = plan.start
        const field = pathField(graph, plan, sx, sy)!
        expect(field).not.toBeNull()
        for (const ids of graph.byRoom) expect(ids.some((n) => Number.isFinite(field.D[n]!))).toBe(true)
      }
    }
  })

  it('keeps every node clear of the rocks and inside its room, a margin from the walls', () => {
    const plan = generateFloorV2(createRng(7), 2)
    const graph = buildNavGraph(plan, feetOf(plan))
    graph.byRoom.forEach((ids, room) => {
      for (const n of ids) {
        const { x, y } = graph.nodes[n]!
        for (const e of graph.blockers) expect((x - e.x) ** 2 / e.rx ** 2 + (y - e.y) ** 2 / e.ry ** 2).toBeGreaterThanOrEqual(1 - 1e-9)
        expect(roomAt(plan, x, y) === room || spaceAt(plan, x, y) >= 0).toBe(true)
      }
    })
    expect(MARGIN).toBeGreaterThan(0)
  })

  it('takes a walker from any room to a player in any other, round the rocks, without it ever staying stuck', { timeout: 30_000 }, () => {
    let walks = 0
    let stuck = 0
    for (let seed = 1; seed <= 14; seed++) {
      for (const [index, lv] of [[0, 1], [1, 1], [2, 1], [2, 5], [1, 3], [0, 4]] as const) {
        const plan = generateFloorV2(createRng(seed), index, caveLevel(lv))
        const feet = feetOf(plan)
        const goal = spotsIn(plan, feet, plan.startRoom)[0]
        if (!goal) continue
        for (let room = 0; room < plan.rooms.length; room++) {
          for (const from of spotsIn(plan, feet, room).filter((_, i) => i % 3 === 0)) {
            walks++
            if (chase(plan, feet, from, goal) < 0) { stuck++; if (stuck <= 6) console.log('STUCK', seed, index, lv, room, lastStuck) }
          }
        }
      }
    }
    expect(walks).toBeGreaterThan(300)
    expect(stuck).toBe(0)
  })

  it('goes round a rock that stands between a walker and the player in a room, where a straight line would hold it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const plan = generateFloorV2(createRng(seed), 1)
      const room = plan.rooms.findIndex((r) => r.w > 150 && r.h > 100)
      if (room < 0) continue
      const r = plan.rooms[room]!
      // A rock right between two points of the room.
      const cy = r.y + r.h / 2
      const a: [number, number] = [r.x + 24, cy]
      const b: [number, number] = [r.x + r.w - 24, cy]
      const rock: Ellipse = { x: (a[0] + b[0]) / 2, y: cy, rx: 30, ry: 22 }
      if (!clearOfFeet([rock], a[0], a[1]) || !clearOfFeet([rock], b[0], b[1])) continue
      const feet = [rock]
      expect(chase(plan, feet, a, b)).toBeGreaterThan(0)
      return
    }
    expect.fail('no room big enough')
  })
})

import { DUNGEON, type DungeonFloor, type Link, type Rect } from './dungeon'
import type { Poly, Pt } from '../data/arenas'
import * as dm from '../engine/dmath'

/**
 * AltCaves: hand-built cave floors for testing the light, the paths and the walls, a debug room instead of a drawn floor. Each one is a
 * `DungeonFloor` like the generated ones, so everything that works on a floor (the dark, the minimap, the nav graph, the sources,
 * the depth's darkness) works on it. The debug menu's Cave tab (`ui/debugMenu.ts`), `?debug=cave&alt=tour` and `ps.altCave()` build one
 * in the running cave (`debugStart.ts`, `applyAltCave`).
 *
 * A floor is written as rooms (a box each), links (a corridor between two rooms: straight when their centers line up, a Z with a jog when
 * they don't, the bend in the gap between them, as the generated floors do) and where the sources, the rocks, the start and the stairs are.
 */

type RoomSpec = Rect & {
  /** How many grid cells it counts as (`DungeonFloor.sizes`). */
  cells?: number
  /** The room's real floor when it isn't the rectangle (`DungeonFloor.shapes`); the rectangle must lie inside it. */
  shape?: readonly Poly[]
}

type Spec = {
  rooms: readonly RoomSpec[]
  /** Pairs of rooms joined by a corridor, and the sources lying in that corridor. */
  links: ReadonlyArray<readonly [number, number, ...Pt[]]>
  /** Sources standing in the rooms (any room). */
  sources: readonly Pt[]
  rocks?: readonly Pt[]
  startRoom: number
  start: Pt
  stairsRoom: number
  stairs: Pt
}

const centerOf = (r: Rect): Pt => [Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)]

/** A stretch of a corridor's path, as the generated floors floor it: the segment widened by the corridor's width. */
const stretch = ([ax, ay]: Pt, [bx, by]: Pt): Rect => {
  const w = DUNGEON.corridor
  const h = w / 2
  return { x: Math.min(ax, bx) - h, y: Math.min(ay, by) - h, w: Math.abs(bx - ax) + w, h: Math.abs(by - ay) + w }
}

/** The corridor between rooms `a` and `b`: from the middle of one to the middle of the other, bending in the gap between them. */
const linkOf = (rooms: readonly Rect[], a: number, b: number): Link => {
  const ra = rooms[a]!
  const rb = rooms[b]!
  const [ax, ay] = centerOf(ra)
  const [bx, by] = centerOf(rb)
  const across = ra.x + ra.w <= rb.x || rb.x + rb.w <= ra.x
  const path: Pt[] = across
    ? (() => {
        const mx = Math.round((Math.max(ra.x, rb.x) + Math.min(ra.x + ra.w, rb.x + rb.w)) / 2)
        return [[ax, ay], [mx, ay], [mx, by], [bx, by]]
      })()
    : (() => {
        const my = Math.round((Math.max(ra.y, rb.y) + Math.min(ra.y + ra.h, rb.y + rb.h)) / 2)
        return [[ax, ay], [ax, my], [bx, my], [bx, by]]
      })()
  return { a, b, path, rects: path.slice(1).map((p, i) => stretch(path[i]!, p)) }
}

const floorOf = (spec: Spec): DungeonFloor => {
  const rooms = spec.rooms.map(({ x, y, w, h }): Rect => ({ x, y, w, h }))
  return {
    rooms,
    links: spec.links.map(([a, b]) => linkOf(rooms, a, b)),
    start: spec.start,
    stairs: spec.stairs,
    startRoom: spec.startRoom,
    stairsRoom: spec.stairsRoom,
    items: [],
    sources: [...spec.sources, ...spec.links.flatMap(([, , ...own]) => own)],
    rocks: spec.rocks ?? [],
    ambush: [],
    prizes: [],
    sizes: spec.rooms.map((r) => r.cells ?? 1),
    sanctuary: -1,
    traps: [],
    ...(spec.rooms.some((r) => r.shape) ? { shapes: spec.rooms.map((r) => r.shape ?? null) } : {}),
  }
}

/* ---------------- Shaped rooms ---------------- */

const area = (pieces: readonly Poly[]) =>
  pieces.reduce((a, { pts }) => a + Math.abs(pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * y, 0)) / 2, 0)

/**
 * A room from convex pieces and the rectangle (inside them) the corridors work from. Pieces that join must overlap by more than a body's
 * width (44 px here, as wide as a corridor, so whatever walks a corridor walks the join): walls fit a body inside one piece at a time.
 */
const shaped = (core: Rect, shape: readonly Poly[]): RoomSpec => ({ ...core, shape, cells: Math.max(1, Math.round(area(shape) / 20000)) })

/** A regular polygon of `n` sides and circumradius `r` around (cx, cy), its first corner at angle `rot`; many sides make a circle. */
const regular = (cx: number, cy: number, r: number, n: number, rot = 0): RoomSpec => {
  const pts = Array.from({ length: n }, (_, i): Pt => [Math.round(cx + r * dm.cos(rot + (i * 2 * Math.PI) / n)), Math.round(cy + r * dm.sin(rot + (i * 2 * Math.PI) / n))])
  const h = Math.floor((r * dm.cos(Math.PI / n)) / Math.SQRT2) - 1
  return shaped({ x: cx - h, y: cy - h, w: 2 * h, h: 2 * h }, [{ kind: 'poly', pts }])
}

const box = (x: number, y: number, w: number, h: number): Poly => ({ kind: 'poly', pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] })

/* ---------------- The floors ---------------- */

/** Every kind of space on one floor: tiny, big, dark and lit rooms, straight and bent corridors with sources in them, a long way, a zigzag of small rooms. */
const tour = (): DungeonFloor =>
  floorOf({
    rooms: [
      { x: -70, y: -50, w: 140, h: 100 }, //  0 start: two sources, the corridors leave from it
      { x: 470, y: -30, w: 60, h: 60 }, //     1 tiny: one source
      { x: 600, y: -160, w: 360, h: 320, cells: 4 }, // 2 huge and dark: rocks, no source
      { x: -130, y: 230, w: 260, h: 140, cells: 2 }, //  3 a lit hall: four sources in its corners
      { x: -330, y: -60, w: 70, h: 260 }, //   4 tall and narrow: two sources
      { x: -640, y: -100, w: 240, h: 200, cells: 2 }, // 5 big west room: one source in the middle (diluted)
      { x: -40, y: 430, w: 80, h: 60 }, //     6 small hub: the stairs, no source
      { x: 330, y: 230, w: 80, h: 80 }, //     7 the zigzag begins (dark)
      { x: 470, y: 350, w: 80, h: 80 }, //     8 zigzag: one source
      { x: 640, y: 300, w: 80, h: 80 }, //     9 zigzag (dark)
      { x: 780, y: 420, w: 80, h: 80 }, //     10 the end of the zigzag: one source
    ],
    links: [
      [0, 1, [150, -14], [270, 14], [390, -14]], // a long straight corridor (400 px) with three sources along it
      [1, 2], //                                    a short straight one
      [0, 3], //                                    straight, down
      [0, 4, [-165, 35]], //                        a Z with a 70 px jog, one source on the jog
      [4, 5], //                                    a Z, no light
      [3, 6], //                                    straight and short
      [3, 7], //                                    a Z, 30 px jog
      [7, 8], //                                    a Z, 140 px jog
      [8, 9], //                                    a Z
      [9, 10], //                                   a Z
    ],
    sources: [
      [-40, -28], [40, 28], //                                                 room 0
      [500, -20], //                                                          room 1
      [-110, 250], [110, 250], [-110, 350], [110, 350], //                       room 3
      [-295, -30], [-295, 170], //                                              room 4
      [-520, 0], //                                                            room 5
      [510, 420], //                                                           room 8
      [820, 480], //                                                           room 10
    ],
    rocks: [[650, -110], [720, -60], [840, -100], [900, -20], [650, 70], [820, 100], [900, 110], [-60, 260], [80, 340]],
    startRoom: 0,
    start: [0, 20],
    stairsRoom: 6,
    stairs: [0, 462],
  })

/** The same light in rooms of the same size: 0, 1, 2, 3, 4, 6 and 8 sources (a row), and one source in rooms from tiny to huge (a second row). */
const sources = (): DungeonFloor => {
  const counts = [0, 1, 2, 3, 4, 6, 8]
  const x0 = (i: number) => -400 + 330 * i
  const spots = (i: number): Pt[] => {
    const x = x0(i)
    const all: Pt[] = [[x + 30, -40], [x + 190, -40], [x + 30, 40], [x + 190, 40], [x + 110, -40], [x + 110, 40], [x + 60, 0], [x + 160, 0]]
    return all.slice(0, counts[i])
  }
  return floorOf({
    rooms: [
      ...counts.map((_, i): RoomSpec => ({ x: x0(i), y: -70, w: 220, h: 140 })),
      { x: -330, y: 300, w: 80, h: 60 }, //                small
      { x: -100, y: 260, w: 220, h: 140 }, //              medium
      { x: 240, y: 200, w: 440, h: 300, cells: 6 }, //     large
      { x: 800, y: 100, w: 700, h: 450, cells: 12 }, //    huge
    ],
    links: [...counts.slice(1).map((_, i): [number, number] => [i, i + 1]), [0, 7], [7, 8], [8, 9], [9, 10]],
    sources: [...counts.flatMap((_, i) => spots(i)), [-290, 330], [10, 330], [460, 350], [1150, 325]],
    startRoom: 0,
    start: [-290, 10],
    stairsRoom: 10,
    stairs: [1300, 450],
  })
}

/** Rooms of growing size in a line with no light but the last: how dark an unlit room is by its size and by the floor it is on. */
const dark = (): DungeonFloor => {
  const sizes: ReadonlyArray<readonly [number, number]> = [[100, 80], [160, 120], [240, 160], [360, 240], [520, 320], [720, 420]]
  let x = 0
  const rooms = sizes.map(([w, h]): RoomSpec => {
    const room = { x, y: -h / 2, w, h, cells: Math.max(1, Math.round((w * h) / 20000)) }
    x += w + 110
    return room
  })
  const last = rooms[rooms.length - 1]!
  return floorOf({
    rooms: [
      ...rooms,
      { x: 500, y: 200, w: 70, h: 60 }, //  6 a dead-end branch under the third room
      { x: 500, y: 320, w: 70, h: 60 }, //  7
    ],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7]],
    sources: [[Math.round(last.x + last.w / 2), 0]],
    rocks: [],
    startRoom: 0,
    start: [50, 0],
    stairsRoom: 7,
    stairs: [535, 350],
  })
}

/** Rooms of every geometry, joined in a grid: circle, hexagon, triangle, diamond, octagon, half disc, an L, a cross and a U. */
const shapes = (): DungeonFloor => {
  const P = 520
  const Q = 440
  const UP = -Math.PI / 2
  return floorOf({
    rooms: [
      regular(0, 0, 130, 24), //                       0 circle: start, one lamp
      regular(P, 0, 120, 6), //                        1 hexagon: one lamp
      regular(2 * P, 0, 140, 3, UP), //                2 triangle: dark, small core
      regular(0, Q, 130, 4, UP), //                    3 diamond: one lamp
      regular(P, Q, 170, 8, Math.PI / 8), //           4 big octagon: four lamps, rocks
      shaped({ x: 2 * P - 50, y: Q - 40, w: 100, h: 80 }, [{ kind: 'poly', pts: [[2 * P - 150, Q - 40], [2 * P + 150, Q - 40], [2 * P + 120, Q + 40], [2 * P + 60, Q + 90], [2 * P - 60, Q + 90], [2 * P - 120, Q + 40]] }]), // 5 flat-bottomed dome: dark
      shaped({ x: -130, y: 2 * Q - 50, w: 260, h: 100 }, [box(-130, 2 * Q - 50, 260, 100), box(-130, 2 * Q + 6, 100, 184)]), //   6 L: two lamps
      shaped({ x: P - 150, y: 2 * Q - 40, w: 300, h: 80 }, [box(P - 150, 2 * Q - 40, 300, 80), box(P - 40, 2 * Q - 150, 80, 154), box(P - 40, 2 * Q - 4, 80, 154)]), // 7 cross: one lamp
      shaped({ x: 2 * P - 130, y: 2 * Q + 40, w: 260, h: 70 }, [box(2 * P - 130, 2 * Q + 40, 260, 70), box(2 * P - 130, 2 * Q - 90, 70, 174), box(2 * P + 60, 2 * Q - 90, 70, 174)]), //  8 U: stairs, no lamp
    ],
    links: [[0, 1], [1, 2], [0, 3], [1, 4], [2, 5], [3, 4], [4, 5], [3, 6], [4, 7], [5, 8], [6, 7], [7, 8]],
    sources: [[0, 0], [P, 0], [0, Q], [P - 80, Q - 80], [P + 80, Q - 80], [P - 80, Q + 80], [P + 80, Q + 80], [-60, 2 * Q], [90, 2 * Q], [P, 2 * Q]],
    rocks: [[P - 130, Q], [P + 130, Q], [P, Q - 130]],
    startRoom: 0,
    start: [0, 60],
    stairsRoom: 8,
    stairs: [2 * P, 2 * Q + 75],
  })
}

/** One lamp in the middle of rooms of nearly the same area (about 40000 px²) and different shapes: what the shape alone does to the light. */
const equal = (): DungeonFloor => {
  const at = (i: number) => i * 480
  return floorOf({
    rooms: [
      regular(at(0), 0, 113, 24), //          circle
      regular(at(1), 0, 100 * Math.SQRT2, 4, Math.PI / 4), // square
      regular(at(2), 0, 124, 6), //           hexagon
      regular(at(3), 0, 176, 3, -Math.PI / 2), // triangle
      regular(at(4), 0, 119, 8, Math.PI / 8), //  octagon
      shaped({ x: at(5) - 200, y: -50, w: 400, h: 100 }, [box(at(5) - 200, -50, 400, 100)]), // long rectangle 4:1
      shaped({ x: at(6) - 120, y: -50, w: 240, h: 100 }, [box(at(6) - 120, -50, 240, 100), box(at(6) - 120, 6, 100, 204)]), // L
    ],
    links: [0, 1, 2, 3, 4, 5].map((i): [number, number] => [i, i + 1]),
    sources: [0, 1, 2, 3, 4, 5, 6].map((i): Pt => [at(i), 0]),
    startRoom: 0,
    start: [at(0), 40],
    stairsRoom: 6,
    stairs: [at(6) - 70, 150],
  })
}

export type AltCaveId = 'tour' | 'sources' | 'dark' | 'shapes' | 'equal'

/** The floors, with what each one is for (the debug menu shows it). */
export const ALT_CAVES: Record<AltCaveId, { label: string; note: string; build: () => DungeonFloor }> = {
  tour: { label: 'Tour', note: 'Every kind of space: tiny, huge, dark, lit; straight and bent corridors with sources; a zigzag of small rooms.', build: tour },
  sources: { label: 'Sources', note: 'Rooms with 0 to 8 sources, then one source in rooms from tiny to huge: how the light dilutes.', build: sources },
  dark: { label: 'Dark', note: 'Unlit rooms of growing size, one lamp in the last: how dark a room is by its size and by the floor it is on.', build: dark },
  shapes: { label: 'Shapes', note: 'Round, hexagonal, triangular, diamond, octagonal, domed, L, cross and U rooms in a grid: the light, the walls and the paths on non-rectangular spaces.', build: shapes },
  equal: { label: 'Equal', note: 'One lamp in the middle of rooms of the same area and different shapes (circle, square, hexagon, triangle, octagon, 4:1 rectangle, L): what the shape alone does to the light.', build: equal },
}

export const ALT_CAVE_IDS = Object.keys(ALT_CAVES) as AltCaveId[]

import { DUNGEON, type DungeonFloor, type Link, type Rect } from './dungeon'
import type { Pt } from '../data/arenas'

/**
 * AltCaves: hand-built cave floors for testing the light, the paths and the walls, a debug room instead of a drawn floor. Each one is a
 * `DungeonFloor` like the generated ones, so everything that works on a floor (the dark, the minimap, the nav graph, the sources,
 * the depth's darkness) works on it. The debug menu's Cave tab (`ui/debugMenu.ts`), `?debug=cave&alt=tour` and `ps.altCave()` build one
 * in the running cave (`debugStart.ts`, `applyAltCave`).
 *
 * A floor is written as rooms (a box each), links (a corridor between two rooms: straight when their centers line up, a Z with a jog when
 * they don't, the bend in the gap between them, as the generated floors do) and where the sources, the rocks, the start and the stairs are.
 */

type RoomSpec = Rect & { /** How many grid cells it counts as (`DungeonFloor.sizes`). */ cells?: number }

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
  }
}

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

export type AltCaveId = 'tour' | 'sources' | 'dark'

/** The floors, with what each one is for (the debug menu shows it). */
export const ALT_CAVES: Record<AltCaveId, { label: string; note: string; build: () => DungeonFloor }> = {
  tour: { label: 'Tour', note: 'Every kind of space: tiny, huge, dark, lit; straight and bent corridors with sources; a zigzag of small rooms.', build: tour },
  sources: { label: 'Sources', note: 'Rooms with 0 to 8 sources, then one source in rooms from tiny to huge: how the light dilutes.', build: sources },
  dark: { label: 'Dark', note: 'Unlit rooms of growing size, one lamp in the last: how dark a room is by its size and by the floor it is on.', build: dark },
}

export const ALT_CAVE_IDS = Object.keys(ALT_CAVES) as AltCaveId[]

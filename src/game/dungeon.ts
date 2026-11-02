import { range, type Rng } from '../engine/rng'
import type { Poly, Pt } from '../data/arenas'
import * as dm from '../engine/dmath'
import { CAVE_GEN } from '../data/procgen'
import { CAVE_SHOP } from '../data/caveShop'
import { caveLevel, type CaveLevel } from '../data/caveLevels'

/**
 * Mystery Dungeon floors (the cave, `cave.ts`): rooms on a grid joined by
 * corridors, a start, stairs in the room farthest from it, items and scenery.
 * Pure: the same rng gives the same floor, and coordinates are px around the
 * floor's center. The walkers' way through it (a graph of waypoints and a
 * shortest path to the player, round rocks and out by the doors) is
 * `dungeonGraph.ts`; rocks and crystals keep clear of the doors for it.
 */

/** A room or a corridor stretch: its top-left corner and size. */
export type Rect = { x: number; y: number; w: number; h: number }

/** A corridor between rooms `a` and `b`: a Z-shaped path from center to center, and the stretches that floor it. */
export type Link = { a: number; b: number; path: readonly Pt[]; rects: readonly Rect[] }

export type DungeonFloor = {
  rooms: readonly Rect[]
  /**
   * Rooms that aren't rectangles (the AltCaves, `altCaves.ts`): room `i`'s floor as convex pieces that don't overlap, `null` for a
   * plain rectangle. Its `rooms[i]` is then a rectangle inside the shape (the corridors, the nav graph and the rocks work from it).
   */
  shapes?: readonly (readonly Poly[] | null)[]
  links: readonly Link[]
  start: Pt
  stairs: Pt
  startRoom: number
  stairsRoom: number
  items: readonly Pt[]
  /** Light sources (crystals: light and cover) and stalagmites (cover). */
  sources: readonly Pt[]
  rocks: readonly Pt[]
  /** Rooms that spring an ambush when first entered, and the prizes lying in them, more in the bigger ones (the generated floors, `generateFloorV2`). */
  ambush: readonly number[]
  prizes: readonly Pt[]
  /** How many grid cells each room takes: 1 for the regular size, 2 for a 2×1, 4 for a 2×2, 9 for a 3×3… */
  sizes: readonly number[]
  /** Where hidden traps lie (a telegraphed rockfall when stepped on): the deeper cave levels only, none otherwise. */
  traps: readonly Pt[]
  /** The Cristalário's room (`CAVE_SHOP`): light sources all round, a peaceful dweller in the middle, no ambush; -1 for none (the older floors). */
  sanctuary: number
}

/** Grid, room sizes and corridors per floor, in px. */
export const DUNGEON = {
  grids: [
    { cols: 3, rows: 2 },
    { cols: 3, rows: 3 },
  ],
  cell: { w: 190, h: 160 },
  room: { minW: 92, minH: 74 },
  /** Px kept between a room and its cell's edge, so corridors have somewhere to bend. */
  gap: 18,
  corridor: 44,
  /** Corridors added on top of the spanning tree, so later floors have loops. */
  loops: [0, 1],
  /** Items lying on each floor. */
  items: 2,
} as const

/**
 * How far a corridor's line keeps from the edge of the wall it leaves a room by: half the corridor plus a stretch of
 * wall, so the door never sits flush with the room's corner (the corridor's side would run on as the room's own wall,
 * and the outline would step into an L), nor poke past it.
 */
/**
 * Least distance between two rocks (and a rock and any other thing on the floor): wider than their grown feet touch (`MARGIN` in
 * `dungeonGraph.ts`) plus a body, so the gap between two rocks is either shut or one a walker fits through, never a needle.
 */
const ROCK_SPACING = 52

const DOOR_INSET = DUNGEON.corridor / 2 + 14

const center = (r: Rect): Pt => [dm.round(r.x + r.w / 2), dm.round(r.y + r.h / 2)]

const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

/** Whether (x, y) is inside the simple polygon (even-odd rule). */
const inPoly = ({ pts }: Poly, x: number, y: number) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!
    const [bx, by] = pts[i]!
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside
  }
  return inside
}

/** Whether (x, y) is on room `i`'s floor: its rectangle, or any piece of its shape. */
const inRoom = (floor: Pick<DungeonFloor, 'rooms' | 'shapes'>, i: number, x: number, y: number) => {
  if (inRect(floor.rooms[i]!, x, y)) return true
  const pieces = floor.shapes?.[i]
  return !!pieces && pieces.some((q) => inPoly(q, x, y))
}

/** A spot inside room `r`, `inset` px from its walls. */
const spotIn = (rng: Rng, r: Rect, inset: number): Pt => [dm.round(range(rng, r.x + inset, r.x + r.w - inset)), dm.round(range(rng, r.y + inset, r.y + r.h - inset))]

/** A spot in one of room `r`'s corners, clear of the corridors that come in at the middle of its walls. */
const cornerIn = (rng: Rng, r: Rect): Pt => {
  const x = rng() < 0.5 ? r.x + range(rng, 12, 26) : r.x + r.w - range(rng, 12, 26)
  const y = rng() < 0.5 ? r.y + range(rng, 12, 22) : r.y + r.h - range(rng, 8, 16)
  return [dm.round(x), dm.round(y)]
}

const far2 = ([ax, ay]: Pt, [bx, by]: Pt) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by)

/** The stretch of floor along a path segment, `w` wide and running `w / 2` past both ends so bends overlap. */
const stretch = ([ax, ay]: Pt, [bx, by]: Pt, w: number): Rect => {
  const h = w / 2
  return { x: Math.min(ax, bx) - h, y: Math.min(ay, by) - h, w: Math.abs(bx - ax) + w, h: Math.abs(by - ay) + w }
}

/** A Z-shaped corridor between neighboring rooms: out of each room straight, with the bend in the gap between them. */
const corridor = (rooms: readonly Rect[], a: number, b: number, across: boolean): Link => {
  const ra = rooms[a]!
  const rb = rooms[b]!
  const [ax, ay] = center(ra)
  const [bx, by] = center(rb)
  const path: Pt[] = across
    ? (() => {
        const mx = dm.round((ra.x + ra.w + rb.x) / 2)
        return [[ax, ay], [mx, ay], [mx, by], [bx, by]]
      })()
    : (() => {
        const my = dm.round((ra.y + ra.h + rb.y) / 2)
        return [[ax, ay], [ax, my], [bx, my], [bx, by]]
      })()
  return { a, b, path, rects: path.slice(1).map((p, i) => stretch(path[i]!, p, DUNGEON.corridor)) }
}

/**
 * A Z-shaped corridor between two rooms of the generated floors, `a` the left
 * (or upper) one, from a point inside each (`pa`, `pb`): straight out of the
 * room, the bend in the gap between them. For rooms of the regular size the
 * points are their middles, as in `corridor`.
 */
const corridorBetween = (rooms: readonly Rect[], a: number, b: number, pa: Pt, pb: Pt, across: boolean): Link => {
  const ra = rooms[a]!
  const rb = rooms[b]!
  const path: Pt[] = across
    ? (() => {
        const mx = dm.round((ra.x + ra.w + rb.x) / 2)
        return [pa, [mx, pa[1]], [mx, pb[1]], pb]
      })()
    : (() => {
        const my = dm.round((ra.y + ra.h + rb.y) / 2)
        return [pa, [pa[0], my], [pb[0], my], pb]
      })()
  return { a, b, path, rects: path.slice(1).map((p, i) => stretch(path[i]!, p, DUNGEON.corridor)) }
}

/** Where a corridor leaves `room`: the point of its axis `inset` px inside the wall it goes out by (`from` is its path's first point in the room, `toward` the next). */
export const doorOf = (room: Rect, from: Pt, toward: Pt, inset: number): Pt => {
  const across = toward[0] !== from[0]
  const sign = Math.sign(across ? toward[0] - from[0] : toward[1] - from[1])
  const wall = across ? (sign > 0 ? room.x + room.w : room.x) : sign > 0 ? room.y + room.h : room.y
  const inward = wall - sign * inset
  return across ? [inward, from[1]] : [from[0], inward]
}

/** Which wall of its room a corridor leaves by, as an index into left, right, top, bottom (`from` is its first point in the room, `toward` the next). */
const wallOf = (from: Pt, toward: Pt) => (toward[0] !== from[0] ? (toward[0] > from[0] ? 1 : 0) : toward[1] > from[1] ? 3 : 2)

/** Shortest number of corridors from every room to the nearest of `goals`. */
export const roomDistances = (floor: Pick<DungeonFloor, 'rooms' | 'links'>, goals: readonly number[], out: number[] = []) => {
  out.length = floor.rooms.length
  out.fill(Infinity)
  const queue = [...goals]
  for (const g of goals) out[g] = 0
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i]!
    for (const l of floor.links) {
      const n = l.a === r ? l.b : l.b === r ? l.a : -1
      if (n < 0 || out[n]! <= out[r]! + 1) continue
      out[n] = out[r]! + 1
      queue.push(n)
    }
  }
  return out
}

/** Lays out floor `index` (0 = B1F) of a dungeon. */
export const generateFloor = (rng: Rng, index: number): DungeonFloor => {
  const grid = DUNGEON.grids[Math.min(index, DUNGEON.grids.length - 1)]!
  const { w: CW, h: CH } = DUNGEON.cell
  const { gap } = DUNGEON
  const rooms: Rect[] = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const ox = (c - (grid.cols - 1) / 2) * CW - CW / 2
      const oy = (r - (grid.rows - 1) / 2) * CH - CH / 2
      const w = dm.round(range(rng, DUNGEON.room.minW, CW - gap * 2))
      const h = dm.round(range(rng, DUNGEON.room.minH, CH - gap * 2))
      rooms.push({ x: dm.round(ox + gap + rng() * (CW - gap * 2 - w)), y: dm.round(oy + gap + rng() * (CH - gap * 2 - h)), w, h })
    }
  }
  const at = (c: number, r: number) => r * grid.cols + c
  const neighbors = (i: number) => {
    const c = i % grid.cols
    const r = Math.floor(i / grid.cols)
    return [c > 0 ? at(c - 1, r) : -1, c < grid.cols - 1 ? at(c + 1, r) : -1, r > 0 ? at(c, r - 1) : -1, r < grid.rows - 1 ? at(c, r + 1) : -1].filter((n) => n >= 0)
  }
  // A random spanning tree (depth-first), then a few extra corridors for loops.
  const links: Link[] = []
  const linked = (a: number, b: number) => links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
  const join = (a: number, b: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    links.push(corridor(rooms, lo, hi, hi - lo === 1))
  }
  const seen = new Set<number>()
  const stack = [Math.floor(rng() * rooms.length)]
  seen.add(stack[0]!)
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!
    const open = neighbors(cur).filter((n) => !seen.has(n))
    if (open.length === 0) {
      stack.pop()
      continue
    }
    const next = open[Math.floor(rng() * open.length)]!
    join(cur, next)
    seen.add(next)
    stack.push(next)
  }
  const extra = rooms.flatMap((_, i) => neighbors(i).filter((n) => n > i && !linked(i, n)).map((n) => [i, n] as const))
  for (let k = 0; k < (DUNGEON.loops[index] ?? 1) && extra.length > 0; k++) {
    const [a, b] = extra.splice(Math.floor(rng() * extra.length), 1)[0]!
    join(a, b)
  }

  const startRoom = Math.floor(rng() * rooms.length)
  const dist = roomDistances({ rooms, links }, [startRoom])
  // The stairs wait in the room the most corridors away (the farthest one, on a tie).
  const start = center(rooms[startRoom]!)
  const far = (i: number) => dist[i]! * 1e7 + far2(center(rooms[i]!), start)
  const stairsRoom = rooms.reduce((best, _, i) => (far(i) > far(best) ? i : best), 0)
  const stairs = spotIn(rng, rooms[stairsRoom]!, 24)

  const taken: Pt[] = [start, stairs]
  const scatter = (count: number, pool: readonly number[], spacing: number, spot: (r: Rect) => Pt, allowed: (p: Pt) => boolean = () => true) => {
    const out: Pt[] = []
    for (let i = 0; i < count * 6 && out.length < count; i++) {
      const p = spot(rooms[pool[Math.floor(rng() * pool.length)]!]!)
      if (!allowed(p) || taken.some((t) => far2(t, p) < spacing * spacing)) continue
      out.push(p)
      taken.push(p)
    }
    return out
  }
  const all = rooms.map((_, i) => i)
  const others = all.filter((i) => i !== startRoom)
  const items = scatter(DUNGEON.items, others, 40, (r) => spotIn(rng, r, 18))
  const sources = scatter(Math.ceil(rooms.length / 2), all, 50, (r) => cornerIn(rng, r))
  const rocks = scatter(rooms.length, others, 36, (r) => spotIn(rng, r, 26))
  return { rooms, links, start, stairs, startRoom, stairsRoom, items, sources, rocks, ambush: [], prizes: [], sizes: rooms.map(() => 1), sanctuary: -1, traps: [] }
}

/**
 * A bigger, less regular floor (`CAVE_GEN`): rooms of different sizes on a
 * grid (a regular cell, or 2×1, 2×2, 3×3… of them) with a share of the small
 * ones left out (never splitting the rest), a spanning tree plus a share of
 * the other corridors as loops, and the stairs in the farthest small room at
 * the end of a single corridor: no loop ever reaches it, so there is one way
 * in. Some of the big rooms are set aside as ambushes with prizes. Pure: the
 * same rng gives the same floor. Same shape as `generateFloor`, so the
 * walkers' graph (`dungeonGraph.ts`) and the art work as they are.
 */
export const generateFloorV2 = (rng: Rng, index: number, lv: CaveLevel = caveLevel(1)): DungeonFloor => {
  const k = Math.min(index, CAVE_GEN.grids.length - 1)
  // A deeper level widens the grid, a column then a row in turn.
  const base = CAVE_GEN.grids[k]!
  const grid = { cols: base.cols + Math.ceil(lv.grid / 2), rows: base.rows + Math.floor(lv.grid / 2) }
  const { w: CW, h: CH } = CAVE_GEN.cell
  const { gap } = CAVE_GEN
  const total = grid.cols * grid.rows

  // Blocks of cells: the big rooms first, then a regular cell for every cell left.
  type Block = { c: number; r: number; w: number; h: number }
  const blocks: Block[] = []
  const owner = Array<number>(total).fill(-1)
  const cellsOf = (b: Block) => Array.from({ length: b.w * b.h }, (_, i) => (b.r + Math.floor(i / b.w)) * grid.cols + b.c + (i % b.w))
  const fits = (b: Block) => b.c >= 0 && b.r >= 0 && b.c + b.w <= grid.cols && b.r + b.h <= grid.rows && cellsOf(b).every((cell) => owner[cell]! < 0)
  const claim = (b: Block) => {
    blocks.push(b)
    for (const cell of cellsOf(b)) owner[cell] = blocks.length - 1
  }
  const shapes = CAVE_GEN.shapes[k]!
  const wanted = CAVE_GEN.big[k]! + lv.big
  for (let tries = 0, made = 0, used = 0; tries < wanted * 12 && made < wanted; tries++) {
    const [w, h] = shapes[Math.floor(rng() * shapes.length)]!
    const b = { c: Math.floor(rng() * grid.cols), r: Math.floor(rng() * grid.rows), w, h }
    if (!fits(b) || used + w * h > total * CAVE_GEN.bigShare) continue
    claim(b)
    made++
    used += w * h
  }
  for (let cell = 0; cell < total; cell++) if (owner[cell]! < 0) claim({ c: cell % grid.cols, r: Math.floor(cell / grid.cols), w: 1, h: 1 })

  // Blocks touching each other across an edge of their cells.
  const touching = (i: number) => {
    const out = new Set<number>()
    for (const cell of cellsOf(blocks[i]!)) {
      const c = cell % grid.cols
      const r = Math.floor(cell / grid.cols)
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        if (c + dc < 0 || r + dr < 0 || c + dc >= grid.cols || r + dr >= grid.rows) continue
        const o = owner[(r + dr) * grid.cols + c + dc]!
        if (o >= 0 && o !== i) out.add(o)
      }
    }
    return [...out]
  }
  // Leave some of the small blocks out, keeping the rest in one piece.
  const alive = Array<boolean>(blocks.length).fill(true)
  const whole = () => {
    const first = alive.indexOf(true)
    const seen = new Set<number>([first])
    const todo = [first]
    for (let i = 0; i < todo.length; i++) for (const n of touching(todo[i]!)) if (alive[n] && !seen.has(n)) (seen.add(n), todo.push(n))
    return seen.size === alive.filter(Boolean).length
  }
  const smalls = blocks.map((_, i) => i).filter((i) => blocks[i]!.w * blocks[i]!.h === 1)
  for (let i = smalls.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[smalls[i], smalls[j]] = [smalls[j]!, smalls[i]!]
  }
  let toDrop = Math.floor(total * CAVE_GEN.drop[k]!)
  for (const i of smalls) {
    if (toDrop <= 0) break
    alive[i] = false
    if (whole()) toDrop--
    else alive[i] = true
  }

  // Rooms: one per block left, in a rectangle somewhere inside its cells (a big room fills most of them).
  const rooms: Rect[] = []
  const sizes: number[] = []
  const blockOf: number[] = []
  const roomOfBlock = Array<number>(blocks.length).fill(-1)
  blocks.forEach((b, i) => {
    if (!alive[i]) return
    const ox = (b.c - (grid.cols - 1) / 2) * CW - CW / 2
    const oy = (b.r - (grid.rows - 1) / 2) * CH - CH / 2
    const maxW = b.w * CW - gap * 2
    const maxH = b.h * CH - gap * 2
    // A regular cell's room keeps its usual size range; a big room is at least 70% of its cells' extent, and wider than a regular room on its thin side too.
    const big = b.w * b.h > 1
    const w = dm.round(range(rng, b.w > 1 ? maxW * 0.7 : big ? DUNGEON.room.minW * 1.4 : DUNGEON.room.minW, maxW))
    const h = dm.round(range(rng, b.h > 1 ? maxH * 0.7 : big ? DUNGEON.room.minH * 1.4 : DUNGEON.room.minH, maxH))
    roomOfBlock[i] = rooms.length
    blockOf.push(i)
    sizes.push(b.w * b.h)
    // Anywhere in the cells, but across their middle lines: neighbors share a line a straight corridor can follow.
    const spot = (max: number, size: number) => {
      const lo = Math.max(0, max / 2 - size + 30)
      const hi = Math.min(max - size, max / 2 - 30)
      return lo <= hi ? lo + rng() * (hi - lo) : rng() * (max - size)
    }
    rooms.push({ x: dm.round(ox + gap + spot(maxW, w)), y: dm.round(oy + gap + spot(maxH, h)), w, h })
  })
  const nbrs = rooms.map((_, room) => touching(blockOf[room]!).filter((n) => alive[n]).map((n) => roomOfBlock[n]!))

  // A corridor between touching rooms through one pair of their touching cells, out of the room to the left (or above) first.
  const links: Link[] = []
  const linked = (a: number, b: number) => links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
  const join = (a: number, b: number) => {
    const pairs: [number, number][] = []
    for (const ca of cellsOf(blocks[blockOf[a]!]!)) {
      const c = ca % grid.cols
      const r = Math.floor(ca / grid.cols)
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        if (c + dc < 0 || r + dr < 0 || c + dc >= grid.cols || r + dr >= grid.rows) continue
        const cb = (r + dr) * grid.cols + c + dc
        if (owner[cb] === blockOf[b]) pairs.push([ca, cb])
      }
    }
    const [ca, cb] = pairs[Math.floor(rng() * pairs.length)]!
    const across = Math.floor(ca / grid.cols) === Math.floor(cb / grid.cols)
    const aFirst = across ? ca % grid.cols < cb % grid.cols : Math.floor(ca / grid.cols) < Math.floor(cb / grid.cols)
    const [first, second, cf, cs] = aFirst ? [a, b, ca, cb] : [b, a, cb, ca]
    let pa = portOf(first, cf, across)
    let pb = portOf(second, cs, across)
    // Rooms that overlap across the corridor's way are joined by a straight one, on the cell's line when both reach it.
    const [ra, rb] = [rooms[first]!, rooms[second]!]
    const [lo, hi] = across ? [Math.max(ra.y, rb.y) + DOOR_INSET, Math.min(ra.y + ra.h, rb.y + rb.h) - DOOR_INSET] : [Math.max(ra.x, rb.x) + DOOR_INSET, Math.min(ra.x + ra.w, rb.x + rb.w) - DOOR_INSET]
    if (lo <= hi) {
      const line = across ? pa[1] : pa[0]
      const at = dm.round(Math.max(lo, Math.min(hi, line)))
      pa = across ? [pa[0], at] : [at, pa[1]]
      pb = across ? [pb[0], at] : [at, pb[1]]
    }
    links.push(corridorBetween(rooms, first, second, pa, pb, across))
  }
  // Where a corridor leaves a room: its middle for a regular room, the line of the cell it leaves by for a bigger one.
  const portOf = (room: number, cell: number, across: boolean): Pt => {
    const r = rooms[room]!
    const [cx, cy] = center(r)
    if (sizes[room] === 1) return [cx, cy]
    const px = dm.round((cell % grid.cols - (grid.cols - 1) / 2) * CW)
    const py = dm.round((Math.floor(cell / grid.cols) - (grid.rows - 1) / 2) * CH)
    return across ? [cx, Math.max(r.y + DOOR_INSET, Math.min(r.y + r.h - DOOR_INSET, py))] : [Math.max(r.x + DOOR_INSET, Math.min(r.x + r.w - DOOR_INSET, px)), cy]
  }

  // A random spanning tree (depth-first) from a regular room.
  const regular = rooms.map((_, i) => i).filter((i) => sizes[i] === 1)
  const root = (regular.length > 0 ? regular : rooms.map((_, i) => i))[Math.floor(rng() * Math.max(1, regular.length || rooms.length))]!
  const seen = new Set<number>([root])
  const stack = [root]
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!
    const open = nbrs[cur]!.filter((n) => !seen.has(n))
    if (open.length === 0) {
      stack.pop()
      continue
    }
    const next = open[Math.floor(rng() * open.length)]!
    join(cur, next)
    seen.add(next)
    stack.push(next)
  }

  // The start in a regular room, the stairs at the far end of the tree: a leaf, kept out of every loop.
  const startRoom = (regular.length > 0 ? regular : rooms.map((_, i) => i))[Math.floor(rng() * Math.max(1, regular.length || rooms.length))]!
  const start = center(rooms[startRoom]!)
  const treeDist = roomDistances({ rooms, links }, [startRoom])
  const degree = (room: number) => links.filter((l) => l.a === room || l.b === room).length
  const far = (i: number) => treeDist[i]! * 1e7 + far2(center(rooms[i]!), start)
  const leaves = rooms.map((_, i) => i).filter((i) => i !== startRoom && degree(i) === 1)
  const smallLeaves = leaves.filter((i) => sizes[i] === 1)
  const stairsRoom = (smallLeaves.length > 0 ? smallLeaves : leaves).reduce((best, i) => (far(i) > far(best) ? i : best))
  const stairs = spotIn(rng, rooms[stairsRoom]!, 24)

  // Loops: other corridors between rooms that touch, never into the stairs room.
  const extra = rooms.flatMap((_, i) => nbrs[i]!.filter((n) => n > i && !linked(i, n) && i !== stairsRoom && n !== stairsRoom).map((n) => [i, n] as const))
  const loops = Math.min(extra.length, dm.round(extra.length * CAVE_GEN.loops))
  for (let n = 0; n < loops; n++) {
    const [a, b] = extra.splice(Math.floor(rng() * extra.length), 1)[0]!
    join(a, b)
  }
  const dist = roomDistances({ rooms, links }, [startRoom])

  // Ambush rooms: big ones only (the biggest first), never the start nor the stairs.
  const bigs = rooms.map((_, i) => i).filter((i) => sizes[i]! > 1 && i !== startRoom && i !== stairsRoom)
  for (let i = bigs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[bigs[i], bigs[j]] = [bigs[j]!, bigs[i]!]
  }
  const ambush = bigs.sort((a, b) => sizes[b]! - sizes[a]!).slice(0, CAVE_GEN.ambush[k]! + lv.ambush)
  // A prize for whoever clears it, more in a bigger room.
  const prizes = ambush.flatMap((i) => Array.from({ length: 1 + (sizes[i]! >= 4 ? 1 : 0) + (sizes[i]! >= 6 ? 1 : 0) }, (): Pt => spotIn(rng, rooms[i]!, 26)))

  const taken: Pt[] = [start, stairs, ...prizes]
  const scatter = (count: number, pool: readonly number[], spacing: number, spot: (r: Rect) => Pt, allowed: (p: Pt) => boolean = () => true) => {
    const out: Pt[] = []
    for (let i = 0; i < count * 6 && out.length < count; i++) {
      const p = spot(rooms[pool[Math.floor(rng() * pool.length)]!]!)
      if (!allowed(p) || taken.some((t) => far2(t, p) < spacing * spacing)) continue
      out.push(p)
      taken.push(p)
    }
    return out
  }
  // The Cristalário: a regular room off the beaten path of ambushes, the start and the stairs.
  const quiet = rooms.map((_, i) => i).filter((i) => sizes[i] === 1 && i !== startRoom && i !== stairsRoom && !ambush.includes(i))
  const sanctuary = quiet.length > 0 && rng() < CAVE_SHOP.chance ? quiet[Math.floor(rng() * quiet.length)]! : -1
  const all = rooms.map((_, i) => i)
  const others = all.filter((i) => i !== startRoom && i !== sanctuary)
  const plain = others.filter((i) => !ambush.includes(i))
  const items = scatter(CAVE_GEN.items[k]! + lv.items, plain.length > 0 ? plain : others, 40, (r) => spotIn(rng, r, 18))
  // A crystal never stands on a corridor's axis near its door: a body would not fit by (the walkers' graph, `dungeonGraph.ts`, counts on it).
  const mouths = links.flatMap((l) => {
    const n = l.path.length
    return [{ room: l.a, from: l.path[0]!, toward: l.path[1]! }, { room: l.b, from: l.path[n - 1]!, toward: l.path[n - 2]! }].map(({ room, from, toward }) => {
      const across = toward[0] !== from[0]
      return { wall: doorOf(rooms[room]!, from, toward, 0), across, sign: Math.sign(across ? toward[0] - from[0] : toward[1] - from[1]) }
    })
  })
  /** Whether (x, y) is off every door's axis: more than 18 px to its side, or not within the stretch 55 px inside the wall to 35 px out. */
  const offDoors = ([x, y]: Pt) =>
    mouths.every((m) => {
      const along = (m.across ? x - m.wall[0] : y - m.wall[1]) * m.sign
      return Math.abs(m.across ? y - m.wall[1] : x - m.wall[0]) > 18 || along < -55 || along > 35
    })
  const sources = scatter(Math.max(3, Math.ceil((rooms.length / 4) * lv.sources)), all.filter((i) => i !== sanctuary), 50, (r) => cornerIn(rng, r), offDoors)
  if (sanctuary >= 0) {
    // Ringed by light sources, the middle left for the dweller: the four corners and the middle of the two sides.
    const r = rooms[sanctuary]!
    const [cx, cy] = center(r)
    const [l, rt, t, b] = [r.x + 14, r.x + r.w - 14, r.y + 14, r.y + r.h - 12]
    // The fifth stands at the middle of a wall no corridor leaves by: on a corridor's axis it would shut the door.
    const used = new Set(links.flatMap((k) => (k.a === sanctuary || k.b === sanctuary ? [wallOf(k.a === sanctuary ? k.path[0]! : k.path[k.path.length - 1]!, k.a === sanctuary ? k.path[1]! : k.path[k.path.length - 2]!)] : [])))
    const mids: readonly Pt[] = [[r.x + 12, cy], [r.x + r.w - 12, cy], [cx, r.y + 12], [cx, r.y + r.h - 8]]
    const mid = mids.find((_, side) => !used.has(side))
    sources.push([l, t], [rt, t], [l, b], [rt, b], ...(mid ? [mid] : []))
    taken.push([cx, cy])
  }
  // A light source on the wall side of the long straight corridors, to light the way between rooms (the middle stays clear for walking).
  let lit = 0
  for (const l of links) {
    const [ax, ay] = l.path[0]!
    const [bx, by] = l.path[l.path.length - 1]!
    const across = l.path[1]![0] !== ax
    if (across ? ay !== by : ax !== bx) continue
    // About one corridor in three, two at most.
    if (rng() < 0.67 || lit >= 2) continue
    lit++
    const [from, to] = across ? [rooms[l.a]!.x + rooms[l.a]!.w, rooms[l.b]!.x] : [rooms[l.a]!.y + rooms[l.a]!.h, rooms[l.b]!.y]
    const side = DUNGEON.corridor / 2 - 6
    const n = to - from >= 150 ? 2 : 1
    for (let i = 0; i < n; i++) {
      const along = dm.round(from + ((to - from) * (i + 1)) / (n + 1))
      const off = (rng() < 0.5 ? -side : side)
      sources.push(across ? [along, ay + off] : [ax + off, along])
    }
  }
  // Hidden traps in the regular rooms and the ones ambush packs spare, never the start's, the stairs' or the Cristalário's.
  const traps = scatter(lv.traps, plain.length > 0 ? plain : others, 56, (r) => spotIn(rng, r, 30))
  // Rocks keep clear of every corridor's door: one on its axis would shut the way for anything wider than a few px.
  for (const l of links) {
    const n = l.path.length
    taken.push(doorOf(rooms[l.a]!, l.path[0]!, l.path[1]!, 28), doorOf(rooms[l.b]!, l.path[n - 1]!, l.path[n - 2]!, 28))
  }
  const cover = rooms.length + sizes.reduce((a, s) => a + (s - 1), 0)
  const rocks = scatter(cover, others, ROCK_SPACING, (r) => spotIn(rng, r, 26))
  void dist
  return { rooms, links, start, stairs, startRoom, stairsRoom, items, sources, rocks, ambush, prizes, sizes, sanctuary, traps }
}

/**
 * Which space of the floor holds (x, y): a room's index, `rooms.length` plus a
 * corridor's index, or -1 in the rock between. Two walkers in the same space
 * can see each other (`CAVE.sight`). Loops only, so it can run for every walker every tick.
 */
export const spaceAt = (floor: Pick<DungeonFloor, 'rooms' | 'links' | 'shapes'>, x: number, y: number) => {
  for (let i = 0; i < floor.rooms.length; i++) if (inRoom(floor, i, x, y)) return i
  for (let l = 0; l < floor.links.length; l++) {
    const rects = floor.links[l]!.rects
    for (let i = 0; i < rects.length; i++) if (inRect(rects[i]!, x, y)) return floor.rooms.length + l
  }
  return -1
}

/** Whether a Pokémon at floor px (x, y) sleeps: it stands in a room the team (`visited`, room indices) hasn't entered. */
export const dormant = (floor: Pick<DungeonFloor, 'rooms' | 'shapes'>, visited: readonly number[], x: number, y: number) => {
  const room = roomAt(floor, x, y)
  return room >= 0 && !visited.includes(room)
}

/** Px a body's height sits above its feet: shots and sight are judged on the floor under them, so the wall's north face doesn't count as wall. */
const BODY = 8

/** Whether a shot at (x, y) is over the floor (a room or a corridor) rather than in the rock. */
export const onFloor = (floor: Pick<DungeonFloor, 'rooms' | 'links' | 'shapes'>, x: number, y: number) => spaceAt(floor, x, y + BODY) >= 0

/** Whether the straight line between two points stays on the floor: nothing of the rock in the way. Loops only. */
export const clearShot = (floor: Pick<DungeonFloor, 'rooms' | 'links' | 'shapes'>, ax: number, ay: number, bx: number, by: number) => {
  const d = dm.hypot(bx - ax, by - ay)
  const n = Math.ceil(d / 6)
  for (let i = 1; i < n; i++) if (!onFloor(floor, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false
  return true
}

/** Index of the room holding (x, y), or -1. */
export const roomAt = (floor: Pick<DungeonFloor, 'rooms' | 'shapes'>, x: number, y: number) => floor.rooms.findIndex((_, i) => inRoom(floor, i, x, y))

/**
 * A corridor's mouth, in px: a funnel reaching `into` the room and `out` along
 * the corridor, `flare` wider than the corridor on each side at the wall's
 * room end and `narrow` narrower at its corridor end, so a body a little off
 * the corridor's line slides along it into the corridor instead of catching
 * on the wall's corner. Where it crosses the wall it shaves the corners off
 * (8 px deep), which the cave's art shows (`render/places.ts`).
 */
export const MOUTH = { into: 16, out: 24, flare: 8, narrow: 4 } as const

/** The funnel where the corridor from `room`'s center toward `to` (straight out of it) leaves through its wall. */
const mouth = (room: Rect, [cx, cy]: Pt, [tx, ty]: Pt): Poly => {
  const across = tx !== cx
  const sign = Math.sign(across ? tx - cx : ty - cy)
  const wall = across ? (sign > 0 ? room.x + room.w : room.x) : sign > 0 ? room.y + room.h : room.y
  const half = DUNGEON.corridor / 2
  // (along, aside): px out from the wall, px off the corridor's line.
  const at = (along: number, aside: number): Pt => (across ? [wall + along * sign, cy + aside] : [cx + aside, wall + along * sign])
  const wide = half + MOUTH.flare
  const tight = half - MOUTH.narrow
  return { kind: 'poly', pts: [at(-MOUTH.into, -wide), at(MOUTH.out, -tight), at(MOUTH.out, tight), at(-MOUTH.into, wide)] }
}

const rectPoly = (r: Rect): Poly => ({ kind: 'poly', pts: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] })

/**
 * The floor's shapes for `game/arenaFloor.ts`: every room and corridor stretch
 * as a convex polygon, and a funnel at each end of every corridor (`MOUTH`).
 */
export const floorShapes = (floor: Pick<DungeonFloor, 'rooms' | 'links' | 'shapes'>): Poly[] => [
  ...floor.rooms.flatMap((r, i) => [rectPoly(r), ...(floor.shapes?.[i] ?? [])]),
  ...floor.links.flatMap((l) => l.rects).map(rectPoly),
  ...floor.links.flatMap((l) => {
    const n = l.path.length
    return [mouth(floor.rooms[l.a]!, l.path[0]!, l.path[1]!), mouth(floor.rooms[l.b]!, l.path[n - 1]!, l.path[n - 2]!)]
  }),
]

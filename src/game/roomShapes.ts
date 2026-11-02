import type { Rng } from '../engine/rng'
import type { Poly, Pt } from '../data/arenas'
import type { RoomShape } from '../data/explorers'
import { weightedPick } from '../engine/rng'
import * as dm from '../engine/dmath'
import { DUNGEON, roomAt, spaceAt, type DungeonFloor, type Link, type Rect } from './dungeon'

/**
 * Non-rectangular rooms for the floors Explorers lays out. A generated floor (`generateFloorV2`) is all rectangles; `shapeFloor` turns a
 * share of its rooms into rounds, hexagons, diamonds, Ls, crosses and Us *inside* the room's own box (so no room grows into another), by
 * the rules of `DungeonFloor.shapes`: the room's rectangle becomes the one that lies inside the shape (the corridors, the nav graph and the
 * rocks work from it) and the shape's convex pieces overlap by `JOIN` px where they meet, so a body of a corridor's width crosses.
 * What the generator put in the room (lights, rocks, items, prizes, traps, the stairs and the start) is moved into the new floor.
 */

/** Overlap of two pieces that meet: as wide as a corridor (`DUNGEON.corridor`), the widest body that walks one. */
const JOIN = 44

/** Smallest an arm of an L, a cross or a U may be, and the smallest a room's rectangle may be left (a body must fit and turn in it). */
const ARM = 56
const CORE = 48

type Built = { core: Rect; pieces: Poly[] }

const poly = (pts: readonly Pt[]): Poly => ({ kind: 'poly', pts })
const box = (x: number, y: number, w: number, h: number): Poly => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: dm.round(x), y: dm.round(y), w: dm.round(w), h: dm.round(h) })

/** A convex shape with the biggest rectangle inside it. */
const ellipse = (b: Rect, n: number, rot = 0): Built => {
  const [cx, cy, rx, ry] = [b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2]
  const pts = Array.from({ length: n }, (_, i): Pt => [dm.round(cx + rx * dm.cos(rot + (i * 2 * Math.PI) / n)), dm.round(cy + ry * dm.sin(rot + (i * 2 * Math.PI) / n))])
  const k = dm.cos(Math.PI / n) / Math.SQRT2
  return { core: rect(cx - rx * k + 2, cy - ry * k + 2, 2 * (rx * k - 2), 2 * (ry * k - 2)), pieces: [poly(pts)] }
}

const hex = (b: Rect): Built => {
  const [cx, cy, rx, ry] = [b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2]
  const pts: Pt[] = [[cx - rx, cy], [cx - rx / 2, cy - ry], [cx + rx / 2, cy - ry], [cx + rx, cy], [cx + rx / 2, cy + ry], [cx - rx / 2, cy + ry]].map(([x, y]): Pt => [dm.round(x!), dm.round(y!)])
  return { core: rect(cx - rx / 2 + 2, cy - ry + 2, rx - 4, 2 * ry - 4), pieces: [poly(pts)] }
}

const diamond = (b: Rect): Built => {
  const [cx, cy, rx, ry] = [b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2]
  const pts: Pt[] = [[cx - rx, cy], [cx, cy - ry], [cx + rx, cy], [cx, cy + ry]].map(([x, y]): Pt => [dm.round(x!), dm.round(y!)])
  return { core: rect(cx - rx / 2 + 2, cy - ry / 2 + 2, rx - 4, ry - 4), pieces: [poly(pts)] }
}

/** Mirrors a built shape across the box's middle, so one recipe gives its four turns. */
const mirror = (built: Built, b: Rect, flipX: boolean, flipY: boolean): Built => {
  const fx = (x: number) => (flipX ? 2 * b.x + b.w - x : x)
  const fy = (y: number) => (flipY ? 2 * b.y + b.h - y : y)
  const box2 = ({ x, y, w, h }: Rect): Rect => rect(Math.min(fx(x), fx(x + w)), Math.min(fy(y), fy(y + h)), w, h)
  return { core: box2(built.core), pieces: built.pieces.map((p) => poly(p.pts.map(([x, y]): Pt => [fx(x), fy(y)]))) }
}

/** An L: the top band across the room, an arm down its left side. */
const ell = (b: Rect): Built | null => {
  const bandH = dm.round(b.h * 0.5)
  const armW = dm.round(b.w * 0.45)
  if (b.w < 2 * ARM + 20 || bandH < CORE || armW < ARM || b.h - bandH + JOIN < ARM) return null
  return { core: rect(b.x + 2, b.y + 2, b.w - 4, bandH - 4), pieces: [box(b.x, b.y, b.w, bandH), box(b.x, b.y + bandH - JOIN, armW, b.h - bandH + JOIN)] }
}

/** A cross: a band across the middle and an arm up and one down. */
const cross = (b: Rect): Built | null => {
  const bandH = dm.round(b.h * 0.4)
  const armW = dm.round(b.w * 0.4)
  const y0 = b.y + (b.h - bandH) / 2
  const x0 = b.x + (b.w - armW) / 2
  if (bandH < CORE || armW < ARM || (b.h - bandH) / 2 + JOIN < ARM) return null
  return {
    core: rect(b.x + 2, y0 + 2, b.w - 4, bandH - 4),
    pieces: [box(b.x, y0, b.w, bandH), box(x0, b.y, armW, y0 - b.y + JOIN), box(x0, y0 + bandH - JOIN, armW, b.y + b.h - (y0 + bandH) + JOIN)],
  }
}

/** A U: a band along the bottom and a post up each end. */
const ushape = (b: Rect): Built | null => {
  const bandH = dm.round(b.h * 0.4)
  const postW = dm.round(b.w * 0.3)
  if (bandH < CORE || postW < ARM || b.h - bandH + JOIN < ARM || b.w - 2 * postW < ARM) return null
  const y1 = b.y + b.h - bandH
  return { core: rect(b.x + 2, y1 + 2, b.w - 4, bandH - 4), pieces: [box(b.x, y1, b.w, bandH), box(b.x, b.y, postW, y1 - b.y + JOIN), box(b.x + b.w - postW, b.y, postW, y1 - b.y + JOIN)] }
}

/** The shape `kind` fitted into box `b` (turned at random), or null when the box is too small for it. */
const build = (kind: RoomShape, b: Rect, rng: Rng): Built | null => {
  const inner = rect(b.x + 6, b.y + 6, b.w - 12, b.h - 12)
  const made = kind === 'round' ? ellipse(inner, 16) : kind === 'hex' ? hex(inner) : kind === 'diamond' ? diamond(inner) : kind === 'ell' ? ell(inner) : kind === 'cross' ? cross(inner) : ushape(inner)
  if (!made || made.core.w < CORE || made.core.h < CORE) return null
  return kind === 'ell' || kind === 'ushape' ? mirror(made, inner, rng() < 0.5, rng() < 0.5) : made
}

/** Moves (x, y) into `core`, `margin` px from its edges. */
const into = ([x, y]: Pt, core: Rect, margin: number): Pt => [
  dm.round(Math.max(core.x + margin, Math.min(core.x + core.w - margin, x))),
  dm.round(Math.max(core.y + margin, Math.min(core.y + core.h - margin, y))),
]

/** A corridor's end inside a reshaped room: moved so the corridor leaves through the room's rectangle (its old end may lie in the shape's notch). */
const reroot = (end: Pt, bend: Pt, core: Rect): [Pt, Pt] => {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const half = DUNGEON.corridor / 2
  if (bend[0] !== end[0]) {
    const y = clamp(end[1], core.y + half, core.y + core.h - half)
    return [[clamp(end[0], core.x + 10, core.x + core.w - 10), y], [bend[0], y]]
  }
  const x = clamp(end[0], core.x + half, core.x + core.w - half)
  return [[x, clamp(end[1], core.y + 10, core.y + core.h - 10)], [x, bend[1]]]
}

/** The link with its ends moved into the new rectangles of the rooms that were reshaped (`shaped`), and its stretches laid again. */
const relink = (l: Link, rooms: readonly Rect[], shaped: readonly boolean[]): Link => {
  if (!shaped[l.a] && !shaped[l.b]) return l
  const path = l.path.map((p): Pt => [...p])
  const n = path.length
  if (shaped[l.a]) [path[0], path[1]] = reroot(path[0]!, path[1]!, rooms[l.a]!)
  if (shaped[l.b]) [path[n - 1], path[n - 2]] = reroot(path[n - 1]!, path[n - 2]!, rooms[l.b]!)
  const w = DUNGEON.corridor
  const rects = path.slice(1).map(([bx, by], i): Rect => {
    const [ax, ay] = path[i]!
    return { x: Math.min(ax, bx) - w / 2, y: Math.min(ay, by) - w / 2, w: Math.abs(bx - ax) + w, h: Math.abs(by - ay) + w }
  })
  return { ...l, path, rects }
}

/**
 * Turns a share of `plan`'s rooms into the shapes `kinds` (weights) allow, each inside its own box. The start room and the stairs' room
 * keep their rectangles (the way in and the way down stay plain). Pure given the rng.
 */
export const shapeFloor = (plan: DungeonFloor, rng: Rng, share: number, kinds: ReadonlyArray<readonly [RoomShape, number]>): DungeonFloor => {
  const rooms = plan.rooms.map((r): Rect => ({ ...r }))
  const shapes: (readonly Poly[] | null)[] = rooms.map(() => null)
  const original = plan.rooms
  rooms.forEach((_, i) => {
    if (i === plan.startRoom || i === plan.stairsRoom || i === plan.sanctuary || rng() >= share) return
    const kind = weightedPick(rng, kinds)
    const built = build(kind, original[i]!, rng)
    if (!built) return
    rooms[i] = built.core
    shapes[i] = built.pieces
  })
  const links = plan.links.map((l) => relink(l, rooms, shapes.map((x) => x !== null)))
  const shaped = { ...plan, rooms, shapes, links }
  // Whatever lay in a reshaped room's old box and now lies in the rock moves to the nearest spot of the room's rectangle.
  const owner = (p: Pt) => original.findIndex((r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h)
  const floorAt = (p: Pt) => spaceAt(shaped, p[0], p[1]) >= 0 && spaceAt(shaped, p[0], p[1] + 8) >= 0
  /** The nearest point of a corridor's centre line (always floor). */
  const onPath = (p: Pt): Pt => {
    let best: Pt = p
    let bestD = Infinity
    for (const l of links) {
      for (let k = 1; k < l.path.length; k++) {
        const [ax, ay] = l.path[k - 1]!
        const [bx, by] = l.path[k]!
        const q: Pt = [Math.max(Math.min(ax, bx), Math.min(Math.max(ax, bx), p[0])), Math.max(Math.min(ay, by), Math.min(Math.max(ay, by), p[1]))]
        const d = dm.sq(q[0] - p[0]) + dm.sq(q[1] - p[1])
        if (d < bestD) {
          bestD = d
          best = q
        }
      }
    }
    return best
  }
  const keep = (p: Pt, margin: number): Pt => {
    const i = owner(p)
    const q = i < 0 || !shapes[i] || (roomAt(shaped, p[0], p[1]) === i && roomAt(shaped, p[0], p[1] + 8) === i) ? p : into(p, rooms[i]!, margin)
    return floorAt(q) ? q : onPath(q)
  }
  return {
    ...shaped,
    start: keep(plan.start, 14),
    stairs: keep(plan.stairs, 14),
    items: plan.items.map((p) => keep(p, 14)),
    sources: plan.sources.map((p) => keep(p, 14)),
    rocks: plan.rocks.map((p) => keep(p, 18)),
    prizes: plan.prizes.map((p) => keep(p, 14)),
    traps: plan.traps.map((p) => keep(p, 14)),
  }
}

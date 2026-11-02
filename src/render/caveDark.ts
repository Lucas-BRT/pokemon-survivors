import { context2d, createCanvas } from '../engine/pixelart'
import { caveLight } from '../game/cave'
import { floorShapes, roomAt, spaceAt, type DungeonFloor } from '../game/dungeon'
import { LIGHT_KINDS } from '../data/lightSources'
import { onSources, seenLevels, spaceRects } from '../game/lightSources'
import { CAVE } from '../data/places'
import type { PlaceInteriorOf } from '../game/place'
import type { Game } from '../game/types'
import { lit, roomLevel, roomLevels } from './caveSight'

/**
 * The cave's dark as one scalar field, drawn in a single pass. Every light is a
 * contribution `c_k(p)` in 0..1 at the world point p, they combine as
 *
 *     L(p) = M(p) · (1 − Π (1 − c_k(p)))
 *
 * (a probabilistic OR: never above 1, never brighter than the strongest sources
 * together, the same whatever the order) and the dark's alpha is `black · (1 − L)`.
 * `M` is the floor's mask: 1 on the floor and the wall's face above it, falling
 * smoothly to 0 over `lit.rim` px of rock, from the exact outline of the floor
 * (rooms, corridors and the doors' funnels), so no light has a shape of its own
 * to end on a line. The sources are the rooms' levels (full inside the room,
 * fading over `lit.spill` px out of its doors), crystals, the stairs, the chest,
 * the players' own light and fire or electric attacks. The field is worked out at
 * half the screen's size and drawn smoothed up. Presentation only.
 */

type Ctx = CanvasRenderingContext2D

/** The wall's face reaches this many px above the floor's north edge. */
const FACE = 9
/** A point light: full to `PLATEAU` of its radius, then falling smoothly to nothing. */
const PLATEAU = 0.35

type Edge = { nx: number; ny: number; o: number }
type Poly = { edges: readonly Edge[]; x0: number; y0: number; x1: number; y1: number }

const polysOf = new WeakMap<DungeonFloor, readonly Poly[]>()

/** The floor's convex pieces as half-planes (outward normal and offset), in floor px, with their boxes. */
const polys = (plan: DungeonFloor): readonly Poly[] => {
  let known = polysOf.get(plan)
  if (known) return known
  known = floorShapes(plan).map((s) => {
    const pts = s.pts
    let area = 0
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1]
    const flip = area >= 0 ? 1 : -1
    const edges: Edge[] = []
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j]!
      const [bx, by] = pts[i]!
      const ex = bx - ax
      const ey = by - ay
      const len = Math.hypot(ex, ey) || 1
      const nx = (flip * ey) / len
      const ny = (-flip * ex) / len
      edges.push({ nx, ny, o: nx * ax + ny * ay })
    }
    return { edges, x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) }
  })
  polysOf.set(plan, known)
  return known
}

const smooth = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return k * k * (3 - 2 * k)
}

/** Distance from (x, y) to the box (0 inside it). */
const boxDist = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))

type Point = { x: number; y: number; r: number; i: number }

let map: { canvas: HTMLCanvasElement; ctx: Ctx; image: ImageData } | null = null

/** The field's canvas, `w` × `h` (half the screen's). */
const lightmap = (w: number, h: number) => {
  if (map && map.canvas.width === w && map.canvas.height === h) return map
  const canvas = createCanvas(w, h)
  const ctx = context2d(canvas)
  map = { canvas, ctx, image: ctx.createImageData(w, h) }
  return map
}

/** The spaces' levels as shown now (rooms, then corridors): easing toward their goals (a space not entered is 0). */
const shownRooms = new WeakMap<DungeonFloor, number[]>()
const shownChamber = new WeakMap<object, number>()
/** The corridors (space indices) the team has walked, per floor. */
const corridorsWalked = new WeakMap<DungeonFloor, Set<number>>()
let lastAt = 0

/**
 * Draws the cave's dark over the world and returns the lights' circles
 * (x, y, radius in world px), which the eyes of what stands outside them need.
 */
export const drawCaveDark = (ctx: Ctx, g: Game, inside: PlaceInteriorOf<'cave'>, camX: number, camY: number, t: number) => {
  const { w, h } = g.view
  const s = inside.state
  const plan = s.plan
  const dt = Math.max(0, Math.min(0.1, t - lastAt))
  lastAt = t
  const ease = Math.min(1, lit.fade * dt)

  // The players in the floor's own px: how far a space is from them says how strongly its light is seen (`seenLevels`).
  const team = g.players.filter((q) => !q.gone).map((q) => ({ x: q.x - inside.x, y: q.y - inside.y }))

  // Area lights: the rooms and the corridors (a rect each, a corridor's stretches sharing a level) or the chamber (a circle), at their eased levels.
  type Area = { x0: number; y0: number; x1: number; y1: number; level: number } | { cx: number; cy: number; r: number; level: number }
  const areas: Area[] = []
  let factor: readonly number[] = []
  let spaceVisited = (_: number) => true
  if (plan) {
    // A corridor counts as entered once a player has stood in it (kept here, for the screen only).
    let walked = corridorsWalked.get(plan)
    if (!walked) corridorsWalked.set(plan, (walked = new Set()))
    for (const q of team) {
      const space = spaceAt(plan, q.x, q.y)
      if (space >= plan.rooms.length) walked.add(space)
    }
    spaceVisited = (space) => (space < plan.rooms.length ? s.visited.includes(space) : walked.has(space))
    const goal = roomLevels(plan, s.sources)
    const seen = seenLevels(plan, goal, spaceVisited, team, lit)
    factor = seen.factor
    let shown = shownRooms.get(plan)
    if (!shown) shownRooms.set(plan, (shown = goal.map(() => 0)))
    goal.forEach((_, space) => {
      shown![space] = shown![space]! + (seen.level[space]! - shown![space]!) * ease
      if (shown![space]! <= 0.005) return
      for (const r of spaceRects(plan, space)) areas.push({ x0: inside.x + r.x, y0: inside.y + r.y, x1: inside.x + r.x + r.w, y1: inside.y + r.y + r.h, level: shown![space]! })
    })
  } else {
    const c = inside.layout.floor[0]
    if (c?.kind === 'circle') {
      const goal = roomLevel(lit.allOn ? s.sources.length : onSources(s.sources).length, Math.PI * c.r * c.r)
      const now = (shownChamber.get(inside.layout) ?? 0) + (goal - (shownChamber.get(inside.layout) ?? 0)) * ease
      shownChamber.set(inside.layout, now)
      areas.push({ cx: inside.x + c.x, cy: inside.y + c.y, r: c.r, level: now })
    }
  }

  // A glow shows once its room has been entered (a corridor's, once a player is near).
  const glows = (x: number, y: number) => {
    if (!plan) return true
    const room = roomAt(plan, x - inside.x, y - inside.y)
    if (room >= 0) return s.visited.includes(room)
    return g.players.some((q) => (q.x - x) ** 2 + (q.y - y) ** 2 < 150 * 150)
  }

  // Point lights.
  const points: Point[] = []
  const litBy: Array<readonly [number, number, number]> = []
  const reach = caveLight(g)
  const flicker = reach >= CAVE.fireLight ? Math.round(Math.sin(t * 9) + Math.sin(t * 23)) : 0
  for (const p of g.players) {
    if (p.gone) continue
    points.push({ x: p.x, y: p.y - 10, r: (reach + flicker) * lit.playerScale, i: 1 })
    litBy.push([p.x, p.y - 10, reach * 0.8])
  }
  // A light source gives light only while it is on (touched, as the Nightmare's lanterns are): off, nothing at all. On, it has its aura,
  // weaker the farther its space is from the players (`factor`), eased in and blinking out at the end.
  s.sources.forEach((k, i) => {
    if (!(lit.allOn || k.on)) return
    const space = plan ? spaceAt(plan, k.x, k.y) : -1
    if (plan && space >= 0 && !spaceVisited(space)) return
    const a = space >= 0 ? (factor[space] ?? 1) : 1
    const x = inside.x + k.x
    const y = inside.y + k.y - 6
    const kind = LIGHT_KINDS[k.kind]
    const age = k.on ? k.age : Infinity
    const blinking = k.on && k.left < kind.blink && Math.floor(t * 8) % 2 === 0
    points.push({ x, y, r: lit.aura + Math.sin(t * 2 + k.x + i) * lit.auraWaver, i: lit.auraGain * kind.strength * smooth(age / Math.max(0.01, lit.auraEase)) * (blinking ? lit.auraBlink : 1) * a })
    litBy.push([x, y, lit.auraFoot * a])
  })
  if (s.stairs && glows(inside.x + s.stairs[0], inside.y + s.stairs[1])) points.push({ x: inside.x + s.stairs[0], y: inside.y + s.stairs[1], r: 24 + Math.sin(t * 3) * 2, i: 1 })
  if (s.chest && glows(inside.x + s.chest.x, inside.y + s.chest.y)) points.push({ x: inside.x + s.chest.x, y: inside.y + s.chest.y - 6, r: 30, i: 1 })
  let n = 0
  for (const a of g.attacks) {
    if (n > 24 || a.age < 0 || (a.type !== 'fire' && a.type !== 'electric')) continue
    if (a.x < camX - 20 || a.y < camY - 20 || a.x > camX + w + 20 || a.y > camY + h + 20) continue
    points.push({ x: a.x, y: a.y - 6, r: 16, i: 1 })
    n++
  }

  // Only what can reach the screen.
  const rim = Math.max(0.001, lit.rim)
  const spill = Math.max(0.001, lit.spill)
  const view = { x0: camX - 80, y0: camY - 80, x1: camX + w + 80, y1: camY + h + 80 }
  const floor = plan ? polys(plan).filter((q) => q.x1 + inside.x + rim + FACE >= view.x0 && q.x0 + inside.x - rim <= view.x1 && q.y1 + inside.y + rim + FACE >= view.y0 && q.y0 + inside.y - rim <= view.y1) : []
  const chamber = !plan ? inside.layout.floor[0] : null
  const near = points.filter((q) => q.x + q.r >= view.x0 && q.x - q.r <= view.x1 && q.y + q.r >= view.y0 && q.y - q.r <= view.y1)

  // The field, at half the screen's size.
  const mw = Math.ceil(w / 2)
  const mh = Math.ceil(h / 2)
  const m = lightmap(mw, mh)
  const data = m.image.data
  const black = lit.black
  for (let my = 0; my < mh; my++) {
    const wy = camY + my * 2 + 1
    for (let mx = 0; mx < mw; mx++) {
      const wx = camX + mx * 2 + 1
      // The floor mask: the signed distance to the floor (and to the same shifted up by the wall's face), as the nearest piece's.
      let sd = Infinity
      if (plan) {
        const lx = wx - inside.x
        const ly = wy - inside.y
        for (const q of floor) {
          if (lx < q.x0 - rim - 1 || lx > q.x1 + rim + 1 || ly < q.y0 - rim - FACE - 1 || ly > q.y1 + rim + 1) continue
          let d1 = -Infinity
          let d2 = -Infinity
          for (const e of q.edges) {
            const base = e.nx * lx + e.ny * ly - e.o
            if (base > d1) d1 = base
            const shifted = base + e.ny * FACE
            if (shifted > d2) d2 = shifted
          }
          if (d1 < sd) sd = d1
          if (d2 < sd) sd = d2
        }
      } else if (chamber?.kind === 'circle') {
        // As the rooms': the wall's face above the north arc counts as floor (the same point shifted down by `FACE`).
        const cx = wx - inside.x - chamber.x
        const cy = wy - inside.y - chamber.y
        sd = Math.min(Math.hypot(cx, cy), Math.hypot(cx, cy + FACE)) - chamber.r
      }
      const mask = sd <= 0 ? 1 : 1 - smooth(sd / rim)
      let dark = 1
      if (mask > 0.002) {
        for (const a of areas) {
          const d = 'cx' in a ? Math.max(0, Math.hypot(wx - a.cx, wy - a.cy) - a.r) : boxDist(wx, wy, a.x0, a.y0, a.x1, a.y1)
          if (d >= spill) continue
          dark *= 1 - a.level * (1 - smooth(d / spill))
        }
        for (const q of near) {
          const d = Math.hypot(wx - q.x, wy - q.y) / q.r
          if (d >= 1) continue
          dark *= 1 - q.i * (1 - smooth((d - PLATEAU) / (1 - PLATEAU)))
        }
      }
      const i = (my * mw + mx) * 4
      data[i] = 6
      data[i + 1] = 4
      data[i + 2] = 10
      data[i + 3] = Math.round(255 * black * (1 - mask * (1 - dark)))
    }
  }
  m.ctx.putImageData(m.image, 0, 0)
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(m.canvas, 0, 0, mw * 2, mh * 2)
  ctx.imageSmoothingEnabled = smoothing
  return litBy
}

import { context2d, createCanvas } from '../engine/pixelart'
import { caveLight } from '../game/cave'
import { floorShapes, roomAt, type DungeonFloor } from '../game/dungeon'
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

/** The rooms' levels as shown now: easing toward their goals (a room not entered is 0). */
const shownRooms = new WeakMap<DungeonFloor, number[]>()
const shownChamber = new WeakMap<object, number>()
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

  // Area lights: the rooms (a rect each) or the chamber (a circle), at their eased levels.
  type Area = { x0: number; y0: number; x1: number; y1: number; level: number } | { cx: number; cy: number; r: number; level: number }
  const areas: Area[] = []
  if (plan) {
    const goal = roomLevels(plan, s.touched.map((c) => c.i))
    let shown = shownRooms.get(plan)
    if (!shown) shownRooms.set(plan, (shown = plan.rooms.map(() => 0)))
    plan.rooms.forEach((r, i) => {
      shown![i] = shown![i]! + ((s.visited.includes(i) ? goal[i]! : 0) - shown![i]!) * ease
      if (shown![i]! > 0.005) areas.push({ x0: inside.x + r.x, y0: inside.y + r.y, x1: inside.x + r.x + r.w, y1: inside.y + r.y + r.h, level: shown![i]! })
    })
  } else {
    const c = inside.layout.floor[0]
    if (c?.kind === 'circle') {
      const goal = roomLevel(lit.allOn ? s.lights.length : s.touched.length, Math.PI * c.r * c.r)
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
  s.lights.forEach(([lx, ly], i) => {
    const x = inside.x + lx
    const y = inside.y + ly - 6
    // A crystal shows its full light only while it shines (touched, as the Nightmare's lanterns are); otherwise a dull glint, found from afar and fading with the distance (no pop in and out).
    const shining = s.touched.find((c) => c.i === i)
    if (lit.allOn || shining) {
      // Eases in over its first moments and blinks in its last seconds before going out.
      const age = shining ? shining.age : Infinity
      const blinking = shining !== undefined && shining.left < CAVE.crystal.blink && Math.floor(t * 8) % 2 === 0
      points.push({ x, y, r: lit.aura + Math.sin(t * 2 + lx) * lit.auraWaver, i: lit.auraGain * smooth(age / Math.max(0.01, lit.auraEase)) * (blinking ? lit.auraBlink : 1) })
      litBy.push([x, y, lit.auraFoot])
      return
    }
    if (!lit.glint) return
    let nearest = Infinity
    for (const q of g.players) if (!q.gone) nearest = Math.min(nearest, Math.hypot(q.x - x, q.y - y))
    const glint = lit.glintGain * (1 - smooth((nearest - lit.glintNear) / Math.max(1, lit.glintFade)))
    if (glint > 0.02) points.push({ x, y, r: lit.glintR, i: glint })
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

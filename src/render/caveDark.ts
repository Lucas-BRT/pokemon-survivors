import { context2d, createCanvas } from '../engine/pixelart'
import { lightOf, lightRange } from '../game/cave'
import { ENEMY_LIGHT, profileOf } from '../data/pokemonLight'
import { ENEMIES } from '../data/enemies'
import { floorShapes, roomAt, type DungeonFloor } from '../game/dungeon'
import { LIGHT_KINDS } from '../data/lightSources'
import { caveLevel } from '../data/caveLevels'
import { atDepth, seenLevels } from '../game/lightSources'
import { chamberOf, hostOf, regionSdf, spacesOf, type Bounds, type Region, type SpaceMap } from '../game/spaces'
import type { PlaceInteriorOf } from '../game/place'
import type { Game } from '../game/types'
import { lit, roomLevels } from './caveSight'

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
const shownSpaces = new WeakMap<SpaceMap, number[]>()
/** The corridors (space indices) the team has walked, per floor. */
const corridorsWalked = new WeakMap<DungeonFloor, Set<number>>()
let lastAt = 0

/** The levels of the spaces as shown now on a floor's map (rooms, then corridors; absent before the first frame): the minimap reads them too. */
export const shownLevels = (map: SpaceMap): readonly number[] | undefined => shownSpaces.get(map)

/**
 * Draws the cave's dark over the world and returns the lights' circles
 * (x, y, radius in world px), which the eyes of what stands outside them need.
 */
export type DarkOptions = {
  /** The darkest the dark gets, 0 to 1 (`lit.black` by default). */
  black?: number
  /** Spaces (a floor's rooms, then its corridors) that are fully lit whatever their sources say: the forest's clearings. */
  litRooms?: ReadonlySet<number>
}

export const drawCaveDark = (ctx: Ctx, g: Game, inside: PlaceInteriorOf<'cave'>, camX: number, camY: number, t: number, opts: DarkOptions = {}) => {
  const { w, h } = g.view
  const s = inside.state
  const plan = s.plan
  const dt = Math.max(0, Math.min(0.1, t - lastAt))
  lastAt = t
  const ease = Math.min(1, lit.fade * dt)

  // The players in the floor's own px: how far a space is from them says how strongly its light is seen (`seenLevels`).
  const team = g.players.filter((q) => !q.gone).map((q) => ({ x: q.x - inside.x, y: q.y - inside.y }))

  // Area lights: every space of the floor (a room, a corridor, the chamber: any shape, `game/spaces.ts`) at its eased level.
  type Area = { region: Region; bounds: Bounds; level: number }
  const areas: Area[] = []
  const circle = inside.layout.floor[0]
  const spaces = plan ? spacesOf(plan) : circle?.kind === 'circle' ? chamberOf(inside.layout, circle) : null
  let factor: readonly number[] = []
  let spaceVisited = (_: number) => true
  if (spaces) {
    if (plan) {
      // A corridor counts as entered once a player has stood in it (kept here, for the screen only).
      let walked = corridorsWalked.get(plan)
      if (!walked) corridorsWalked.set(plan, (walked = new Set()))
      for (const q of team) {
        const space = hostOf(spaces, q.x, q.y)
        if (space >= plan.rooms.length) walked.add(space)
      }
      spaceVisited = (space) => (space < plan.rooms.length ? s.visited.includes(space) : walked.has(space))
    }
    const goal = roomLevels(spaces, s.sources, plan ? s.floor : Math.min(s.floor, caveLevel(s.level).floors - 1))
    const seen = seenLevels(spaces, goal, spaceVisited, team, atDepth(lit, plan ? s.floor : Math.min(s.floor, caveLevel(s.level).floors - 1)))
    factor = seen.factor
    let shown = shownSpaces.get(spaces)
    if (!shown) shownSpaces.set(spaces, (shown = goal.map(() => 0)))
    goal.forEach((_, space) => {
      shown![space] = shown![space]! + (seen.level[space]! - shown![space]!) * ease
      if (shown![space]! <= 0.005) return
      areas.push({ region: spaces.spaces[space]!.region, bounds: spaces.spaces[space]!.bounds, level: shown![space]! })
    })
  }

  for (const space of opts.litRooms ?? []) {
    const sp = spaces?.spaces[space]
    if (sp) areas.push({ region: sp.region, bounds: sp.bounds, level: 1 })
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
  // Each player's light is its Pokémon's (`data/pokemonLight.ts`): a flame flickers, a bat's sonar is wide and faint.
  const flame = Math.round(Math.sin(t * 9) + Math.sin(t * 23))
  for (const p of g.players) {
    if (p.gone) continue
    const reach = lightRange(g, p)
    const own = lightOf(g, p)
    points.push({ x: p.x, y: p.y - 10, r: (reach + (own.emits ? flame : 0)) * lit.playerScale, i: Math.min(1, own.glow) })
    litBy.push([p.x, p.y - 10, reach * 0.8])
  }
  // A wild emitter (a flame, a charge) lights its own corner of the dark, once its room has been entered.
  let emitters = 0
  for (const e of g.enemies) {
    if (emitters >= ENEMY_LIGHT.max) break
    if (e.dying >= 0) continue
    const prof = profileOf(ENEMIES[e.kind].dex)
    if (!prof.emits || e.x < camX - 120 || e.y < camY - 120 || e.x > camX + w + 120 || e.y > camY + h + 120 || !glows(e.x, e.y)) continue
    points.push({ x: e.x, y: e.y - 8, r: prof.range * ENEMY_LIGHT.range + flame, i: Math.min(1, prof.glow * ENEMY_LIGHT.glow) })
    emitters++
  }
  // A light source gives light only while it is on (touched, as the Nightmare's lanterns are): off, nothing at all. On, it has its aura,
  // weaker the farther its space is from the players (`factor`), eased in and blinking out at the end.
  s.sources.forEach((k, i) => {
    if (!(lit.allOn || k.on)) return
    const space = spaces ? hostOf(spaces, k.x, k.y) : -1
    if (space >= 0 && !spaceVisited(space)) return
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
  const black = opts.black ?? lit.black
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
        const fx = wx - inside.x
        const fy = wy - inside.y
        for (const a of areas) {
          if (fx < a.bounds.x0 - spill || fx > a.bounds.x1 + spill || fy < a.bounds.y0 - spill || fy > a.bounds.y1 + spill) continue
          const d = Math.max(0, regionSdf(a.region, fx, fy))
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

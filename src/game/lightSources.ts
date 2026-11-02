import { LIGHT_KINDS, type LightKind } from '../data/lightSources'
import type { DungeonFloor, Rect } from './dungeon'
import { spaceAt } from './dungeon'
import * as dm from '../engine/dmath'

/**
 * The cave's light sources, as pure rules (the data is `data/lightSources.ts`, the drawing `render/caveDark.ts`).
 *
 * A *space* is a room (index `s < rooms.length`) or a corridor (`rooms.length + l`, `l` the index into `links`), with a floor
 * area `A_S`. A source is *off* (gives no light at all) or *on* (`e_k = Φ_κ`, its kind's strength). The energy of a space is
 *
 *     E_S = Σ e_k  (sources standing in S)  +  δ · Σ e_k · max(0, 1 − d_kS / ρ)  (sources in a corridor close to the room S)
 *
 * and its level, from `L0` (the floor a visited space starts at) toward `Lmax`, is
 *
 *     L_S = L0 + (Lmax − L0) · (1 − exp(−E_S / (E0 · (A_S / A_ref)^γ)))
 *
 * (`levelOf`): no source on, `L_S = L0`; more sources or a smaller space, brighter; never above `Lmax`.
 * From another space the light of an *on* source is seen weaker, by `attenuation(D)` of the distance `D` of the nearest player to its
 * space (1 inside it).
 */

export type LightSource = { x: number; y: number; kind: LightKind; on: boolean; left: number; age: number }

/** How lit a space is, from its energy: the pure rule behind the light the screen draws and how often the dark spawns foes. */
export type LevelNumbers = { floor: number; max: number; e0: number; gamma: number; aref: number; reach: number; door: number; depth: number }

export const levelOf = (e: number, area: number, n: LevelNumbers) => n.floor + (n.max - n.floor) * (1 - dm.exp(-e / (n.e0 * dm.pow(area / n.aref, n.gamma))))

/**
 * The numbers as they are `floor` floors down (0 is B1F): each floor down multiplies `L0`, the level a visited space starts at, by `depth`
 * (0.72: B1F 0.07, B2F 0.050, B3F 0.036, B4F 0.026, B5F 0.019), so the deeper the cave the darker a room that nobody lit stays. The ceiling and the
 * sources' energy are the same, so lighting a room still brings it up (from a lower start).
 */
export const atDepth = <N extends LevelNumbers>(n: N, floor: number): N => ({ ...n, floor: n.floor * dm.pow(n.depth, floor) })

/** The numbers of the fall-off with distance (`LIGHT_FIELD`). */
export type RemoteNumbers = { remoteMin: number; remoteDecay: number; remoteReach: number; remoteFade: number }

const smooth = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return k * k * (3 - 2 * k)
}

/**
 * The share of an *on* source's light (the part it adds over `L0`, and its aura) seen from `D` px away from its space:
 *
 *     a(D) = [ α + (1 − α) · e^(−D/λ) ] · [ 1 − smooth((D − D_v) / D_f) ]
 *
 * 1 inside the space (D = 0), never below `α` until `D_v`, then out to nothing over `D_f` px.
 */
export const attenuation = (distance: number, n: RemoteNumbers) =>
  (n.remoteMin + (1 - n.remoteMin) * dm.exp(-distance / n.remoteDecay)) * (1 - smooth((distance - n.remoteReach) / Math.max(1, n.remoteFade)))

/** How many spaces the floor has: its rooms, then its corridors. */
export const spaceCount = (plan: Pick<DungeonFloor, 'rooms' | 'links'>) => plan.rooms.length + plan.links.length

/** What is left of rectangle `r` once `q` is taken out of it: up to four rectangles that don't overlap `q` (`r` itself when they don't touch). */
export const subtractRect = (r: Rect, q: Rect): Rect[] => {
  const x0 = Math.max(r.x, q.x)
  const y0 = Math.max(r.y, q.y)
  const x1 = Math.min(r.x + r.w, q.x + q.w)
  const y1 = Math.min(r.y + r.h, q.y + q.h)
  if (x0 >= x1 || y0 >= y1) return [r]
  const out: Rect[] = []
  if (y0 > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: y0 - r.y })
  if (y1 < r.y + r.h) out.push({ x: r.x, y: y1, w: r.w, h: r.y + r.h - y1 })
  if (x0 > r.x) out.push({ x: r.x, y: y0, w: x0 - r.x, h: y1 - y0 })
  if (x1 < r.x + r.w) out.push({ x: x1, y: y0, w: r.x + r.w - x1, h: y1 - y0 })
  return out
}

const corridorCache = new WeakMap<DungeonFloor['links'], Rect[][]>()

/**
 * The floor a corridor really is: its stretches (`Link.rects`, each a segment of the corridor's path widened by the corridor's width, and
 * running half that past both ends so the bends join) *minus the rooms*. The path starts and ends at a point inside each room, so the raw
 * stretches run well into the rooms (a big room's middle is far from its wall); counted whole, a corridor would claim part of every room
 * it opens into: a tint, an area and a distance that are not the corridor's. Clipped to what lies between the rooms, each piece is at
 * most one corridor wide (`DUNGEON.corridor`) and as long as the gap it crosses plus the bend's overlap.
 */
const corridorFloor = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, l: number): readonly Rect[] => {
  let known = corridorCache.get(plan.links)
  if (!known) corridorCache.set(plan.links, (known = []))
  let rects = known[l]
  if (!rects) {
    rects = plan.links[l]!.rects.flatMap((raw) => plan.rooms.reduce<Rect[]>((pieces, room) => pieces.flatMap((p) => subtractRect(p, room)), [raw])).filter((r) => r.w > 0.5 && r.h > 0.5)
    known[l] = rects
  }
  return rects
}

/** The rectangles of a space: the room itself, or the floor of the corridor between the rooms (`corridorFloor`). */
export const spaceRects = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, s: number): readonly Rect[] => (s < plan.rooms.length ? [plan.rooms[s]!] : corridorFloor(plan, s - plan.rooms.length))

/** The floor area of a space, px². */
export const spaceArea = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, s: number) => spaceRects(plan, s).reduce((a, r) => a + r.w * r.h, 0)

const distToRect = (r: Rect, x: number, y: number) => dm.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)))

/** Distance from (x, y) to a space (0 inside it). */
export const distToSpace = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, s: number, x: number, y: number) => {
  let best = Infinity
  for (const r of spaceRects(plan, s)) best = Math.min(best, distToRect(r, x, y))
  return best
}

/** The nearest of `players` to a space, px (0 when one stands in it). */
export const playersDistance = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, s: number, players: ReadonlyArray<{ x: number; y: number }>) => {
  let best = Infinity
  for (const p of players) best = Math.min(best, distToSpace(plan, s, p.x, p.y))
  return best
}

/** The energy `E_S` of every space of `plan` (rooms, then corridors) from the sources that are on (`all` counts every one: the lab). */
export const spaceEnergies = (plan: DungeonFloor, sources: readonly LightSource[], n: Pick<LevelNumbers, 'reach' | 'door'>, all = false): number[] => {
  const energy = Array<number>(spaceCount(plan)).fill(0)
  for (const k of sources) {
    if (!all && !k.on) continue
    const e = LIGHT_KINDS[k.kind].strength
    const host = spaceAt(plan, k.x, k.y)
    if (host >= 0) energy[host]! += e
    // A source in a corridor also lights the rooms it opens into, fading with the distance to them.
    if (host >= plan.rooms.length) {
      for (let s = 0; s < plan.rooms.length; s++) {
        const d = distToRect(plan.rooms[s]!, k.x, k.y)
        if (d > 0 && d < n.reach) energy[s]! += n.door * e * (1 - d / n.reach)
      }
    }
  }
  return energy
}

/** Every space's level `L_S` (rooms, then corridors), before any distance and whether it was visited. */
export const spaceLevels = (plan: DungeonFloor, sources: readonly LightSource[], n: LevelNumbers, all = false): number[] =>
  spaceEnergies(plan, sources, n, all).map((e, s) => levelOf(e, spaceArea(plan, s), n))

/** Indices of the sources that are on. */
export const onSources = (sources: readonly LightSource[]) => sources.flatMap((k, i) => (k.on ? [i] : []))

/**
 * What the players see of every space (rooms, then corridors): `level[S]` is `L̃_S`, and `factor[S]` the `a(D_S)` it came with
 * (the aura of the sources in S is scaled by it too). A visited room is `L0` plus what its sources add over `L0`, weakened by distance:
 *
 *     L̃_S = L0 + (L_S − L0) · a(D_S)
 *
 * so with no source on it is `L0` however far, and inside the space (D = 0) it is `L_S`. A corridor has no base of its own (only what
 * its sources add counts). A space not visited stays 0. `players` are in the floor's own px; `visited(s)` says whether space `s` was.
 */
export const seenLevels = (plan: DungeonFloor, levels: readonly number[], visited: (space: number) => boolean, players: ReadonlyArray<{ x: number; y: number }>, n: LevelNumbers & RemoteNumbers) => {
  const level: number[] = []
  const factor: number[] = []
  levels.forEach((l, s) => {
    const a = attenuation(playersDistance(plan, s, players), n)
    factor.push(a)
    const base = s < plan.rooms.length ? n.floor : 0
    level.push(visited(s) ? base + (l - n.floor) * a : 0)
  })
  return { level, factor }
}

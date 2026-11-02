import { LIGHT_KINDS, type LightKind } from '../data/lightSources'
import { hostOf, spaceSdf, type SpaceMap } from './spaces'
import * as dm from '../engine/dmath'

/**
 * The cave's light sources, as pure rules (the data is `data/lightSources.ts`, the drawing `render/caveDark.ts`).
 *
 * A *space* (`game/spaces.ts`) is a region of any shape (a room, a corridor, the treasure chamber…) with a floor area `A_S`. A source is *off* (gives no light at all) or *on* (`e_k = Φ_κ`, its kind's strength). The energy of a space is
 *
 *     E_S = Σ e_k  (sources standing in S)  +  δ · Σ e_k · max(0, 1 − d_kS / ρ)  (sources in a corridor close to the room S, by the signed distance to it)
 *
 * and its level, from `L0` (the floor a visited space starts at) toward `Lmax`, is
 *
 *     L_S = L0 + (Lmax − L0) · (1 − exp(−E_S / (E0 · (A_S / A_ref)^γ)))
 *
 * (`levelOf`): no source on, `L_S = L0`; more sources or a smaller space, brighter; never above `Lmax`.
 * From another space the light of an *on* source is seen weaker, by `attenuation(D)` of the distance `D` of the nearest player to its
 * space, by the way one walks (`spaceDistances`; 0 inside it).
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

/**
 * How far each space is from the nearest of `players`, px, by the way one walks: 0 for the space a player stands in, else the walk to
 * its nearest door (Dijkstra over the doors: from a player to the doors of their space, and from door to door through a space: its
 * `walk` when it has one, else the straight line). Light does not go through rock, so a room behind a wall is as far as the way round.
 * A player standing in the rock counts at the nearest space, plus the distance to it. A space nobody can walk to is as far as the
 * straight distance to it (the signed distance, cut at 0).
 */
export const spaceDistances = (map: SpaceMap, players: ReadonlyArray<{ x: number; y: number }>): number[] => {
  const out = Array<number>(map.spaces.length).fill(Infinity)
  const door = Array<number>(map.doors.length).fill(Infinity)
  for (const p of players) {
    // The space they stand in, or the nearest to them.
    let host = -1
    let off = Infinity
    for (let s = 0; s < map.spaces.length; s++) {
      const d = spaceSdf(map, s, p.x, p.y)
      if (d < off) {
        off = d
        host = s
      }
    }
    if (host < 0) continue
    off = Math.max(0, off)
    out[host] = Math.min(out[host]!, off)
    map.doors.forEach((d, i) => {
      if (d.a === host || d.b === host) door[i] = Math.min(door[i]!, off + dm.hypot(d.x - p.x, d.y - p.y))
    })
  }
  // Door to door through a space, until nothing shortens (a few dozen doors).
  const through = (s: number, a: number, b: number) => map.spaces[s]!.walk ?? dm.hypot(map.doors[a]!.x - map.doors[b]!.x, map.doors[a]!.y - map.doors[b]!.y)
  const done = Array<boolean>(map.doors.length).fill(false)
  for (;;) {
    let u = -1
    for (let i = 0; i < door.length; i++) if (!done[i] && door[i]! < Infinity && (u < 0 || door[i]! < door[u]!)) u = i
    if (u < 0) break
    done[u] = true
    const d = map.doors[u]!
    for (const s of [d.a, d.b]) {
      out[s] = Math.min(out[s]!, door[u]!)
      map.doors.forEach((o, v) => {
        if (v !== u && (o.a === s || o.b === s) && door[u]! + through(s, u, v) < door[v]!) door[v] = door[u]! + through(s, u, v)
      })
    }
  }
  // Nobody can walk to it (a space with no door): the straight distance.
  return out.map((d, s) => (d < Infinity ? d : Math.min(...players.map((p) => Math.max(0, spaceSdf(map, s, p.x, p.y))), Infinity)))
}

/** The distance of space `s` from the nearest of `players` (`spaceDistances`). */
export const playersDistance = (map: SpaceMap, s: number, players: ReadonlyArray<{ x: number; y: number }>) => spaceDistances(map, players)[s]!

/**
 * The energy `E_S` of every space of the map from the sources that are on (`all` counts every one: the lab). A source in a corridor
 * also lights the spaces that open into its corridor (its neighbors through a door), fading with its distance to them.
 */
export const spaceEnergies = (map: SpaceMap, sources: readonly LightSource[], n: Pick<LevelNumbers, 'reach' | 'door'>, all = false): number[] => {
  const energy = Array<number>(map.spaces.length).fill(0)
  for (const k of sources) {
    if (!all && !k.on) continue
    const e = LIGHT_KINDS[k.kind].strength
    const host = hostOf(map, k.x, k.y)
    if (host >= 0) energy[host]! += e
    if (host < 0 || map.spaces[host]!.kind !== 'corridor') continue
    for (const s of map.neighbors[host]!) {
      const d = spaceSdf(map, s, k.x, k.y)
      if (d > 0 && d < n.reach) energy[s]! += n.door * e * (1 - d / n.reach)
    }
  }
  return energy
}

/** Every space's level `L_S`, before any distance and whether it was visited. */
export const spaceLevels = (map: SpaceMap, sources: readonly LightSource[], n: LevelNumbers, all = false): number[] =>
  spaceEnergies(map, sources, n, all).map((e, s) => levelOf(e, map.spaces[s]!.area, n))

/** Indices of the sources that are on. */
export const onSources = (sources: readonly LightSource[]) => sources.flatMap((k, i) => (k.on ? [i] : []))

/**
 * What the players see of every space: `level[S]` is `L̃_S`, and `factor[S]` the `a(D_S)` it came with (the aura of the sources in S is
 * scaled by it too). A visited space that has a base (a room, the chamber) is `L0` plus what its sources add over `L0`, weakened by distance:
 *
 *     L̃_S = L0 + (L_S − L0) · a(D_S)
 *
 * so with no source on it is `L0` however far, and inside the space (D = 0) it is `L_S`. A corridor has no base of its own (only what
 * its sources add counts). A space not visited stays 0. `players` are in the floor's own px; `visited(s)` says whether space `s` was.
 */
export const seenLevels = (map: SpaceMap, levels: readonly number[], visited: (space: number) => boolean, players: ReadonlyArray<{ x: number; y: number }>, n: LevelNumbers & RemoteNumbers) => {
  const level: number[] = []
  const factor: number[] = []
  const far = spaceDistances(map, players)
  levels.forEach((l, s) => {
    const a = attenuation(far[s]!, n)
    factor.push(a)
    const base = map.spaces[s]!.base ? n.floor : 0
    level.push(visited(s) ? base + (l - n.floor) * a : 0)
  })
  return { level, factor }
}

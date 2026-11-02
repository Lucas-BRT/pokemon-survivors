import type { Ellipse } from '../data/terrain'
import * as dm from '../engine/dmath'
import { doorOf, roomAt, spaceAt, type DungeonFloor, type Rect } from './dungeon'

/**
 * How walkers find their way through a cave floor: a graph of waypoints and a shortest-path field to the player, so they go round rocks
 * and out of a room by its door instead of pressing against what is in the way.
 *
 * The graph (`buildNavGraph`, built once per floor):
 *  - nodes: a room's middle and the corners of the area `MARGIN` px inside its walls, a node just inside each corridor's door, one at each
 *    bend of every corridor, and four around each rock or crystal (on its foot grown by `MARGIN`, a little out);
 *  - edges: between the nodes of one room whose straight line misses every grown foot (a room is convex, so inside it nothing but rocks
 *    can be in the way), and along each corridor from door to door (its stretches are straight lines).
 *
 * The field (`pathField`, per player per tick): `D[n]`, the walk from node `n` to the player, by Dijkstra from the nodes the player sees.
 * A walker at (x, y) heads for the visible node `n` that minimizes `|(x, y) − n| + D[n]` (`steer`): a consistent potential, so it never
 * turns back or circles; or straight for the player when it sees them. Pure, integer-free arithmetic through `dmath`: every engine agrees.
 */

/** Px from a node at which a walker counts as standing on it. */
const ARRIVED = 5

/** Px within which two nodes count as costing the same. */
const TIE = 2

/** Px of clearance a walker keeps from walls and from rocks (its body's radius, with room to slide). */
export const MARGIN = 10

/** Px of a walker's body radius (what its line of sight keeps from a rock). */
const BODY = 8

/** Px from a walker's middle to each side that must stay on the floor on a straight run. */
const SIDE = 5

/** Px at the far end of a straight run that need not be on the floor. */
const END = 8

/** Px within which a walker checks the way straight to the player (farther off the graph does the walking; the check is a scan of the floor). */
const NEAR = 100

type Pt = readonly [number, number]

type Node = { x: number; y: number }
type Edge = { to: number; w: number }

export type NavGraph = {
  nodes: Node[]
  adj: Edge[][]
  /** The nodes of each room, and each corridor's chain of nodes (door, bends…, door: one per point of its path). */
  byRoom: number[][]
  chain: number[][]
  /** The feet of what stands on the floor, grown by `MARGIN`. */
  blockers: Ellipse[]
  /** The same feet grown by a body's width only, for what a walker sees from where it stands (it may press against the grown ones). */
  sight: Ellipse[]
}

/** Whether a body walking the segment (ax, ay)-(bx, by) keeps all four of its sides (`BODY` px from its middle) on the floor. */
const wayOpen = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, ax: number, ay: number, bx: number, by: number) => {
  const len = dm.hypot(bx - ax, by - ay)
  // The last stretch is not checked: the player may stand against a wall, and a walker only needs to come near.
  const n = Math.ceil(len / 3)
  for (let i = 0; i <= n && (len * (n - i)) / n > END; i++) {
    const x = ax + ((bx - ax) * i) / n
    const y = ay + ((by - ay) * i) / n
    if (spaceAt(plan, x - SIDE, y) < 0 || spaceAt(plan, x + SIDE, y) < 0 || spaceAt(plan, x, y - SIDE) < 0 || spaceAt(plan, x, y + SIDE) < 0) return false
  }
  return true
}

/** Whether the segment (ax, ay)-(bx, by) passes through any of the ellipses. */
const blocked = (blockers: readonly Ellipse[], ax: number, ay: number, bx: number, by: number) => {
  for (const e of blockers) {
    // In the ellipse's own units it is a unit circle: the segment's distance to the center against 1.
    const x0 = (ax - e.x) / e.rx
    const y0 = (ay - e.y) / e.ry
    const dx = (bx - e.x) / e.rx - x0
    const dy = (by - e.y) / e.ry - y0
    const len2 = dx * dx + dy * dy
    // A walker presses against a rock closer than the grown foot (its body is thinner than MARGIN): from inside, only a line that goes deeper is held.
    if (x0 * x0 + y0 * y0 < 1) {
      if (x0 * dx + y0 * dy < 0) return true
      continue
    }
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(x0 * dx + y0 * dy) / len2)) : 0
    const cx = x0 + dx * t
    const cy = y0 + dy * t
    if (cx * cx + cy * cy < 1) return true
  }
  return false
}

const inBlocker = (blockers: readonly Ellipse[], x: number, y: number) => blockers.some((e) => dm.sq((x - e.x) / e.rx) + dm.sq((y - e.y) / e.ry) < 1)

const inInner = (r: Rect, x: number, y: number) => x >= r.x + MARGIN && x <= r.x + r.w - MARGIN && y >= r.y + MARGIN && y <= r.y + r.h - MARGIN

/**
 * The nearest free spot to (x, y) that is out of every grown foot: the point itself when it is, else the first on rings round it
 * (every 30°, each 4 px wider) that is. A rock standing in a doorway must not seal its corridor off the graph.
 */
const freeNear = (blockers: readonly Ellipse[], x: number, y: number): Pt => {
  if (!inBlocker(blockers, x, y)) return [x, y]
  for (let r = 4; r <= 48; r += 4) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const px = x + dm.cos(a) * r
      const py = y + dm.sin(a) * r
      if (!inBlocker(blockers, px, py)) return [px, py]
    }
  }
  return [x, y]
}

/** Builds the graph of a floor whose rocks and crystals have these feet (floor px). */
export const buildNavGraph = (plan: Pick<DungeonFloor, 'rooms' | 'links'>, feet: readonly Ellipse[]): NavGraph => {
  const blockers = feet.map((e): Ellipse => ({ x: e.x, y: e.y, rx: e.rx + MARGIN, ry: e.ry + MARGIN }))
  const sight = feet.map((e): Ellipse => ({ x: e.x, y: e.y, rx: e.rx + BODY, ry: e.ry + BODY }))
  const nodes: Node[] = []
  const adj: Edge[][] = []
  const byRoom: number[][] = plan.rooms.map(() => [])
  const chain: number[][] = []
  const add = (x: number, y: number) => {
    nodes.push({ x, y })
    adj.push([])
    return nodes.length - 1
  }
  const join = (a: number, b: number) => {
    const w = dm.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y)
    adj[a]!.push({ to: b, w })
    adj[b]!.push({ to: a, w })
  }
  plan.rooms.forEach((r, i) => {
    for (const [x, y] of [[r.x + r.w / 2, r.y + r.h / 2], [r.x + MARGIN, r.y + MARGIN], [r.x + r.w - MARGIN, r.y + MARGIN], [r.x + MARGIN, r.y + r.h - MARGIN], [r.x + r.w - MARGIN, r.y + r.h - MARGIN]] as const) {
      if (!inBlocker(blockers, x, y)) byRoom[i]!.push(add(x, y))
    }
  })
  plan.links.forEach((link, l) => {
    const n = link.path.length
    const ids: number[] = []
    link.path.forEach((p, k) => {
      if (k === 0 || k === n - 1) {
        const room = k === 0 ? link.a : link.b
        const [dx, dy] = k === 0 ? doorOf(plan.rooms[room]!, p, link.path[1]!, MARGIN + 2) : doorOf(plan.rooms[room]!, p, link.path[n - 2]!, MARGIN + 2)
        const [fx, fy] = freeNear(blockers, dx, dy)
        const id = add(fx, fy)
        byRoom[room]!.push(id)
        ids.push(id)
      } else {
        // A bend that repeats the one before (a corridor between rooms with no gap to bend in) is the same node.
        const before = link.path[k - 1]!
        ids.push(k > 1 && before[0] === p[0] && before[1] === p[1] ? ids[k - 1]! : add(p[0], p[1]))
      }
    })
    for (let k = 1; k < ids.length; k++) if (ids[k - 1] !== ids[k]) join(ids[k - 1]!, ids[k]!)
    chain[l] = ids
  })
  // Four nodes round every rock, a little out of its grown foot, in the room it stands in.
  const K = 0.7071 * 1.18
  for (const e of blockers) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const x = e.x + sx * e.rx * K
      const y = e.y + sy * e.ry * K
      const room = roomAt(plan, x, y)
      if (room < 0 || !inInner(plan.rooms[room]!, x, y) || inBlocker(blockers, x, y)) continue
      byRoom[room]!.push(add(x, y))
    }
  }
  // Inside a room, every pair of nodes that see each other.
  for (const ids of byRoom) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = nodes[ids[i]!]!
        const b = nodes[ids[j]!]!
        if (!blocked(blockers, a.x, a.y, b.x, b.y)) join(ids[i]!, ids[j]!)
      }
    }
  }
  // However rocks crowd a room (the Cristalário's crystals ring its doors), its nodes are one piece: where the straight lines are all
  // blocked, the nearest pair of the two pieces is joined anyway, and the walkers' collision slides them through.
  for (const ids of byRoom) {
    const piece = new Map<number, number>(ids.map((n, i) => [n, i]))
    const root = (n: number): number => {
      let r = piece.get(n)!
      while (piece.get(ids[r]!)! !== r) r = piece.get(ids[r]!)!
      return r
    }
    for (const a of ids) for (const e of adj[a]!) if (piece.has(e.to)) piece.set(ids[root(e.to)]!, root(a))
    for (;;) {
      let best: [number, number] | null = null
      let bestD = Infinity
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (root(ids[i]!) === root(ids[j]!)) continue
          const d = dm.hypot(nodes[ids[i]!]!.x - nodes[ids[j]!]!.x, nodes[ids[i]!]!.y - nodes[ids[j]!]!.y)
          if (d < bestD) {
            bestD = d
            best = [ids[i]!, ids[j]!]
          }
        }
      }
      if (!best) break
      join(best[0], best[1])
      piece.set(ids[root(best[0])]!, root(best[1]))
    }
  }
  return { nodes, adj, byRoom, chain, blockers, sight }
}

const graphs = new WeakMap<object, { feet: readonly Ellipse[]; graph: NavGraph }>()

/** The graph of `plan` for these feet, built once (again if the floor's feet are a different list). */
export const navGraphOf = (plan: DungeonFloor, feet: readonly Ellipse[]): NavGraph => {
  const known = graphs.get(plan)
  if (known && known.feet === feet) return known.graph
  const graph = buildNavGraph(plan, feet)
  graphs.set(plan, { feet, graph })
  return graph
}

/** The nodes a point at (x, y) sees: its room's that no rock hides, and the ends of the corridor stretches it stands in; empty in the rock. */
const visible = (graph: NavGraph, plan: Pick<DungeonFloor, 'rooms' | 'links'>, x: number, y: number): number[] => {
  const room = roomAt(plan, x, y)
  const out: number[] = []
  // In a corridor, or in a room on the way to one (the stretches run from the room's middle): both ends of each (two at a bend, where
  // they overlap), so a walker at a door already sees where the corridor goes on and never turns back for the door.
  for (let l = 0; l < plan.links.length; l++) {
    const rects = plan.links[l]!.rects
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) for (const n of [graph.chain[l]![i]!, graph.chain[l]![i + 1]!]) if (!out.includes(n)) out.push(n)
    }
  }
  if (room < 0) return out
  const all = graph.byRoom[room]!
  const seen = all.concat(out.filter((n) => !all.includes(n))).filter((n) => !blocked(graph.sight, x, y, graph.nodes[n]!.x, graph.nodes[n]!.y))
  // Pressed against a rock: nothing is "visible"; the nearest node of the room will do, the collision slides it round.
  if (seen.length === 0 && all.length > 0) {
    let best = all[0]!
    for (const n of all) if (dm.hypot(graph.nodes[n]!.x - x, graph.nodes[n]!.y - y) < dm.hypot(graph.nodes[best]!.x - x, graph.nodes[best]!.y - y)) best = n
    return [best]
  }
  return seen
}

export type PathField = { graph: NavGraph; plan: Pick<DungeonFloor, 'rooms' | 'links'>; px: number; py: number; D: Float64Array }

/** The walk from every node to the player at (px, py): Dijkstra from the nodes they see, each starting at its distance from them. */
export const pathField = (graph: NavGraph, plan: Pick<DungeonFloor, 'rooms' | 'links'>, px: number, py: number): PathField | null => {
  const seen = visible(graph, plan, px, py)
  // Only the nodes a body can walk straight to the player from; if the player stands where none can (pressed in a corner), all they see.
  const open = seen.filter((s) => wayOpen(plan, graph.nodes[s]!.x, graph.nodes[s]!.y, px, py))
  const sources = open.length > 0 ? open : seen
  if (sources.length === 0) return null
  const n = graph.nodes.length
  const D = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  for (const s of sources) D[s] = dm.hypot(graph.nodes[s]!.x - px, graph.nodes[s]!.y - py)
  for (;;) {
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && D[i]! < Infinity && (u < 0 || D[i]! < D[u]!)) u = i
    if (u < 0) break
    done[u] = 1
    for (const e of graph.adj[u]!) if (D[u]! + e.w < D[e.to]!) D[e.to] = D[u]! + e.w
  }
  return { graph, plan, px, py, D }
}

/**
 * Where a walker at (x, y) should head: writes the waypoint into `out` and returns true, or returns false to go straight for the player
 * (it sees them, or nothing better is known).
 */
export const steer = (field: PathField, x: number, y: number, out: { x: number; y: number }) => {
  const { graph, plan, px, py, D } = field
  const here = spaceAt(plan, x, y)
  // The player in view: the same room with no rock between.
  if (here >= 0 && here < plan.rooms.length && here === spaceAt(plan, px, py) && !blocked(graph.sight, x, y, px, py)) return false
  // The way straight to the player is open: the player is one more vertex of the graph, and the shortest walk.
  if (dm.sq(px - x) + dm.sq(py - y) < dm.sq(NEAR) && wayOpen(plan, x, y, px, py) && !blocked(graph.sight, x, y, px, py)) return false
  const seen = visible(graph, plan, x, y)
  let best = -1
  let bestCost = Infinity
  let nearest = -1
  let nearestD = Infinity
  // The node with the least walk to the player from here: the distance to it plus its own `D`.
  for (const n of seen) {
    const d = dm.hypot(graph.nodes[n]!.x - x, graph.nodes[n]!.y - y)
    if (d < nearestD) {
      nearestD = d
      nearest = n
    }
    if (D[n]! === Infinity) continue
    // Nodes whose cost is within TIE px go to the one nearer the player, so a walker never flips between two that cost the same.
    const cost = d + D[n]!
    if (cost < bestCost - TIE || (cost < bestCost + TIE && best >= 0 && D[n]! < D[best]!)) {
      bestCost = cost
      best = n
    }
  }
  if (best >= 0) {
    const node = graph.nodes[best]!
    const arrived = dm.hypot(node.x - x, node.y - y) < ARRIVED
    // On any other node: aim at the node the walk goes on to, the one that gave this node its `D`, so a walker never stands on a node.
    let next = -1
    let nextCost = Infinity
    for (const e of graph.adj[best]!) {
      if (!(D[e.to]! < D[best]!) || D[e.to]! + e.w >= nextCost) continue
      const m = graph.nodes[e.to]!
      if (arrived && wayOpen(plan, x, y, m.x, m.y) && !blocked(graph.sight, x, y, m.x, m.y)) {
        next = e.to
        nextCost = D[e.to]! + e.w
      }
    }
    if (next >= 0) best = next
  }
  if (best < 0) best = nearest
  if (best < 0 || D[best]! === Infinity) return false
  out.x = graph.nodes[best]!.x
  out.y = graph.nodes[best]!.y
  return true
}

/**
 * Steering through a dungeon floor for walkers chasing the player at (px, py), all in floor px, round the rocks and crystals standing in
 * it (`feet`, floor px). The returned function writes where a walker at (x, y) should head into `out` and returns true, or returns false
 * when it can go straight for the player (it sees them). Null when the player stands in the rock (nowhere known).
 */
export const dungeonNav = (floor: DungeonFloor, px: number, py: number, feet: readonly Ellipse[] = NO_FEET) => {
  const graph = navGraphOf(floor, feet)
  const field = cachedField(graph, floor, px, py)
  if (!field) return null
  return (x: number, y: number, out: { x: number; y: number }) => steer(field, x, y, out)
}

const NO_FEET: readonly Ellipse[] = []

/** The last few fields, reused while the player stays within a few px (their node distances barely move). */
const recent: Array<{ graph: NavGraph; qx: number; qy: number; field: PathField | null }> = []
const QUANT = 6

const cachedField = (graph: NavGraph, plan: DungeonFloor, px: number, py: number) => {
  const qx = Math.floor(px / QUANT)
  const qy = Math.floor(py / QUANT)
  const hit = recent.find((r) => r.graph === graph && r.qx === qx && r.qy === qy)
  if (hit) return hit.field
  const field = pathField(graph, plan, px, py)
  recent.unshift({ graph, qx, qy, field })
  if (recent.length > 6) recent.pop()
  return field
}

const feetCache = new WeakMap<readonly unknown[], Ellipse[]>()

/** The feet of a floor's solids (rocks, crystals) in floor px (`ox`, `oy` is where the floor stands in the world), worked out once per list. */
export const floorFeet = (solids: ReadonlyArray<{ foot: readonly Ellipse[] }>, ox: number, oy: number): readonly Ellipse[] => {
  let feet = feetCache.get(solids)
  if (!feet) feetCache.set(solids, (feet = solids.flatMap((s) => s.foot.map((e): Ellipse => ({ x: e.x - ox, y: e.y - oy, rx: e.rx, ry: e.ry })))))
  return feet
}

import { coopLocked } from '../data/coop'
import { DROP_TABLES, rollDrop } from '../data/consumables'
import type { EnemyId } from '../data/enemies'
import { MAZE } from '../data/landmarks'
import { MAZE_CAST, MAZE_RUN } from '../data/mazeEvents'
import { createRng, weightedPick } from '../engine/rng'
import { dropItem } from './consumables'
import { burst, floatText } from './effects'
import { spawnEnemy } from './enemies'
import { spawnAlpha } from './alphas'
import { mazeOrigin, MAZE_LAYOUTS } from './landmarkLayout'
import { MAZE_COUNT } from '../data/landmarks'
import type { spawnMapEvent as SpawnMapEvent } from './mapEvents'
import { COIN_VALUES } from './meta'
import { dropCoins } from './pickups'
import { centerScreen, standing } from './players'
import { roomOf } from './room'
import { featuresNear, type Landmark } from './terrain'
import { deadEnds, distances, openings } from './procgen/maze'
import type { Game } from './types'
import * as dm from '../engine/dmath'

/**
 * What happens inside an overworld hedge maze (`data/mazeEvents.ts`). The first time a player comes near one, its run is built from
 * the maze's own seed (so a replay builds the same): the dead ends are drawn into traps (spikes and bombs, the map events'), small
 * chests, a decoy chest that bites, keys and a pair of rings that carry a player to the other end; some corridors hide a Pokémon that
 * springs out when one comes close; and the chest at the heart (locked until the keys are in, when there are keys) wakes a guardian
 * the moment it opens. Scenery only in co-op (`COOP_LOCKS`), like the other landmarks.
 */

export type MazeMoment = 'key' | 'locked' | 'cache' | 'decoy' | 'ambush' | 'guard' | 'ring' | 'thief'

/** A small chest in a dead end: `decoy` ones spring a surprise instead of paying. */
export type MazeCache = { x: number; y: number; open: boolean; t: number; decoy: EnemyId | null }
export type MazeTrap = { x: number; y: number; kind: 'spikes' | 'bomb'; ev: number; fused: boolean; done: boolean }
export type MazeHidden = { x: number; y: number; kind: EnemyId; fired: boolean }
export type MazeKey = { x: number; y: number; taken: boolean }

export type MazeRun = {
  cell: number
  caches: MazeCache[]
  traps: MazeTrap[]
  hidden: MazeHidden[]
  keys: MazeKey[]
  /** The rings (two spots) and, by player slot, the one each just came out of (it takes them back only once they step off it). */
  rings: Array<{ x: number; y: number }>
  ringTime: Record<number, number>
  ringLock: Record<number, number>
  /** When (`g.now`) the locked chest last said it waits for keys, so it doesn't repeat itself every frame. */
  hintAt: number
  /** The guardian's enemy id once the heart's chest is open (0 before). */
  guard: number
}

/** The cave-free state of every maze met this run, by landmark cell. */
export const createMazeState = (): Map<number, MazeRun> => new Map()

const notify = (g: Game, moment: MazeMoment, n = 0, of = 0) => g.events.push({ kind: 'maze', moment, n, of })

/** The run of the maze `lm`, built on first use. */
const runOf = (g: Game, lm: Landmark): MazeRun => {
  const known = g.mazes.get(lm.cell)
  if (known) return known
  const { maze, entrance, goal } = MAZE_LAYOUTS[lm.variant % MAZE_COUNT]!
  const rng = createRng(dm.round(lm.cell * 7919 + lm.variant * 104729 + 17))
  const o = mazeOrigin(maze.cols, maze.rows)
  const at = (c: number, r: number) => ({ x: dm.round(lm.x + o.x + (c + 0.5) * MAZE.cell), y: dm.round(lm.y + o.y + (r + 0.5) * MAZE.cell) })
  const fromIn = distances(maze, entrance.c, entrance.r).dist
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }
  const cast = MAZE_CAST[g.biome.id]
  const ends = shuffle(deadEnds(maze).filter((e) => !(e.c === goal.c && e.r === goal.r) && fromIn[e.r * maze.cols + e.c]! >= 3))
  const take = (n: number) => ends.splice(0, n).map((e) => at(e.c, e.r))
  const rings = ends.length >= 7 && rng() < MAZE_RUN.ringOdds ? take(1).concat(take(ends.length - 1 > 0 ? 1 : 0)) : []
  const locked = rng() < MAZE_RUN.lockOdds
  const keys = (locked ? take(MAZE_RUN.keys) : []).map((p): MazeKey => ({ ...p, taken: false }))
  const decoy = rng() < MAZE_RUN.decoyOdds ? take(1) : []
  const caches = take(MAZE_RUN.caches)
  const decoyKind = (rng() < 0.5 ? 'voltorb' : cast.hide[0]) as EnemyId
  const traps = ends.splice(0).map((e, i): MazeTrap => ({ ...at(e.c, e.r), kind: i % 2 === 0 ? 'spikes' : 'bomb', ev: -1, fused: false, done: false }))
  // Hidden in the corridors (cells with two ways) away from the door and the heart.
  const corridors: Array<{ c: number; r: number }> = []
  for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) if (openings(maze, c, r) === 2 && fromIn[r * maze.cols + c]! >= 3 && !(c === goal.c && r === goal.r)) corridors.push({ c, r })
  const count = Math.min(MAZE_RUN.hidden.max, MAZE_RUN.hidden.base + Math.floor(g.time / 60 / MAZE_RUN.hidden.perMinutes))
  const hidden = shuffle(corridors).slice(0, count).map((e): MazeHidden => ({ ...at(e.c, e.r), kind: cast.hide[Math.floor(rng() * cast.hide.length)]!, fired: false }))
  const run: MazeRun = {
    cell: lm.cell,
    caches: [...caches.map((p): MazeCache => ({ ...p, open: false, t: 0, decoy: null })), ...decoy.map((p): MazeCache => ({ ...p, open: false, t: 0, decoy: decoyKind }))],
    traps,
    hidden,
    keys,
    rings,
    ringTime: {},
    ringLock: {},
    hintAt: -1e9,
    guard: 0,
  }
  g.mazes.set(lm.cell, run)
  return run
}

/** Keys still to find for the heart's chest of the maze at `cell` (0 when it isn't locked, or isn't built yet). */
export const keysLeft = (g: Game, cell: number) => g.mazes.get(cell)?.keys.filter((k) => !k.taken).length ?? 0

/** Whether the heart's chest of the maze at `cell` waits for keys. Opening it is tried by `landmarks.ts`. */
export const mazeLocked = (g: Game, cell: number) => keysLeft(g, cell) > 0

/** The locked chest of the maze at `cell` tells whoever stands at it how many keys are left, at most every few seconds. */
export const hintLocked = (g: Game, cell: number) => {
  const run = g.mazes.get(cell)
  if (!run || g.now - run.hintAt < 3) return
  run.hintAt = g.now
  notify(g, 'locked', keysLeft(g, cell), run.keys.length)
}

/** The guardian a maze wakes: the biome's, or (rarely) the forest's legendary. */
const guardian = (g: Game, lm: Landmark): EnemyId => {
  const rng = createRng(dm.round(lm.cell * 31 + g.time))
  if (rng() < MAZE_RUN.rare.odds && MAZE_RUN.rare.biomes.includes(g.biome.id)) return MAZE_RUN.rare.guard
  return weightedPick(rng, MAZE_CAST[g.biome.id].guard.map((id) => [id, 1] as const))
}

/** The heart's chest was opened: its guardian steps out of the hedges as an Alpha, and what came with it comes for the player. */
export const wakeGuardian = (g: Game, lm: Landmark, x: number, y: number) => {
  const run = runOf(g, lm)
  if (run.guard !== 0) return
  const boss = spawnAlpha(g, guardian(g, lm), x, y + 26)
  run.guard = boss.id
  burst(g, x, y + 10, { colors: ['#58a838', '#a8e068', '#2c5818'], count: 30, speed: 90, ttl: 0.7, gravity: 40 })
  notify(g, 'guard')
}

/** Whether (x, y) is within `r` px of the world point (px, py). */
const near = (x: number, y: number, px: number, py: number, r: number) => dm.sq(x - px) + dm.sq(y - py) < r * r

/** A player in play within `r` px of (x, y), or null. */
const someone = (g: Game, x: number, y: number, r: number) => g.players.find((p) => standing(g, p) && near(p.x, p.y, x, y, r)) ?? null

const cacheLoot = (g: Game, c: MazeCache) => {
  dropCoins(g, c.x, c.y - 4, Array.from({ length: MAZE_RUN.cacheCoins }, () => COIN_VALUES[1]))
  dropItem(g, c.x + 8, c.y - 2, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
  burst(g, c.x, c.y - 8, { colors: ['#ffffff', '#f8e070', '#f8c040', '#a8e0ff'], count: 18, speed: 80, ttl: 0.5, gravity: 60 })
  notify(g, 'cache')
}

/** What a decoy chest was: its Pokémon (or three of them) jumps out. */
const springDecoy = (g: Game, c: MazeCache) => {
  const kind = c.decoy!
  const n = kind === 'voltorb' ? 1 : 3
  for (let i = 0; i < n; i++) spawnEnemy(g, kind, c.x + (i - (n - 1) / 2) * 14, c.y + 8)
  burst(g, c.x, c.y - 8, { colors: ['#e83030', '#f8e858', '#ffffff', '#484848'], count: 26, speed: 120, ttl: 0.5 })
  notify(g, 'decoy')
}

const trapKind = { spikes: 'spikes', bomb: 'bomb' } as const

/** Runs every maze a player is near: traps, chests, keys, rings and the Pokémon in the hedges. */
/** `spawn` is the map events' (`mapEvents.ts`), handed in so this module never imports it (it would close an import cycle). */
export const updateMazes = (g: Game, dt: number, spawn: typeof SpawnMapEvent) => {
  if (coopLocked(g, 'landmarks') || roomOf(g)) return
  const woke = new Set<number>()
  for (const p of g.players) {
    if (!standing(g, p)) continue
    for (const f of featuresNear(g, p.x, p.y, MAZE_RUN.wake)) {
      const lm = f.landmark
      if (!lm || lm.id !== 'maze' || !near(lm.x, lm.y - (MAZE.cell * MAZE_LAYOUTS[lm.variant % MAZE_COUNT]!.maze.rows) / 2, p.x, p.y, MAZE_RUN.wake)) continue
      if (woke.has(lm.cell)) continue
      woke.add(lm.cell)
      const run = runOf(g, lm)
      stepTraps(g, run, spawn)
      stepCaches(g, run, dt)
      stepKeys(g, lm, run)
      stepRings(g, run, dt)
      stepHidden(g, run)
    }
  }
}

/** Keeps each trap's map event alive while someone is near (they are cleared when no one is, and put back), and retires a bomb that went off. */
const stepTraps = (g: Game, run: MazeRun, spawn: typeof SpawnMapEvent) => {
  for (const t of run.traps) {
    if (t.done) continue
    const ev = g.mapEvents.list.find((e) => e.id === t.ev && e.gone < 0)
    if (ev) {
      if (ev.kind === 'bomb' && ev.state.fuse >= 0) t.fused = true
      // Never timed out: a maze's trap waits for whoever comes.
      if (ev.kind === 'spikes') ev.ttl = Infinity
      continue
    }
    if (t.fused) {
      t.done = true
      continue
    }
    const placed = spawn(g, trapKind[t.kind], t.x, t.y)
    placed.ttl = Infinity
    t.ev = placed.id
  }
}

const stepCaches = (g: Game, run: MazeRun, dt: number) => {
  for (const c of run.caches) {
    if (c.open) continue
    const who = someone(g, c.x, c.y, MAZE_RUN.touch + 4)
    c.t = who ? c.t + dt : Math.max(0, c.t - dt * 2)
    if (c.t < MAZE_RUN.openTime) continue
    c.open = true
    if (c.decoy) springDecoy(g, c)
    else cacheLoot(g, c)
  }
}

const stepKeys = (g: Game, lm: Landmark, run: MazeRun) => {
  for (const k of run.keys) {
    if (k.taken || !someone(g, k.x, k.y, MAZE_RUN.touch)) continue
    k.taken = true
    const left = run.keys.filter((x) => !x.taken).length
    burst(g, k.x, k.y - 8, { colors: ['#f8e070', '#ffffff', '#a8e0ff'], count: 14, speed: 70, ttl: 0.5, gravity: 40 })
    floatText(g, k.x, k.y - 22, left > 0 ? `${run.keys.length - left}/${run.keys.length}` : '✔', '#f8e070')
    notify(g, 'key', run.keys.length - left, run.keys.length)
    // A thief was after it: it comes for whoever took the key.
    spawnEnemy(g, MAZE_RUN.thieves[Math.floor(createRng(dm.round(lm.cell + left * 13))() * MAZE_RUN.thieves.length)]!, k.x, k.y + 18)
    notify(g, 'thief')
  }
}

const stepRings = (g: Game, run: MazeRun, dt: number) => {
  if (run.rings.length < 2) return
  for (const p of g.players) {
    if (!standing(g, p)) continue
    const here = run.rings.findIndex((r) => near(p.x, p.y, r.x, r.y, MAZE_RUN.touch))
    const locked = run.ringLock[p.slot]
    if (locked !== undefined && here !== locked) delete run.ringLock[p.slot]
    if (here < 0 || locked === here) {
      run.ringTime[p.slot] = 0
      continue
    }
    run.ringTime[p.slot] = (run.ringTime[p.slot] ?? 0) + dt
    if (run.ringTime[p.slot]! < MAZE_RUN.ringTime) continue
    const to = run.rings[1 - here]!
    burst(g, p.x, p.y - 6, { colors: ['#c898f8', '#ffffff', '#f8d070'], count: 16, speed: 70, ttl: 0.5 })
    p.x = to.x
    p.y = to.y + 10
    run.ringLock[p.slot] = 1 - here
    run.ringTime[p.slot] = 0
    centerScreen(g, p, p.x, p.y)
    burst(g, p.x, p.y - 6, { colors: ['#c898f8', '#ffffff', '#f8d070'], count: 16, speed: 70, ttl: 0.5 })
    notify(g, 'ring')
  }
}

const stepHidden = (g: Game, run: MazeRun) => {
  for (const h of run.hidden) {
    if (h.fired || !someone(g, h.x, h.y, MAZE_RUN.ambushRadius)) continue
    h.fired = true
    spawnEnemy(g, h.kind, h.x, h.y)
    burst(g, h.x, h.y - 6, { colors: ['#58a838', '#a8e068', '#2c5818', '#ffffff'], count: 18, speed: 90, ttl: 0.5, gravity: 30 })
    notify(g, 'ambush')
  }
}

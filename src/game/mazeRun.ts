import { coopLocked } from '../data/coop'
import { DROP_TABLES, rollDrop } from '../data/consumables'
import type { EnemyId } from '../data/enemies'
import { MAZE_CAST, MAZE_RUN } from '../data/mazeEvents'
import { createRng, weightedPick } from '../engine/rng'
import { dropItem } from './consumables'
import { burst, floatText } from './effects'
import { spawnEnemy } from './enemies'
import { spawnAlpha } from './alphas'
import { cellCenter, mazeSiteAtPoint, mazeSitesNear, type MazeSite } from './grandMaze'
import type { spawnMapEvent as SpawnMapEvent } from './mapEvents'
import { COIN_VALUES } from './meta'
import { awardEgg, dropCoins } from './pickups'
import { centerScreen, standing } from './players'
import { roomOf } from './room'
import { deadEnds, openings } from './procgen/maze'
import type { Game } from './types'
import * as dm from '../engine/dmath'

/**
 * What happens inside the big hedge maze (`grandMaze.ts`, numbers and casts in `data/mazeEvents.ts`). The first time a player comes
 * near one, its run is built from the maze's own seed (so a replay builds the same): the chambers and dead ends are drawn into small
 * chests (some of them decoys, the heart's one looks no different), keys that lock the heart's chest, rings that carry a player to
 * another, traps that only show themselves when someone comes close, and Pokémon hiding in the corridors that spring out when one
 * does. The chest at the heart wakes a guardian the moment it opens. The horde stays out (`evict`): the Pokémon in here are the maze's
 * (`Enemy.home`). Scenery only in co-op (`COOP_LOCKS`), like the other landmarks.
 */

export type MazeMoment = 'spot' | 'key' | 'locked' | 'cache' | 'decoy' | 'ambush' | 'guard' | 'ring' | 'thief' | 'heart' | 'trap' | 'enter'

/** A chest (the heart's too): a decoy one springs a surprise instead of paying. */
export type MazeCache = { x: number; y: number; open: boolean; t: number; decoy: EnemyId | null }
/** A trap nobody has come near yet is `hidden`; close by, it `shows` as the map event it is. */
export type MazeTrap = { x: number; y: number; kind: 'spikes' | 'bomb'; ev: number; fused: boolean; done: boolean }
export type MazeHidden = { x: number; y: number; kind: EnemyId; fired: boolean }
export type MazeKey = { x: number; y: number; taken: boolean }

export type MazeRun = {
  key: number
  heart: MazeCache
  caches: MazeCache[]
  traps: MazeTrap[]
  hidden: MazeHidden[]
  keys: MazeKey[]
  /** Rings in pairs: ring `i` carries to ring `i ^ 1`. */
  rings: Array<{ x: number; y: number }>
  ringTime: Record<number, number>
  ringLock: Record<number, number>
  /** When (`g.now`) the locked chest last said it waits for keys, so it doesn't repeat itself every frame. */
  hintAt: number
  /** The guardian's enemy id once the heart's chest is open (0 before). */
  guard: number
}

/** The mazes met this run, by site key. */
export const createMazeState = (): Map<number, MazeRun> => new Map()

const notify = (g: Game, moment: MazeMoment, n = 0, of = 0) => g.events.push({ kind: 'maze', moment, n, of })

/** The run of `site`, built on first use. */
const runOf = (g: Game, site: MazeSite): MazeRun => {
  const known = g.mazes.get(site.key)
  if (known) return known
  const m = site.maze
  const rng = createRng(site.seed + 17)
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }
  const cast = MAZE_CAST[g.biome.id]
  const inChamber = (c: number, r: number) => site.chambers.some((q) => c >= q.c && c < q.c + q.w && r >= q.r && r < q.r + q.h)
  const at = (c: number, r: number) => {
    const p = cellCenter(site, c, r)
    return { x: dm.round(p.x), y: dm.round(p.y) }
  }
  // Dead ends away from the ways in, the farthest first among a shuffle (keys go to the far ones).
  const ends = shuffle(deadEnds(m).filter((e) => !inChamber(e.c, e.r) && site.fromIn[e.r * m.cols + e.c]! >= 6))
  const far = [...ends].sort((a, b) => site.fromIn[b.r * m.cols + b.c]! - site.fromIn[a.r * m.cols + a.c]!)
  const used = new Set<string>()
  const take = (list: Array<{ c: number; r: number }>, n: number) => {
    const out: Array<{ c: number; r: number }> = []
    for (const e of list) {
      if (out.length >= n) break
      const k = `${e.c},${e.r}`
      if (used.has(k)) continue
      used.add(k)
      out.push(e)
    }
    return out.map((e) => at(e.c, e.r))
  }
  const lockedHeart = rng() < MAZE_RUN.lockOdds
  const keys = (lockedHeart ? take(far.slice(0, Math.max(MAZE_RUN.keys * 3, 9)), MAZE_RUN.keys) : []).map((p): MazeKey => ({ ...p, taken: false }))
  const ringSpots = take(ends, MAZE_RUN.ringPairs * 2)
  const guess = cast.hide[0] as EnemyId
  const decoyKind = (): EnemyId => (rng() < 0.5 ? 'voltorb' : guess)
  const cache = (p: { x: number; y: number }, forceReal = false): MazeCache => ({ ...p, open: false, t: 0, decoy: !forceReal && rng() < MAZE_RUN.decoyOdds ? decoyKind() : null })
  const heartAt = site.chambers[site.heart]!
  const heart: MazeCache = { ...at(heartAt.c + (heartAt.w >> 1), heartAt.r + (heartAt.h >> 1)), open: false, t: 0, decoy: null }
  // One chest in the middle of every other chamber, and the dead ends' ones.
  const chamberChests = site.chambers.filter((_, i) => i !== site.heart).map((q) => cache(at(q.c + (q.w >> 1), q.r + (q.h >> 1))))
  const caches = [...chamberChests, ...take(ends, MAZE_RUN.caches).map((p) => cache(p))]
  const traps = take(ends, ends.length).map((p, i): MazeTrap => ({ ...p, kind: i % 2 === 0 ? 'spikes' : 'bomb', ev: -1, fused: false, done: false })).filter((_, i) => i % 3 !== 2)
  // Hidden in corridors (cells with two ways), out of chambers and well in from the ways in.
  const corridors: Array<{ c: number; r: number }> = []
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (openings(m, c, r) === 2 && !inChamber(c, r) && site.fromIn[r * m.cols + c]! >= 5) corridors.push({ c, r })
  const count = Math.min(MAZE_RUN.hidden.max, MAZE_RUN.hidden.base + Math.floor(g.time / 60 / MAZE_RUN.hidden.perMinutes))
  const hidden = shuffle(corridors).slice(0, count).map((e): MazeHidden => ({ ...at(e.c, e.r), kind: cast.hide[Math.floor(rng() * cast.hide.length)]!, fired: false }))
  const run: MazeRun = {
    key: site.key,
    heart,
    caches,
    traps,
    hidden,
    keys,
    rings: ringSpots,
    ringTime: {},
    ringLock: {},
    hintAt: -1e9,
    guard: 0,
  }
  g.mazes.set(site.key, run)
  notify(g, 'spot')
  return run
}

/** Keys still to find for the heart's chest of the maze with `key`. */
export const keysLeft = (g: Game, key: number) => g.mazes.get(key)?.keys.filter((k) => !k.taken).length ?? 0

/** Whether the heart's chest of the maze with `key` waits for keys. */
export const mazeLocked = (g: Game, key: number) => keysLeft(g, key) > 0

/** The locked chest of the maze with `key` tells whoever stands at it how many keys are left, at most every few seconds. */
const hintLocked = (g: Game, run: MazeRun) => {
  if (g.now - run.hintAt < 3) return
  run.hintAt = g.now
  notify(g, 'locked', keysLeft(g, run.key), run.keys.length)
}

/** The guardian a maze wakes: the biome's, or (rarely) the forest's legendary. */
const guardian = (g: Game, site: MazeSite): EnemyId => {
  const rng = createRng(dm.round(site.seed + g.time))
  if (rng() < MAZE_RUN.rare.odds && MAZE_RUN.rare.biomes.includes(g.biome.id)) return MAZE_RUN.rare.guard
  return weightedPick(rng, MAZE_CAST[g.biome.id].guard.map((id) => [id, 1] as const))
}

const near = (x: number, y: number, px: number, py: number, r: number) => dm.sq(x - px) + dm.sq(y - py) < r * r

/** A player in play within `r` px of (x, y), or null. */
const someone = (g: Game, x: number, y: number, r: number) => g.players.find((p) => standing(g, p) && near(p.x, p.y, x, y, r)) ?? null

/** Marks an enemy as the maze's own. */
const homed = (e: ReturnType<typeof spawnEnemy>, site: MazeSite) => {
  e.home = site.key
  return e
}

/** The heart's chest opens: its treasure, and the guardian steps out as an Alpha. */
const openHeart = (g: Game, site: MazeSite, run: MazeRun) => {
  const { x, y } = run.heart
  dropCoins(g, x, y - 4, Array.from({ length: MAZE_RUN.heartCoins + Math.floor(g.time / 300) }, () => COIN_VALUES[1]))
  for (let i = 0; i < MAZE_RUN.heartItems; i++) dropItem(g, x - 8 + i * 16, y - 4, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
  awardEgg(g, 'chest', x, y)
  burst(g, x, y - 8, { colors: ['#ffffff', '#f8e070', '#f8c040', '#a8e0ff'], count: 26, speed: 90, ttl: 0.6, gravity: 60 })
  notify(g, 'heart')
  run.guard = homed(spawnAlpha(g, guardian(g, site), x, y + 30), site).id
  burst(g, x, y + 12, { colors: ['#58a838', '#a8e068', '#2c5818'], count: 30, speed: 90, ttl: 0.7, gravity: 40 })
  notify(g, 'guard')
}

const cacheLoot = (g: Game, c: MazeCache) => {
  dropCoins(g, c.x, c.y - 4, Array.from({ length: MAZE_RUN.cacheCoins }, () => COIN_VALUES[1]))
  dropItem(g, c.x + 8, c.y - 2, rollDrop(DROP_TABLES.itemBall, g.time, g.rng))
  burst(g, c.x, c.y - 8, { colors: ['#ffffff', '#f8e070', '#f8c040', '#a8e0ff'], count: 18, speed: 80, ttl: 0.5, gravity: 60 })
  notify(g, 'cache')
}

/** What a decoy chest was: its Pokémon (or three of them) jumps out, the maze's own. */
const springDecoy = (g: Game, site: MazeSite, c: MazeCache) => {
  const kind = c.decoy!
  const n = kind === 'voltorb' ? 1 : 3
  for (let i = 0; i < n; i++) homed(spawnEnemy(g, kind, c.x + (i - (n - 1) / 2) * 14, c.y + 10), site)
  burst(g, c.x, c.y - 8, { colors: ['#e83030', '#f8e858', '#ffffff', '#484848'], count: 26, speed: 120, ttl: 0.5 })
  notify(g, 'decoy')
}

/** `spawn` is the map events' (`mapEvents.ts`), handed in so this module never imports it (it would close an import cycle). */
export const updateMazes = (g: Game, dt: number, spawn: typeof SpawnMapEvent) => {
  trackEntries(g)
  if (coopLocked(g, 'landmarks') || roomOf(g)) return
  const woke = new Set<number>()
  for (const p of g.players) {
    if (!standing(g, p)) continue
    for (const site of mazeSitesNear(g.terrain.seed, p.x, p.y, MAZE_RUN.wake)) {
      if (woke.has(site.key)) continue
      woke.add(site.key)
      const run = runOf(g, site)
      stepTraps(g, run, spawn)
      stepChests(g, site, run, dt)
      stepKeys(g, site, run)
      stepRings(g, run, dt)
      stepHidden(g, site, run)
    }
  }
}

/** Who stands in a maze (`Player.landmark.maze`), also in co-op: crossing its hedge's gap tells that player (`slot` in the event's `n`). */
const trackEntries = (g: Game) => {
  const outdoors = !g.place.inside && !g.rift.arena && !roomOf(g)
  for (const p of g.players) {
    const key = outdoors && !p.gone ? (mazeSiteAtPoint(g.terrain.seed, p.x, p.y)?.key ?? -1) : -1
    if (key === p.landmark.maze) continue
    p.landmark.maze = key
    if (key >= 0) notify(g, 'enter', p.slot)
  }
}

/** Shows a trap as the map event it is once someone comes close, and keeps it up; a bomb that went off is retired. */
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
    if (!someone(g, t.x, t.y, MAZE_RUN.trapReveal)) continue
    const placed = spawn(g, t.kind, t.x, t.y)
    placed.ttl = Infinity
    t.ev = placed.id
    notify(g, 'trap')
  }
}

const stepChests = (g: Game, site: MazeSite, run: MazeRun, dt: number) => {
  const all = [run.heart, ...run.caches]
  for (const c of all) {
    if (c.open) continue
    const who = someone(g, c.x, c.y, MAZE_RUN.touch + 6)
    // The heart waits for its keys: it only tells whoever stands there.
    if (c === run.heart && who && mazeLocked(g, run.key)) {
      hintLocked(g, run)
      continue
    }
    c.t = who ? c.t + dt : Math.max(0, c.t - dt * 2)
    if (c.t < MAZE_RUN.openTime) continue
    c.open = true
    if (c === run.heart) openHeart(g, site, run)
    else if (c.decoy) springDecoy(g, site, c)
    else cacheLoot(g, c)
  }
}

const stepKeys = (g: Game, site: MazeSite, run: MazeRun) => {
  for (const k of run.keys) {
    if (k.taken || !someone(g, k.x, k.y, MAZE_RUN.touch)) continue
    k.taken = true
    const left = run.keys.filter((x) => !x.taken).length
    burst(g, k.x, k.y - 8, { colors: ['#f8e070', '#ffffff', '#a8e0ff'], count: 14, speed: 70, ttl: 0.5, gravity: 40 })
    floatText(g, k.x, k.y - 22, left > 0 ? `${run.keys.length - left}/${run.keys.length}` : '✔', '#f8e070')
    notify(g, 'key', run.keys.length - left, run.keys.length)
    // A thief was after it: it comes for whoever took the key.
    homed(spawnEnemy(g, MAZE_RUN.thieves[Math.floor(createRng(dm.round(site.seed + left * 13))() * MAZE_RUN.thieves.length)]!, k.x, k.y + 18), site)
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
    const to = run.rings[here ^ 1]
    if (!to) continue
    burst(g, p.x, p.y - 6, { colors: ['#c898f8', '#ffffff', '#f8d070'], count: 16, speed: 70, ttl: 0.5 })
    p.x = to.x
    p.y = to.y + 10
    run.ringLock[p.slot] = here ^ 1
    run.ringTime[p.slot] = 0
    centerScreen(g, p, p.x, p.y)
    burst(g, p.x, p.y - 6, { colors: ['#c898f8', '#ffffff', '#f8d070'], count: 16, speed: 70, ttl: 0.5 })
    notify(g, 'ring')
  }
}

const stepHidden = (g: Game, site: MazeSite, run: MazeRun) => {
  for (const h of run.hidden) {
    if (h.fired || !someone(g, h.x, h.y, MAZE_RUN.ambushRadius)) continue
    h.fired = true
    homed(spawnEnemy(g, h.kind, h.x, h.y), site)
    burst(g, h.x, h.y - 6, { colors: ['#58a838', '#a8e068', '#2c5818', '#ffffff'], count: 18, speed: 90, ttl: 0.5, gravity: 30 })
    notify(g, 'ambush')
  }
}

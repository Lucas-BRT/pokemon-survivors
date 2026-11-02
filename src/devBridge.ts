import { METRICS, stats } from './game/debugMetrics'
import { DEBUG_RUN, DEBUG_STATS, DEBUG_TUNE } from './game/debugTune'
import type { Game } from './game/types'
import { lit } from './render/caveSight'
import { DEBUG_VIEW } from './render/debugOverlay'
import { MAZE_DEBUG } from './data/mazeEvents'
import { sampleMemory } from './telemetry'
import { dataApi } from './ui/debugData'

/**
 * Dev-only bridge to the MCP server (`scripts/mcp/game-mcp.mjs`): lets an AI agent read and change the running game without
 * restarting it. The page listens on the server's event stream for commands, does them and posts the answers. It only runs in
 * dev builds (`main.ts` imports it behind `import.meta.env.DEV`) and only talks to 127.0.0.1; without the server it quietly
 * retries now and then.
 */

type Tools = Record<string, (...args: unknown[]) => unknown>

type Hooks = { game: () => Game | undefined; run: () => unknown }

const PORT = import.meta.env.VITE_MCP_PORT ?? '8799'
const BASE = `http://127.0.0.1:${PORT}`

/** The debug objects the agent can reach from `game_eval` as `dbg`. */
const dbg = { DEBUG_TUNE, DEBUG_RUN, DEBUG_STATS, DEBUG_VIEW, MAZE_DEBUG, lit, METRICS }

const errors: string[] = []
const keepError = (kind: string, text: string) => {
  errors.push(`[${new Date().toISOString().slice(11, 19)}] ${kind}: ${text}`.slice(0, 600))
  if (errors.length > 60) errors.shift()
}

/** Turns anything into JSON the agent can read: maps, sets and typed arrays summarized, cycles and size cut. */
const plain = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return Number.isFinite(value as number) || typeof value !== 'number' ? value : String(value)
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…(${value.length})` : value
  if (typeof value === 'undefined') return '(undefined)'
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value)
  const obj = value as object
  if (seen.has(obj)) return '[cycle]'
  if (depth >= 5) return Array.isArray(obj) ? `[array ${obj.length}]` : '[object]'
  seen.add(obj)
  if (obj instanceof Map) return { Map: [...obj.entries()].slice(0, 30).map(([k, v]) => [plain(k, depth + 1, seen), plain(v, depth + 1, seen)]), size: obj.size }
  if (obj instanceof Set) return { Set: [...obj].slice(0, 30).map((v) => plain(v, depth + 1, seen)), size: obj.size }
  if (ArrayBuffer.isView(obj)) return `[${obj.constructor.name} ${(obj as unknown as { length: number }).length}]`
  if (Array.isArray(obj)) {
    const out = obj.slice(0, 40).map((v) => plain(v, depth + 1, seen))
    return obj.length > 40 ? [...out, `…${obj.length - 40} more`] : out
  }
  if (obj instanceof HTMLElement) return `[${obj.tagName}]`
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj).slice(0, 60)) out[k] = plain((obj as Record<string, unknown>)[k], depth + 1, seen)
  return out
}

const cut = (value: unknown) => {
  const text = JSON.stringify(plain(value))
  return text !== undefined && text.length > 30000 ? `${text.slice(0, 30000)}…(cut, ${text.length} chars)` : value === undefined ? '(undefined)' : JSON.parse(text ?? 'null')
}

const psTools = (): Tools => ((window as unknown as { ps?: Tools }).ps ?? {}) as Tools

const status = (hooks: Hooks) => {
  const g = hooks.game()
  if (!g) return { connected: true, run: null, note: 'No run: the game is on a menu.' }
  const inside = g.place.inside
  return {
    connected: true,
    time: +g.time.toFixed(1),
    phase: g.phase,
    biome: g.biome.id,
    weather: g.weather.id,
    difficulty: g.difficulty,
    seed: g.terrain.seed,
    place: inside ? (inside.id === 'cave' ? { id: 'cave', level: inside.state.level, floor: inside.state.floor + 1, windLeft: Math.round(inside.left) } : { id: inside.id, left: Math.round(inside.left) }) : null,
    player: { hp: Math.round(g.player.hp), maxHp: Math.round(g.player.stats.maxHp), x: Math.round(g.player.x), y: Math.round(g.player.y), level: g.player.level },
    coins: g.coins,
    foes: g.enemies.length,
    mazesMet: g.mazes.size,
    tension: +g.tension.level.toFixed(2),
  }
}

const setPath = (root: unknown, path: string, value: unknown) => {
  const keys = path.split('.').filter(Boolean)
  const last = keys.pop()
  if (!last) throw new Error('Empty path')
  let node = root as Record<string, unknown>
  for (const k of keys) {
    const next = node[k]
    if (next === null || typeof next !== 'object') throw new Error(`No "${k}" in the path`)
    node = next as Record<string, unknown>
  }
  if (!(last in node)) throw new Error(`No "${last}" there (fields: ${Object.keys(node).slice(0, 20).join(', ')})`)
  node[last] = value
  return node[last]
}

const GROUPS = { tune: DEBUG_TUNE, run: DEBUG_RUN, stats: DEBUG_STATS, view: DEBUG_VIEW } as const

type Args = Record<string, unknown>

const commands = (hooks: Hooks): Record<string, (a: Args) => unknown | Promise<unknown>> => ({
  status: () => status(hooks),
  tools: () => ({ ps: Object.fromEntries(Object.entries(psTools()).filter(([, f]) => typeof f === 'function').map(([k, f]) => [k, f.length])), dbg: Object.keys(dbg) }),
  call: async (a) => {
    const fn = psTools()[String(a.name)]
    if (typeof fn !== 'function') throw new Error(`No ps.${String(a.name)}`)
    return cut(await fn(...((a.args as unknown[]) ?? [])))
  },
  eval: async (a) => {
    const code = String(a.code)
    const make = (body: string) => new Function('g', 'run', 'ps', 'dbg', `return (async () => { ${body} })()`) as (g: unknown, run: unknown, ps: unknown, dbg: unknown) => Promise<unknown>
    let fn: ReturnType<typeof make>
    try {
      fn = make(`return (${code}\n)`)
    } catch {
      fn = make(code)
    }
    return cut(await fn(hooks.game(), hooks.run(), psTools(), dbg))
  },
  set: (a) => {
    const g = hooks.game()
    if (!g) throw new Error('No run')
    return cut(setPath(g, String(a.path), a.value))
  },
  data: (a) => {
    switch (a.action) {
      case 'search':
        return dataApi.search(String(a.query ?? ''))
      case 'get':
        return dataApi.get(String(a.id)) ?? 'No such field'
      case 'set':
        return dataApi.set(String(a.id), a.value as number | boolean) ?? 'No such field, or the value is not the same kind as the field'
      case 'reset':
        return dataApi.reset(String(a.id)) ?? 'No such field'
      default:
        throw new Error('action: search | get | set | reset')
    }
  },
  tune: (a) => {
    const group = GROUPS[a.group as keyof typeof GROUPS] as Record<string, unknown> | undefined
    if (!group) throw new Error('group: tune | run | stats | view')
    if (a.key === undefined) return cut(group)
    group[String(a.key)] = a.value
    if (a.group === 'stats') {
      const g = hooks.game()
      if (g) void import('./game/leveling').then((m) => m.recomputeStats(g))
    }
    return cut(group)
  },
  screenshot: () => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null
    if (!canvas) throw new Error('No canvas')
    return { base64: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }
  },
  metrics: () => ({
    frame: stats(METRICS.frame),
    work: stats(METRICS.work),
    steps: stats(METRICS.step),
    draw: stats(METRICS.draw),
    ticksPerFrame: stats(METRICS.steps),
    worst: METRICS.worst,
    memory: sampleMemory(),
  }),
  errors: (a) => {
    const out = [...errors]
    if (a.clear) errors.length = 0
    return out.length > 0 ? out : 'No errors logged.'
  },
})

/** Connects to the MCP server's event stream (and again, when it drops) and answers its commands. */
export const startDevBridge = (hooks: Hooks) => {
  window.addEventListener('error', (e) => keepError('uncaught', `${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => keepError('unhandled rejection', String((e.reason as Error)?.message ?? e.reason)))
  for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console)
    console[kind] = (...args: unknown[]) => {
      keepError(`console.${kind}`, args.map((a) => (typeof a === 'string' ? a : (a as Error)?.message ?? JSON.stringify(plain(a)))).join(' '))
      original(...args)
    }
  }
  const table = commands(hooks)
  const connect = () => {
    const source = new EventSource(`${BASE}/events`)
    source.onmessage = async (event) => {
      const { id, cmd, args } = JSON.parse(event.data) as { id: string; cmd: string; args: Args }
      let body: { id: string; ok: boolean; value?: unknown; error?: string }
      try {
        const handler = table[cmd]
        if (!handler) throw new Error(`Unknown command ${cmd}`)
        body = { id, ok: true, value: await handler(args ?? {}) }
      } catch (e) {
        body = { id, ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      // text/plain keeps the request simple (no preflight).
      void fetch(`${BASE}/result`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) }).catch(() => {})
    }
    // Without the server the browser keeps retrying on its own; a closed stream (the server went away for good) is retried here.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setTimeout(connect, 5000)
    }
  }
  connect()
}

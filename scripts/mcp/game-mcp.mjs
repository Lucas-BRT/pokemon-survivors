#!/usr/bin/env node
/**
 * A basic MCP server (stdio) that lets an AI agent change the running game without restarting it.
 *
 * Two halves in one process:
 *  - the MCP side talks JSON-RPC over stdio to the agent (Claude Code starts it from `.mcp.json`);
 *  - the bridge side is a tiny HTTP server on 127.0.0.1 that the dev page (`src/devBridge.ts`, dev builds only) connects to: it
 *    listens on `GET /events` (server-sent events) for commands and answers with `POST /result`.
 *
 * No dependencies. Only pages served from localhost may talk to the bridge (Origin and Host are checked), so a website you
 * visit can't drive your game or feed the agent made-up answers. Logs go to stderr: stdout is the protocol's.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.GAME_MCP_PORT ?? 8799)
const TIMEOUT_MS = 15000

const log = (...a) => console.error('[game-mcp]', ...a)

/* ---------------- Bridge: the dev page ---------------- */

/** The page that listens for commands right now (the newest one). */
let page = null
/** Commands sent and not answered yet, by id. */
const pending = new Map()

const localHost = (value) => {
  try {
    const { hostname } = new URL(value.includes('://') ? value : `http://${value}`)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

const bridge = http.createServer((req, res) => {
  const origin = req.headers.origin
  const hostOk = localHost(req.headers.host ?? '')
  // A page on another site, or a request whose Host isn't localhost (DNS rebinding), gets nothing.
  if (!hostOk || (origin !== undefined && !localHost(origin))) {
    res.writeHead(403).end()
    return
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/ping') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('game-mcp')
  // Pages must say who they are: curl and other tools without an Origin can't be the game.
  if (origin === undefined) return void res.writeHead(403).end()
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': hello\n\n')
    const previous = page
    page = { res, origin, since: Date.now() }
    previous?.res.end()
    log('page connected from', origin)
    const beat = setInterval(() => res.write(': beat\n\n'), 15000)
    req.on('close', () => {
      clearInterval(beat)
      if (page?.res === res) page = null
      log('page disconnected')
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/result') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 20_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const msg = JSON.parse(body)
        const waiter = pending.get(msg.id)
        if (waiter) {
          pending.delete(msg.id)
          waiter(msg)
        }
        res.writeHead(204).end()
      } catch {
        res.writeHead(400).end()
      }
    })
    return
  }
  res.writeHead(404).end()
})

bridge.on('error', (e) => log(`bridge could not listen on ${PORT}: ${e.message} (another game-mcp running?)`))
bridge.listen(PORT, '127.0.0.1', () => log(`bridge on http://127.0.0.1:${PORT}, waiting for the dev page`))

/** Sends a command to the page and waits for its answer: `{ ok, value }` or `{ ok: false, error }`. */
const ask = (cmd, args = {}) =>
  new Promise((resolve) => {
    if (!page) return resolve({ ok: false, error: 'The game page is not connected. Run `npm run dev`, open the game in a browser (dev build), and try again.' })
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: `The page did not answer within ${TIMEOUT_MS / 1000}s (is the tab in the background, or the game stuck?).` })
    }, TIMEOUT_MS)
    pending.set(id, (msg) => {
      clearTimeout(timer)
      resolve(msg)
    })
    page.res.write(`data: ${JSON.stringify({ id, cmd, args })}\n\n`)
  })

/* ---------------- MCP: the agent ---------------- */

const str = { type: 'string' }
const TOOLS = [
  {
    name: 'game_status',
    description: 'Whether the dev page is connected, and a summary of the running game: run time, biome, weather, difficulty, place (cave level, floor), player HP and position, foes alive, seed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'game_tools',
    description: 'Lists the dev console tools (`ps.*`) the page has, with their parameter counts, and the debug objects `dbg` (DEBUG_TUNE, DEBUG_RUN, DEBUG_STATS, DEBUG_VIEW, MAZE_DEBUG, lit, METRICS).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'game_call',
    description: 'Calls a dev console tool: `ps.<name>(...args)` (e.g. name "spawn", args ["geodude", 5]; "place" with ["cave", 4]; "boss" ["entei"]; "maze"; "money" [20000]; "learn" ["solarBeam", 5]). Returns what it returns. Use game_tools to see the names.',
    inputSchema: { type: 'object', properties: { name: str, args: { type: 'array', items: {}, description: 'Arguments, as JSON values.' } }, required: ['name'] },
  },
  {
    name: 'game_eval',
    description:
      'Runs JavaScript in the page with `g` (the running Game state), `run`, `ps` (dev tools) and `dbg` (debug objects) in scope; an expression is returned, or use statements with `return`. Example: `g.player.hp = 1; return g.player.hp`. The result is serialized (maps, sets, cycles and size are handled and cut).',
    inputSchema: { type: 'object', properties: { code: str }, required: ['code'] },
  },
  {
    name: 'game_set',
    description: 'Sets a value in the game state by path, e.g. path "player.hp" value 5, or "coins" 9999, or "player.stats.speed". For anything bigger use game_eval.',
    inputSchema: { type: 'object', properties: { path: str, value: {} }, required: ['path', 'value'] },
  },
  {
    name: 'game_data',
    description:
      'Reads or edits the game data tables the Data tab of the debug menu shows (CAVE, CAVE_GEN, CAVE_LEVELS, GRAND, MAZE_RUN, ELITE, TERRAIN…). action "search" (query words, matches ids like "CAVE_GEN.packMax"), "get" (id), "set" (id, value) or "reset" (id). Every field comes with when a change takes effect (live, floor, maze, run, captured…).',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'get', 'set', 'reset'] }, query: str, id: str, value: {} }, required: ['action'] },
  },
  {
    name: 'game_tune',
    description: 'Sets a debug knob: group "tune" (world, cap, place, placeCap, maze, source: spawn rates and caps, 1 = normal), "run" (scale: simulation speed, 0 pauses; steps: ticks to play now), "stats" (player stat deltas, e.g. maxHp, speed, might) or "view" (overlay layers, true/false). Without key and value it lists the group.',
    inputSchema: { type: 'object', properties: { group: { type: 'string', enum: ['tune', 'run', 'stats', 'view'] }, key: str, value: {} }, required: ['group'] },
  },
  {
    name: 'game_screenshot',
    description: 'A PNG of the game canvas as it is drawn now (at the game’s internal resolution, plus any debug overlays that are on).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'game_metrics',
    description: 'Timings of the game loop (frame interval, frame work, simulation steps, drawing: average, p95, max), counts of what the run holds and the memory the sprites and canvases take.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'game_errors',
    description: 'The last errors and warnings the page logged (uncaught errors, console.error, console.warn), newest last. `clear` empties the list.',
    inputSchema: { type: 'object', properties: { clear: { type: 'boolean' } } },
  },
]

const COMMAND = { game_status: 'status', game_tools: 'tools', game_call: 'call', game_eval: 'eval', game_set: 'set', game_data: 'data', game_tune: 'tune', game_screenshot: 'screenshot', game_metrics: 'metrics', game_errors: 'errors' }

const callTool = async (name, args) => {
  const cmd = COMMAND[name]
  if (!cmd) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] }
  const answer = await ask(cmd, args ?? {})
  if (!answer.ok) return { isError: true, content: [{ type: 'text', text: String(answer.error) }] }
  if (cmd === 'screenshot') return { content: [{ type: 'image', data: answer.value.base64, mimeType: 'image/png' }, { type: 'text', text: `${answer.value.width}×${answer.value.height}` }] }
  const text = typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value, null, 2)
  return { content: [{ type: 'text', text: text ?? 'undefined' }] }
}

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)

const handle = async (msg) => {
  const { id, method, params } = msg
  if (id === undefined) return // notifications ("initialized", "cancelled"…) need no answer
  switch (method) {
    case 'initialize':
      return reply(id, { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'pokemon-survivors-game', version: '0.1.0' } })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call':
      return reply(id, await callTool(params?.name, params?.arguments))
    default:
      return fail(id, -32601, `Method not found: ${method}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    try {
      void handle(JSON.parse(line)).catch((e) => log('handler failed:', e))
    } catch (e) {
      log('bad message:', e.message)
    }
  }
})
process.stdin.on('end', () => process.exit(0))

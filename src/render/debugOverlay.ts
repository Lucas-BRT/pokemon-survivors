import { CAVE_SHOP } from '../data/caveShop'
import { CAVE_TRAP } from '../data/caveLevels'
import { GRAND, MAZE_RUN, mazeTheme } from '../data/mazeEvents'
import { CAVE } from '../data/places'
import { TERRAIN } from '../data/terrain'
import { caveLight } from '../game/cave'
import { roomAt } from '../game/dungeon'
import { mazeSiteAtPoint, mazeSitesNear, type MazeSite } from '../game/grandMaze'
import { nearestPlayer } from '../game/players'
import { distances } from '../game/procgen/maze'
import { featuresNear } from '../game/terrain'
import type { Game } from '../game/types'
import { roomLevels } from './caveSight'
import { seenCells } from './mazeSight'

/**
 * Dev-only overlays the debug menu turns on (`ui/debugMenu.ts`, tab View): what the simulation sees and collides with, drawn over the
 * world in screen px. They come in groups (`VIEW_GROUPS`): bodies, spawns, the cave, the hedge maze, the world and performance. Nothing
 * turns them on in a production build.
 */

const OFF = {
  hitboxes: false,
  labels: false,
  targets: false,
  playerRings: false,
  pickups: false,
  spawnRing: false,
  darkSpawn: false,
  mazeSpawn: false,
  rooms: false,
  levels: false,
  caveRadii: false,
  caveSight: false,
  maze: false,
  wings: false,
  mazeRadii: false,
  mazeContents: false,
  collision: false,
  terrainGrid: false,
  events: false,
  grid: false,
  counters: false,
  fps: false,
}

export type ViewFlag = keyof typeof OFF

export const DEBUG_VIEW: Record<ViewFlag, boolean> = { ...OFF }

/** Turns every layer off, or on for just `only`. */
export const setView = (only: readonly ViewFlag[] = []) => {
  Object.assign(DEBUG_VIEW, OFF)
  for (const k of only) DEBUG_VIEW[k] = true
}

/** The layers by group, for the menu. */
export const VIEW_GROUPS: ReadonlyArray<{ group: string; items: ReadonlyArray<{ key: ViewFlag; label: string }> }> = [
  {
    group: 'Bodies',
    items: [
      { key: 'hitboxes', label: 'Hitboxes (foes, players, moves, hazards)' },
      { key: 'labels', label: 'Foe labels (kind, HP, alert, maze/boss/elite)' },
      { key: 'targets', label: 'Lines from each foe to the player it chases' },
      { key: 'playerRings', label: 'Player rings (body, magnet, light) and heading' },
      { key: 'pickups', label: 'Pickups and the magnet that pulls them' },
    ],
  },
  {
    group: 'Spawns',
    items: [
      { key: 'spawnRing', label: 'Overworld horde: the ring foes appear on' },
      { key: 'darkSpawn', label: 'Cave: where the dark may spawn (outside the light, within reach)' },
      { key: 'mazeSpawn', label: 'Maze: dwellers keep this far from you' },
    ],
  },
  {
    group: 'Cave',
    items: [
      { key: 'rooms', label: 'Rooms and corridors (seen, ambush, sanctuary, traps)' },
      { key: 'levels', label: 'Light level of each room' },
      { key: 'caveRadii', label: 'Radii: stairs, chest, Cristalário, traps, crystals (timers)' },
      { key: 'caveSight', label: 'Foes’ sight and hearing rings' },
    ],
  },
  {
    group: 'Maze',
    items: [
      { key: 'maze', label: 'Cells (steps from you, seen cells, entrances, heart)' },
      { key: 'wings', label: 'Wings and courtyard (colored by kind)' },
      { key: 'mazeRadii', label: 'Radii: wake, your sight, chests, keys, rings, trap reveal' },
      { key: 'mazeContents', label: 'Hidden contents: traps, hidden Pokémon, keys, rings, chests' },
    ],
  },
  {
    group: 'World',
    items: [
      { key: 'collision', label: 'Terrain collision feet' },
      { key: 'terrainGrid', label: 'Terrain cells (288 px) with their coordinates' },
      { key: 'events', label: 'Map events, the place entrance and their radii' },
      { key: 'grid', label: 'World grid (every 100 px) and a cross on the player' },
    ],
  },
  {
    group: 'Performance',
    items: [
      { key: 'counters', label: 'Counters (foes, moves, pickups, clock, seed)' },
      { key: 'fps', label: 'Frame time graph' },
    ],
  },
]

type Ctx = CanvasRenderingContext2D

const label = (ctx: Ctx, text: string, x: number, y: number, color = '#ffffff') => {
  ctx.font = '7px monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#000000'
  ctx.fillText(text, Math.round(x) + 1, Math.round(y) + 1)
  ctx.fillStyle = color
  ctx.fillText(text, Math.round(x), Math.round(y))
}

const ring = (ctx: Ctx, x: number, y: number, r: number, color: string, dash = false) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash(dash ? [3, 3] : [])
  ctx.beginPath()
  ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, r), 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}

const ellipse = (ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2)
  ctx.stroke()
}

const line = (ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5)
  ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5)
  ctx.stroke()
}

const frameRect = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
}

/** What is on screen, in world px, with a margin. */
const inView = (g: Game, cx: number, cy: number, x: number, y: number, m = 40) => x > cx - m && x < cx + g.view.w + m && y > cy - m && y < cy + g.view.h + m

/* ---------------- Bodies ---------------- */

const hitboxes = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  for (const e of g.enemies) ring(ctx, e.x - cx, e.y - cy, e.radius, e.boss ? '#ff4040' : e.home !== undefined ? '#40ff80' : '#ffb030')
  for (const p of g.players) ring(ctx, p.x - cx, p.y - cy, p.radius, '#40c0ff')
  for (const a of g.attacks) {
    if (a.age < a.activeFrom || a.age > a.activeUntil) continue
    if (a.shape.kind === 'circle') ring(ctx, a.x - cx, a.y - cy, a.shape.r, '#ffff60')
    else frameRect(ctx, a.x - cx - a.shape.w / 2, a.y - cy - a.shape.h / 2, a.shape.w, a.shape.h, '#ffff60')
  }
  for (const h of g.hazards) ring(ctx, h.x - cx, h.y - cy, h.r, h.age < h.armAt ? '#ff9090' : '#ff2020')
}

const foeLabels = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  let n = 0
  for (const e of g.enemies) {
    if (n >= 60 || !inView(g, cx, cy, e.x, e.y, 10)) continue
    n++
    const tags = [e.boss ? 'boss' : '', e.elite ? 'elite' : '', e.shiny ? 'shiny' : '', e.home !== undefined ? 'maze' : '', e.alert > 0 ? `alert ${e.alert.toFixed(0)}` : '', e.dying >= 0 ? 'dying' : ''].filter(Boolean).join(' ')
    label(ctx, `${e.kind} ${Math.round(e.hp)}/${Math.round(e.maxHp)}`, e.x - cx, e.y - cy - e.radius - 9, e.boss ? '#ff8080' : '#ffe0a0')
    if (tags) label(ctx, tags, e.x - cx, e.y - cy - e.radius - 2, '#a0d0ff')
  }
}

const targets = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  let n = 0
  for (const e of g.enemies) {
    if (n >= 80 || e.behavior.kind !== 'chase' || !inView(g, cx, cy, e.x, e.y)) continue
    n++
    const p = nearestPlayer(g, e.x, e.y)
    line(ctx, e.x - cx, e.y - cy, p.x - cx, p.y - cy, 'rgba(255,120,120,0.35)')
  }
}

const playerRings = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  for (const p of g.players) {
    if (p.gone) continue
    ring(ctx, p.x - cx, p.y - cy, p.radius, '#40c0ff')
    ring(ctx, p.x - cx, p.y - cy, p.stats.magnet, '#60ff90', true)
    const inCave = g.place.inside?.id === 'cave'
    if (inCave) ring(ctx, p.x - cx, p.y - cy, caveLight(g), '#fff080', true)
    line(ctx, p.x - cx, p.y - cy, p.x - cx + p.facing.x * 26, p.y - cy + p.facing.y * 26, '#40c0ff')
    line(ctx, p.x - cx, p.y - cy, p.x - cx + p.vx * 0.25, p.y - cy + p.vy * 0.25, '#ff80ff')
    label(ctx, `p${p.slot} ${Math.round(p.hp)}/${Math.round(p.stats.maxHp)} v${Math.round(Math.hypot(p.vx, p.vy))}`, p.x - cx, p.y - cy - p.radius - 9, '#a0e0ff')
  }
}

const pickups = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const p = g.player
  let n = 0
  for (const k of g.pickups) {
    if (n >= 120 || !inView(g, cx, cy, k.x, k.y)) continue
    n++
    const near = Math.hypot(k.x - p.x, k.y - p.y) <= p.stats.magnet
    ring(ctx, k.x - cx, k.y - cy, 4, near ? '#60ff90' : '#c0c0c0')
    if (near) line(ctx, k.x - cx, k.y - cy, p.x - cx, p.y - cy, 'rgba(96,255,144,0.4)')
    label(ctx, k.kind, k.x - cx, k.y - cy - 6, near ? '#a0ffc0' : '#c0c0c0')
  }
}

/* ---------------- Spawns ---------------- */

const spawnRing = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const r = Math.hypot(g.view.w, g.view.h) / 2 + 12
  for (const p of g.players) ring(ctx, p.x - cx, p.y - cy, r, '#ff8040', true)
  label(ctx, `horde ring ${Math.round(r)}px · budget ${g.spawnBudget.toFixed(2)}`, g.player.x - cx, g.player.y - cy - r - 4, '#ff8040')
}

const darkSpawn = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const inside = g.place.inside
  if (inside?.id !== 'cave') return
  const p = g.player
  ring(ctx, p.x - cx, p.y - cy, 380, '#ff6060', true)
  ring(ctx, p.x - cx, p.y - cy, caveLight(g) + 24, '#fff080', true)
  label(ctx, 'dark spawns between the light and 380px, in seen rooms', p.x - cx, p.y - cy + 392, '#ff9090')
  const plan = inside.state.plan
  if (!plan) return
  plan.rooms.forEach((r, i) => {
    if (i === plan.sanctuary || !inside.state.visited.includes(i)) return
    ctx.fillStyle = 'rgba(255,80,80,0.08)'
    ctx.fillRect(inside.x + r.x - cx, inside.y + r.y - cy, r.w, r.h)
  })
}

const mazeSpawn = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  for (const p of g.players) {
    const site = mazeSiteAtPoint(g.terrain.seed, p.x, p.y)
    if (!site) continue
    ring(ctx, p.x - cx, p.y - cy, MAZE_RUN.live.away, '#ff6060', true)
    ring(ctx, p.x - cx, p.y - cy, GRAND.sight, '#60c0ff', true)
  }
  label(ctx, `dwellers spawn out of sight, ${MAZE_RUN.live.away}px away`, g.player.x - cx, g.player.y - cy - MAZE_RUN.live.away - 4, '#ff9090')
}

/* ---------------- Cave ---------------- */

const caveRooms = (ctx: Ctx, g: Game, cx: number, cy: number, levels: boolean, rooms: boolean) => {
  const inside = g.place.inside
  if (inside?.id !== 'cave' || !inside.state.plan) return
  const s = inside.state
  const plan = s.plan!
  const lv = levels ? roomLevels(plan, s.touched.map((c) => c.i)) : null
  const here = new Set(g.players.map((p) => roomAt(plan, p.x - inside.x, p.y - inside.y)))
  plan.rooms.forEach((r, i) => {
    const x = inside.x + r.x - cx
    const y = inside.y + r.y - cy
    if (rooms) {
      const color = s.ambush.includes(i) ? (s.sprung.includes(i) ? '#a04040' : '#ff4040') : i === plan.sanctuary ? '#c080ff' : s.visited.includes(i) ? '#40ff80' : '#808080'
      frameRect(ctx, x, y, r.w, r.h, here.has(i) ? '#ffffff' : color)
      label(ctx, `#${i} ${plan.sizes[i]}c`, x + r.w / 2, y + 9, color)
    }
    if (lv) label(ctx, `L ${lv[i]!.toFixed(2)}`, x + r.w / 2, y + r.h / 2, '#ffe070')
  })
  if (!rooms) return
  for (const l of plan.links) for (const q of l.rects) frameRect(ctx, inside.x + q.x - cx, inside.y + q.y - cy, q.w, q.h, '#4060a0')
  for (const t of s.traps) ring(ctx, inside.x + t.x - cx, inside.y + t.y - cy, CAVE_TRAP.trigger, t.done ? '#604040' : '#ff8030')
  label(ctx, `start #${plan.startRoom}`, inside.x + plan.start[0] - cx, inside.y + plan.start[1] - cy, '#80c0ff')
}

const caveRadii = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const inside = g.place.inside
  if (inside?.id !== 'cave') return
  const s = inside.state
  const at = (p: readonly [number, number]) => [inside.x + p[0] - cx, inside.y + p[1] - cy] as const
  if (s.stairs) {
    const [x, y] = at(s.stairs)
    ring(ctx, x, y, CAVE.stairsRadius, '#80ff80')
    label(ctx, 'stairs', x, y - CAVE.stairsRadius - 3, '#80ff80')
  }
  if (s.chest) {
    const [x, y] = at([s.chest.x, s.chest.y])
    ring(ctx, x, y, CAVE.chestRadius, '#ffd060')
    label(ctx, `chest ${Math.round(s.chest.progress * 100)}%`, x, y - CAVE.chestRadius - 3, '#ffd060')
  }
  if (s.shop) {
    const [x, y] = at([s.shop.x, s.shop.y])
    ring(ctx, x, y, CAVE_SHOP.radius, '#c080ff')
    label(ctx, `shop ${s.shop.npc} ${s.shop.stand.toFixed(1)}/${CAVE_SHOP.stand}s`, x, y - CAVE_SHOP.radius - 3, '#c080ff')
  }
  s.lights.forEach(([lx, ly], i) => {
    const [x, y] = at([lx, ly])
    if (!inView(g, cx, cy, x + cx, y + cy)) return
    const on = s.touched.find((c) => c.i === i)
    ellipse(ctx, x, y, CAVE.crystal.rx, CAVE.crystal.ry, on ? '#80e0ff' : '#406080')
    if (on) label(ctx, `${on.left.toFixed(0)}s`, x, y - CAVE.crystal.ry - 3, '#80e0ff')
  })
}

const caveSight = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  if (g.place.inside?.id !== 'cave') return
  let n = 0
  for (const e of g.enemies) {
    if (n >= 30 || !inView(g, cx, cy, e.x, e.y)) continue
    n++
    ring(ctx, e.x - cx, e.y - cy, CAVE.sight.range, e.alert > 0 ? '#ff6060' : '#605050', true)
    ring(ctx, e.x - cx, e.y - cy, CAVE.sight.hear, '#a0a0ff')
  }
}

/* ---------------- Maze ---------------- */

const WING_COLORS = { avenues: '80,200,255', thicket: '255,160,60', halls: '200,120,255', garden: '120,255,120' } as const

const drawMaze = (ctx: Ctx, g: Game, site: MazeSite, cx: number, cy: number) => {
  const m = site.maze
  const P = GRAND.cell
  const { w, h } = g.view
  const known = seenCells(site)
  const mine = mazeSiteAtPoint(g.terrain.seed, g.player.x, g.player.y) === site
  const from = mine ? { c: Math.floor((g.player.x - site.x) / P), r: Math.floor((g.player.y - site.y) / P) } : null
  const dist = from ? distances(m, Math.max(0, Math.min(m.cols - 1, from.c)), Math.max(0, Math.min(m.rows - 1, from.r))).dist : null
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const x = site.x + c * P - cx
      const y = site.y + r * P - cy
      if (x > w || y > h || x + P < 0 || y + P < 0) continue
      const i = r * m.cols + c
      if (known[i]) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(x, y, P, P)
      }
      frameRect(ctx, x, y, P, P, 'rgba(120,200,255,0.25)')
      if (dist && dist[i]! >= 0) label(ctx, String(dist[i]), x + P / 2, y + P / 2 + 2, '#a0e0ff')
      else if (site.fromIn[i]! < Infinity && !dist) label(ctx, String(site.fromIn[i]), x + P / 2, y + P / 2 + 2, '#80a0c0')
    }
  }
  for (const e of site.entrances) label(ctx, 'IN', site.x + (e.c + 0.5) * P - cx, site.y + (e.r + 0.5) * P - cy, '#ff8080')
  const heart = site.chambers[site.heart]!
  label(ctx, 'heart', site.x + (heart.c + heart.w / 2) * P - cx, site.y + (heart.r + heart.h / 2) * P - cy - 10, '#ffe070')
  label(ctx, `${mazeTheme(g.biome.id, site.seed).id} · ${site.wings.map((q) => q.kind).join('/')} · seed ${site.seed}`, site.x + site.side / 2 - cx, site.y - 8 - cy, '#ffffff')
}

const wings = (ctx: Ctx, site: MazeSite, cx: number, cy: number) => {
  const P = GRAND.cell
  for (const wg of site.wings) {
    const x = site.x + wg.c * P - cx
    const y = site.y + wg.r * P - cy
    ctx.fillStyle = `rgba(${WING_COLORS[wg.kind]},0.1)`
    ctx.fillRect(x, y, wg.w * P, wg.h * P)
    frameRect(ctx, x, y, wg.w * P, wg.h * P, `rgba(${WING_COLORS[wg.kind]},0.8)`)
    label(ctx, wg.kind, x + (wg.w * P) / 2, y + (wg.h * P) / 2, `rgb(${WING_COLORS[wg.kind]})`)
  }
  for (const ch of site.chambers) frameRect(ctx, site.x + ch.c * P - cx, site.y + ch.r * P - cy, ch.w * P, ch.h * P, '#ffffff')
}

const mazeRadii = (ctx: Ctx, g: Game, site: MazeSite, cx: number, cy: number) => {
  ring(ctx, site.x + site.side / 2 - cx, site.y + site.side / 2 - cy, site.side / 2 + MAZE_RUN.wake, 'rgba(255,255,255,0.15)', true)
  for (const p of g.players) ring(ctx, p.x - cx, p.y - cy, GRAND.sight, '#60c0ff', true)
  const run = g.mazes.get(site.key)
  if (!run) return
  for (const c of [run.heart, ...run.caches]) ring(ctx, c.x - cx, c.y - cy, MAZE_RUN.chestRadius, c.open ? '#605040' : '#ffd060')
  for (const k of run.keys) if (!k.taken) ring(ctx, k.x - cx, k.y - cy, MAZE_RUN.touch, '#ffe070')
  for (const r of run.rings) ring(ctx, r.x - cx, r.y - cy, MAZE_RUN.touch, '#c898f8')
  for (const t of run.traps) if (!t.done) ring(ctx, t.x - cx, t.y - cy, MAZE_RUN.trapReveal, '#ff8030', true)
  for (const hd of run.hidden) if (!hd.fired) ring(ctx, hd.x - cx, hd.y - cy, MAZE_RUN.ambushRadius, '#80ff80', true)
}

const mazeContents = (ctx: Ctx, g: Game, site: MazeSite, cx: number, cy: number) => {
  const run = g.mazes.get(site.key)
  if (!run) return
  const mark = (x: number, y: number, text: string, color: string) => {
    ring(ctx, x - cx, y - cy, 5, color)
    label(ctx, text, x - cx, y - cy - 8, color)
  }
  mark(run.heart.x, run.heart.y, run.heart.open ? 'heart (open)' : `heart${run.keys.some((k) => !k.taken) ? ' (locked)' : ''}`, '#ffe070')
  for (const c of run.caches) mark(c.x, c.y, c.open ? 'chest (open)' : c.decoy ? `DECOY ${c.decoy}` : 'chest', c.decoy && !c.open ? '#ff6060' : '#ffd060')
  for (const k of run.keys) if (!k.taken) mark(k.x, k.y, 'key', '#ffe070')
  run.rings.forEach((r, i) => mark(r.x, r.y, `ring ${i}→${i ^ 1}`, '#c898f8'))
  for (const t of run.traps) if (!t.done) mark(t.x, t.y, t.kind, '#ff8030')
  for (const hd of run.hidden) if (!hd.fired) mark(hd.x, hd.y, hd.kind, '#80ff80')
}

/* ---------------- World ---------------- */

const collision = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const { w, h } = g.view
  for (const f of featuresNear(g, cx + w / 2, cy + h / 2, w / 2 + 60, h / 2 + 60)) {
    for (const s of f.solids) for (const e of s.foot) ellipse(ctx, e.x - cx, e.y - cy, e.rx, e.ry, s.kind === 'mazeWall' ? 'rgba(80,200,120,0.5)' : '#ff60c0')
    if (f.lake) for (const e of f.lake.foot) ellipse(ctx, e.x - cx, e.y - cy, e.rx, e.ry, '#4080ff')
  }
}

const terrainGrid = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const C = TERRAIN.cell
  const { w, h } = g.view
  for (let gx = Math.floor(cx / C) * C; gx < cx + w; gx += C) line(ctx, gx - cx, 0, gx - cx, h, 'rgba(255,255,255,0.18)')
  for (let gy = Math.floor(cy / C) * C; gy < cy + h; gy += C) line(ctx, 0, gy - cy, w, gy - cy, 'rgba(255,255,255,0.18)')
  for (let gx = Math.floor(cx / C) * C; gx < cx + w; gx += C) {
    for (let gy = Math.floor(cy / C) * C; gy < cy + h; gy += C) {
      const ix = Math.floor(gx / C)
      const iy = Math.floor(gy / C)
      const hit = g.terrain.cells.get(((ix & 0x7fff) << 15) | (iy & 0x7fff))
      label(ctx, `${ix},${iy}${hit ? ' #' : ''}`, gx - cx + C / 2, gy - cy + 10, 'rgba(255,255,255,0.5)')
    }
  }
}

const events = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  for (const ev of g.mapEvents.list) {
    if (ev.gone >= 0) continue
    ring(ctx, ev.x - cx, ev.y - cy, 18, '#ffa0ff', true)
    label(ctx, ev.kind, ev.x - cx, ev.y - cy - 20, '#ffa0ff')
  }
  const door = g.place.entrance
  if (door) {
    ring(ctx, door.x - cx, door.y - cy, 12, door.open ? '#80ff80' : '#808080')
    label(ctx, `${door.id}${door.id === 'cave' ? ` Lv${door.level}` : ''} ${door.open ? Math.ceil(door.left) + 's' : 'closed'}`, door.x - cx, door.y - cy - 16, '#80ff80')
  }
}

const grid = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const { w, h } = g.view
  const S = 100
  for (let gx = Math.ceil(cx / S) * S; gx < cx + w; gx += S) {
    line(ctx, gx - cx, 0, gx - cx, h, 'rgba(255,255,255,0.08)')
    label(ctx, String(gx), gx - cx, 8, 'rgba(255,255,255,0.45)')
  }
  for (let gy = Math.ceil(cy / S) * S; gy < cy + h; gy += S) {
    line(ctx, 0, gy - cy, w, gy - cy, 'rgba(255,255,255,0.08)')
    label(ctx, String(gy), 14, gy - cy - 1, 'rgba(255,255,255,0.45)')
  }
  const p = g.player
  line(ctx, p.x - cx - 6, p.y - cy, p.x - cx + 6, p.y - cy, '#ff4040')
  line(ctx, p.x - cx, p.y - cy - 6, p.x - cx, p.y - cy + 6, '#ff4040')
}

/* ---------------- Performance ---------------- */

const counters = (ctx: Ctx, g: Game) => {
  const inside = g.place.inside
  const lines = [
    `enemies ${g.enemies.length}  attacks ${g.attacks.length}  hazards ${g.hazards.length}`,
    `pickups ${g.pickups.length}  events ${g.mapEvents.list.length}  props ${g.props.length}`,
    `time ${g.time.toFixed(1)}  budget ${g.spawnBudget.toFixed(2)}  tension ${g.tension.level.toFixed(2)}`,
    `pos ${Math.round(g.player.x)}, ${Math.round(g.player.y)}  seed ${g.terrain.seed}  ${inside ? inside.id : g.biome.id}`,
  ]
  ctx.font = '7px monospace'
  ctx.textAlign = 'left'
  lines.forEach((l, i) => {
    ctx.fillStyle = '#000000'
    ctx.fillText(l, 5, 37 + i * 9)
    ctx.fillStyle = '#c0ffc0'
    ctx.fillText(l, 4, 36 + i * 9)
  })
}

const frames: number[] = []
let lastFrame = 0

const fps = (ctx: Ctx) => {
  const now = performance.now()
  if (lastFrame) frames.push(now - lastFrame)
  lastFrame = now
  if (frames.length > 120) frames.shift()
  const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)
  const worst = Math.max(0, ...frames)
  const y0 = 110
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(4, y0 - 30, 124, 34)
  frames.forEach((ms, i) => {
    ctx.fillStyle = ms > 33 ? '#ff4040' : ms > 18 ? '#ffd040' : '#40ff80'
    ctx.fillRect(5 + i, y0 + 2 - Math.min(30, ms * 0.7), 1, Math.min(30, ms * 0.7))
  })
  ctx.font = '7px monospace'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(`${(1000 / Math.max(1, avg)).toFixed(0)} fps  avg ${avg.toFixed(1)}ms  worst ${worst.toFixed(0)}ms`, 5, y0 - 33)
}

/** Draws whatever overlays are on, over the world (camera at `cx`, `cy`). */
export const drawDebugOverlay = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const v = DEBUG_VIEW
  if (v.grid) grid(ctx, g, cx, cy)
  if (v.terrainGrid) terrainGrid(ctx, g, cx, cy)
  if (v.collision) collision(ctx, g, cx, cy)
  if (v.events) events(ctx, g, cx, cy)
  if (v.rooms || v.levels) caveRooms(ctx, g, cx, cy, v.levels, v.rooms)
  if (v.caveRadii) caveRadii(ctx, g, cx, cy)
  if (v.caveSight) caveSight(ctx, g, cx, cy)
  if (!g.place.inside && (v.maze || v.wings || v.mazeRadii || v.mazeContents)) {
    for (const site of mazeSitesNear(g.terrain.seed, g.player.x, g.player.y, 700)) {
      if (v.wings) wings(ctx, site, cx, cy)
      if (v.maze) drawMaze(ctx, g, site, cx, cy)
      if (v.mazeRadii) mazeRadii(ctx, g, site, cx, cy)
      if (v.mazeContents) mazeContents(ctx, g, site, cx, cy)
    }
  }
  if (v.spawnRing) spawnRing(ctx, g, cx, cy)
  if (v.darkSpawn) darkSpawn(ctx, g, cx, cy)
  if (v.mazeSpawn) mazeSpawn(ctx, g, cx, cy)
  if (v.pickups) pickups(ctx, g, cx, cy)
  if (v.hitboxes) hitboxes(ctx, g, cx, cy)
  if (v.targets) targets(ctx, g, cx, cy)
  if (v.playerRings) playerRings(ctx, g, cx, cy)
  if (v.labels) foeLabels(ctx, g, cx, cy)
  if (v.counters) counters(ctx, g)
  if (v.fps) fps(ctx)
}

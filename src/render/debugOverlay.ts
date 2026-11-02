import { GRAND, mazeTheme } from '../data/mazeEvents'
import { roomAt } from '../game/dungeon'
import { mazeSiteAtPoint, mazeSitesNear, type MazeSite } from '../game/grandMaze'
import { distances } from '../game/procgen/maze'
import type { Game } from '../game/types'
import { roomLevels } from './caveSight'
import { seenCells } from './mazeSight'

/**
 * Dev-only overlays the debug menu turns on (`ui/debugMenu.ts`, tab Visão): the bodies the simulation collides (hitboxes), the cave's
 * rooms and corridors with their light level and state, a hedge maze's cells with their walk from the player and what was seen, and a
 * counter of what the run holds. Drawn over the world in screen px, never in a production build's frame (nothing turns them on there).
 */

export const DEBUG_VIEW = { hitboxes: false, rooms: false, levels: false, maze: false, counters: false }

type Ctx = CanvasRenderingContext2D

const label = (ctx: Ctx, text: string, x: number, y: number, color = '#ffffff') => {
  ctx.font = '7px monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#000000'
  ctx.fillText(text, Math.round(x) + 1, Math.round(y) + 1)
  ctx.fillStyle = color
  ctx.fillText(text, Math.round(x), Math.round(y))
}

const ring = (ctx: Ctx, x: number, y: number, r: number, color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, r), 0, Math.PI * 2)
  ctx.stroke()
}

const frameRect = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
}

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
  for (const t of s.traps) ring(ctx, inside.x + t.x - cx, inside.y + t.y - cy, 18, t.done ? '#604040' : '#ff8030')
  if (s.stairs) label(ctx, 'stairs', inside.x + s.stairs[0] - cx, inside.y + s.stairs[1] - cy - 8, '#80ff80')
}

const mazeCells = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const p = g.player
  for (const site of mazeSitesNear(g.terrain.seed, p.x, p.y, 700)) drawMaze(ctx, g, site, cx, cy)
}

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

const counters = (ctx: Ctx, g: Game) => {
  const lines = [
    `enemies ${g.enemies.length}  attacks ${g.attacks.length}  hazards ${g.hazards.length}`,
    `pickups ${g.pickups.length}  events ${g.mapEvents.list.length}  props ${g.props.length}`,
    `time ${g.time.toFixed(1)}  budget ${g.spawnBudget.toFixed(2)}  tension ${g.tension.level.toFixed(2)}`,
    `pos ${Math.round(g.player.x)}, ${Math.round(g.player.y)}  seed ${g.terrain.seed}`,
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

/** Draws whatever overlays are on, over the world (camera at `cx`, `cy`). */
export const drawDebugOverlay = (ctx: Ctx, g: Game, cx: number, cy: number) => {
  const v = DEBUG_VIEW
  if (!(v.hitboxes || v.rooms || v.levels || v.maze || v.counters)) return
  if (v.hitboxes) hitboxes(ctx, g, cx, cy)
  if (v.rooms || v.levels) caveRooms(ctx, g, cx, cy, v.levels, v.rooms)
  if (v.maze && !g.place.inside) mazeCells(ctx, g, cx, cy)
  if (v.counters) counters(ctx, g)
}

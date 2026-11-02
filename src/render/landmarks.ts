import { ellipse, fromStrings, lazy, drawPacked } from '../engine/pixelart'
import { hash2 } from '../engine/rng'
import { LANDMARK, TUNNEL } from '../data/landmarks'
import { MAZE_CAST, MAZE_RUN } from '../data/mazeEvents'
import { mazeBox } from '../game/landmarkLayout'
import { mazeLocked } from '../game/mazeRun'
import { darkLayer } from './places'
import { featuresNear } from '../game/terrain'
import { roomOf } from '../game/room'
import { treasureOpen } from '../game/landmarks'
import { localPlayer } from '../game/players'
import type { Game } from '../game/types'

/**
 * Landmarks' live bits over their sculpted pieces (`render/landmarkPieces.ts`):
 * the camp's fire and smoke, a glint on every treasure still closed, the
 * ring filling while one opens, the ruins' glyphs breathing once woken, the
 * tunnel's lanterns, and the dark while the player walks under a ridge.
 */

type Ctx = CanvasRenderingContext2D

const FLAMES = [
  ['...1...', '..121..', '.12321.', '.13331.', '1233321', '.12221.'],
  ['..1....', '..11...', '.1221..', '.12321.', '1233321', '.12221.'],
  ['....1..', '...11..', '..1221.', '.12331.', '1233321', '.12221.'],
] as const

const flames = FLAMES.map((rows) => lazy(() => fromStrings(rows, { 1: '#e83818', 2: '#f88828', 3: '#f8e070' })))

const GLINT = lazy(() => fromStrings(['..1..', '..1..', '11211', '..1..', '..1..'], { 1: '#fff8c0', 2: '#ffffff' }))
const MOTE = lazy(() => fromStrings(['.1.', '121', '.1.'], { 1: '#68f0f8', 2: '#ffffff' }))

/** Sparks and wisps of the camp's fire, a glint on closed treasures (none in co-op, where they show open: `treasureOpen`), motes over a woken altar, lantern flicker. */
export const drawLandmarkAir = (ctx: Ctx, g: Game, t: number, visible: (x: number, y: number, m?: number) => boolean) => {
  if (roomOf(g)) return
  const p = g.player
  for (const f of featuresNear(g, p.x, p.y, g.view.w / 2 + 60, g.view.h / 2 + 60)) {
    const lm = f.landmark
    if (!lm || !visible(lm.x, lm.y, 160)) continue
    for (const s of f.solids) {
      if (s.kind === 'campfire') drawFire(ctx, s.x, s.y, t, lm.cell)
      if (s.kind === 'ridge') drawLanterns(ctx, s.x, s.y, t)
    }
    const chest = lm.treasure
    if (!chest) continue
    if (!treasureOpen(g, lm.cell)) {
      // Every couple of seconds the treasure catches the light.
      const k = (t * 0.5 + hash2(lm.cell, 1, 3)) % 1
      if (k < 0.18) {
        ctx.globalAlpha = 1 - Math.abs(k - 0.09) / 0.09
        ctx.drawImage(GLINT(), Math.round(chest.x + 4 - 2), Math.round(chest.y - 14 - 2))
        ctx.globalAlpha = 1
      }
      const open = localPlayer(g).landmark.opening
      if (open?.cell === lm.cell) drawProgress(ctx, chest.x, chest.y - 22, open.t / LANDMARK.openTime)
    } else if (lm.id === 'ruins' && g.landmarks.looted.has(lm.cell)) {
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.35 + i / 4) % 1
        ctx.globalAlpha = Math.sin(k * Math.PI)
        ctx.drawImage(MOTE(), Math.round(chest.x - 1 + Math.sin(t * 1.3 + i * 1.7) * 9), Math.round(chest.y - 30 - k * 16))
      }
      ctx.globalAlpha = 1
    }
  }
}

/** The campfire: a flickering flame, embers popping and smoke drifting up and away. */
const drawFire = (ctx: Ctx, x: number, y: number, t: number, seed: number) => {
  const fx = Math.round(x)
  const fy = Math.round(y)
  ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 9)
  drawPacked(ctx, ellipse(16, 7, '#f8a040'), fx - 16, fy - 9)
  ctx.globalAlpha = 1
  ctx.drawImage(flames[Math.floor(t * 9 + seed) % flames.length]!(), fx - 3, fy - 9)
  for (let i = 0; i < 5; i++) {
    const k = (t * 0.45 + i / 5) % 1
    const sx = fx + Math.round(Math.sin(t * 0.8 + i * 2.1) * 3 + k * 10)
    const sy = fy - 10 - Math.round(k * 34)
    ctx.globalAlpha = 0.45 * (1 - k)
    drawPacked(ctx, ellipse(1 + Math.round(k * 3), 1 + Math.round(k * 2), '#c8c0b8'), sx - 2, sy - 2)
  }
  for (let i = 0; i < 3; i++) {
    const k = (t * 1.6 + i / 3 + hash2(seed, i, 5)) % 1
    ctx.globalAlpha = 1 - k
    ctx.fillStyle = '#f8c040'
    ctx.fillRect(fx - 2 + Math.round(hash2(seed, Math.floor(t * 1.6 + i / 3), i) * 5), fy - 8 - Math.round(k * 14), 1, 1)
  }
  ctx.globalAlpha = 1
}

/** A warm glow around the lanterns at the tunnel's mouths. */
const drawLanterns = (ctx: Ctx, x: number, y: number, t: number) => {
  for (const side of [-1, 1]) {
    const lx = Math.round(x + side * 93)
    const ly = Math.round(y - 15)
    ctx.globalAlpha = 0.22 + 0.08 * Math.sin(t * 7 + side)
    drawPacked(ctx, ellipse(6, 6, '#f8d878'), lx - 6, ly - 6)
  }
  ctx.globalAlpha = 1
}

/** Dots around a ring, lit up to `k` (0..1) of the way round: a treasure being opened. */
const drawProgress = (ctx: Ctx, x: number, y: number, k: number) => {
  const n = 12
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    ctx.fillStyle = i / n < k ? '#f8e070' : 'rgba(24,16,16,0.55)'
    ctx.fillRect(Math.round(x + Math.cos(a) * 6), Math.round(y + Math.sin(a) * 6), 1, 1)
  }
}

/** Under a ridge: the screen goes dark on the way in, a faint light moves with the player, and it opens up again at the far mouth. */
export const drawTunnelDark = (ctx: Ctx, g: Game, camX: number, camY: number) => {
  const p = localPlayer(g)
  const tr = p.landmark.transit
  if (!tr) return
  const k = tr.t / TUNNEL.travel
  const dark = Math.min(1, k / 0.22, (1 - k) / 0.22)
  const { w, h } = g.view
  ctx.globalAlpha = 0.92 * Math.max(0, dark)
  ctx.fillStyle = '#060404'
  ctx.fillRect(0, 0, w, h)
  // The player's own light down there, and the rails it follows.
  const px = Math.round(p.x - camX)
  const py = Math.round(p.y - camY - 10)
  ctx.globalAlpha = 0.5 * Math.max(0, dark)
  drawPacked(ctx, ellipse(18, 12, '#3a2e28'), px - 18, py - 12)
  ctx.fillStyle = '#7c7c88'
  for (let i = -6; i <= 6; i++) {
    const rx = Math.round(px + i * 6 - ((p.x * 1) % 6))
    ctx.fillRect(rx, py + 9, 1, 1)
    ctx.fillRect(rx, py + 13, 1, 1)
  }
  ctx.globalAlpha = 1
}

/** Whether the player's sprite hides (walking under a ridge). */
export const playerUnderground = (g: Game) => localPlayer(g).landmark.transit !== null

/* ---------------- The hedge maze's happenings (`game/mazeRun.ts`) ---------------- */

const CHEST = {
  closed: ['..11111..', '.1222221.', '1223332.1', '1111111.1', '1244442.1', '1244442.1', '.1111111.'],
  open: ['.1111111.', '1.......1', '1.55555.1', '1155555.1', '1244442.1', '1244442.1', '.1111111.'],
} as const
const CHEST_COLORS = { 1: '#2c1c10', 2: '#a8683c', 3: '#c88850', 4: '#8a5230', 5: '#f8e070' } as const
const cacheSprites = { closed: lazy(() => fromStrings(CHEST.closed, CHEST_COLORS)), open: lazy(() => fromStrings(CHEST.open, CHEST_COLORS)) }
const KEY = lazy(() => fromStrings(['.111.', '1...1', '1...1', '.111.', '..1..', '..11.', '..1..', '..11.'], { 1: '#f8d030' }))
const LOCK = lazy(() => fromStrings(['.111.', '1...1', '1...1', '22222', '22122', '22222'], { 1: '#403020', 2: '#f8d030' }))

/**
 * What a hedge maze holds that moves or shows: its small chests (a decoy looks just the same), the keys lying in dead ends, the pair of
 * rings, a rustle in the hedges where something hides and a padlock on the heart's chest while keys are missing.
 */
export const drawMazeRun = (ctx: Ctx, g: Game, t: number, visible: (x: number, y: number, m?: number) => boolean) => {
  if (g.mazes.size === 0) return
  for (const run of g.mazes.values()) {
    for (const c of run.caches) {
      if (!visible(c.x, c.y, 24)) continue
      ctx.drawImage((c.open ? cacheSprites.open : cacheSprites.closed)(), Math.round(c.x - 4), Math.round(c.y - 7))
      if (!c.open && c.t > 0) drawProgress(ctx, c.x, c.y - 14, c.t / MAZE_RUN.openTime)
      else if (!c.open && (t * 0.5 + hash2(c.x, c.y, 2)) % 1 < 0.15) ctx.drawImage(GLINT(), Math.round(c.x + 2), Math.round(c.y - 15))
    }
    for (const k of run.keys) {
      if (k.taken || !visible(k.x, k.y, 24)) continue
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 5)
      drawPacked(ctx, ellipse(7, 5, '#f8e070'), Math.round(k.x - 7), Math.round(k.y - 4))
      ctx.globalAlpha = 1
      ctx.drawImage(KEY(), Math.round(k.x - 2), Math.round(k.y - 10 + Math.sin(t * 3 + k.x) * 1.5))
    }
    if (run.rings.length === 2) {
      for (const r of run.rings) {
        if (!visible(r.x, r.y, 24)) continue
        for (let i = 0; i < 10; i++) {
          const a = t * 2 + (i / 10) * Math.PI * 2
          ctx.fillStyle = i % 2 === 0 ? '#c898f8' : '#f8d070'
          ctx.fillRect(Math.round(r.x + Math.cos(a) * 11), Math.round(r.y - 4 + Math.sin(a) * 6), 2, 1)
        }
        ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 4)
        drawPacked(ctx, ellipse(10, 6, '#c898f8'), Math.round(r.x - 10), Math.round(r.y - 10))
        ctx.globalAlpha = 1
      }
    }
    for (const h of run.hidden) {
      if (h.fired || !visible(h.x, h.y, 24)) continue
      // A leaf or two shakes loose now and then.
      const k = (t * 0.7 + hash2(h.x, h.y, 5)) % 1
      if (k > 0.35) continue
      ctx.fillStyle = k < 0.18 ? '#58a838' : '#a8e068'
      ctx.fillRect(Math.round(h.x - 5 + hash2(h.x, Math.floor(t * 0.7), 6) * 10), Math.round(h.y - 6 - k * 14), 2, 1)
    }
  }
  // The padlock on a heart's chest still waiting for keys.
  const p = g.player
  for (const f of featuresNear(g, p.x, p.y, g.view.w / 2 + 60, g.view.h / 2 + 60)) {
    const lm = f.landmark
    if (lm?.id !== 'maze' || !lm.treasure || !mazeLocked(g, lm.cell) || !visible(lm.treasure.x, lm.treasure.y, 30)) continue
    ctx.drawImage(LOCK(), Math.round(lm.treasure.x - 2), Math.round(lm.treasure.y - 26))
  }
}

/**
 * A maze whose biome keeps it dark (`MAZE_CAST`): inside its box the world is dim except round each player (their `vision`), the edge of
 * the light falling off smoothly. Screen space, after the world.
 */
export const drawMazeDark = (ctx: Ctx, g: Game, camX: number, camY: number) => {
  if (roomOf(g) || MAZE_CAST[g.biome.id].rule !== 'dark') return
  const p = g.player
  for (const f of featuresNear(g, p.x, p.y, g.view.w / 2 + 120, g.view.h / 2 + 120)) {
    const lm = f.landmark
    if (lm?.id !== 'maze') continue
    const box = mazeBox(lm.variant, lm.x, lm.y)
    const x = Math.round(box.x - camX)
    const y = Math.round(box.y - camY)
    if (x > g.view.w || y > g.view.h || x + box.w < 0 || y + box.h < 0) continue
    const { w, h } = g.view
    const layer = darkLayer(w, h)
    const d = layer.ctx
    d.globalCompositeOperation = 'source-over'
    d.clearRect(0, 0, w, h)
    // The dark's edge is a soft shadow (the rect drawn far off to the side, only its blurred shadow lands), so it never ends on a line.
    d.fillStyle = '#000'
    d.shadowColor = `rgba(6,4,10,${MAZE_RUN.dark})`
    d.shadowBlur = 18
    d.shadowOffsetX = 4000
    d.fillRect(x - 4000, y - 8, box.w, box.h + 8)
    d.shadowColor = 'transparent'
    d.shadowBlur = 0
    d.shadowOffsetX = 0
    d.globalCompositeOperation = 'destination-out'
    for (const q of g.players) {
      if (q.gone) continue
      const grad = d.createRadialGradient(q.x - camX, q.y - 10 - camY, 0, q.x - camX, q.y - 10 - camY, MAZE_RUN.vision)
      for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `rgba(0,0,0,${(1 - (i / 6) ** 2 * (3 - 2 * (i / 6))).toFixed(3)})`)
      d.fillStyle = grad
      d.fillRect(q.x - camX - MAZE_RUN.vision, q.y - 10 - camY - MAZE_RUN.vision, MAZE_RUN.vision * 2, MAZE_RUN.vision * 2)
    }
    d.globalCompositeOperation = 'source-over'
    ctx.drawImage(layer.canvas, 0, 0)
  }
}

import { METRICS, resetMetrics, stats } from '../game/debugMetrics'
import type { Game } from '../game/types'
import { DEBUG_VIEW } from '../render/debugOverlay'
import { sampleMemory } from '../telemetry'
import { copyText } from './debugData'
import { h } from './dom'

/**
 * The debug menu's Metrics tab: how the run is holding up, measured live. A frame graph (the CPU time of each frame the run moved,
 * against the 60 and 30 fps budgets), the timing of the loop's parts (steps, drawing), what the simulation holds, the memory the
 * sprites and canvases take, and switches for the same numbers drawn on the game itself. Dev only.
 */

const BUDGET = [16.7, 33.3] as const
const W = 320
const H = 90
const TOP = 50

const row = (label: string, ...cells: string[]) => h('div', { class: 'dm-line', style: 'font-size:11px' }, h('span', { style: 'flex:1' }, label), ...cells.map((c) => h('span', { style: 'width:60px;text-align:right' }, c)))

const fmt = (n: number) => n.toFixed(1)

/** Draws the tab into `into`; `live` registers what refreshes a few times a second. */
export const renderMetrics = (into: HTMLElement, g: Game | undefined, say: (text: string) => void, live: (f: () => void) => void) => {
  const canvas = h('canvas', { width: String(W), height: String(H), style: 'width:100%;image-rendering:pixelated;background:#06060c;border:1px solid #335' }) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  const table = h('div', {})
  const sim = h('div', { class: 'dm-info' })
  const mem = h('div', { class: 'dm-info' })

  const paint = () => {
    // The graph: one bar per frame (work in ms), green under the 60 fps budget, yellow under 30, red above; the frame interval as a dot.
    ctx.clearRect(0, 0, W, H)
    const scale = H / TOP
    for (const b of BUDGET) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(0, H - b * scale, W, 1)
    }
    const work = METRICS.work
    work.forEach((ms, i) => {
      const x = Math.round((i / 240) * W)
      const hgt = Math.min(H, ms * scale)
      ctx.fillStyle = ms > BUDGET[1] ? '#ff4040' : ms > BUDGET[0] ? '#ffd040' : '#40ff80'
      ctx.fillRect(x, H - hgt, 1, hgt)
    })
    METRICS.frame.forEach((ms, i) => {
      ctx.fillStyle = '#80b0ff'
      ctx.fillRect(Math.round((i / 240) * W), Math.max(0, H - Math.min(H, ms * scale)), 1, 1)
    })
    ctx.fillStyle = '#ffffff'
    ctx.font = '9px monospace'
    ctx.fillText('60 fps', 2, H - BUDGET[0] * scale - 2)
    ctx.fillText('30 fps', 2, H - BUDGET[1] * scale - 2)

    const frame = stats(METRICS.frame)
    const w = stats(METRICS.work)
    const s = stats(METRICS.step)
    const d = stats(METRICS.draw)
    const n = stats(METRICS.steps)
    table.replaceChildren(
      row('', 'avg', 'p95', 'max'),
      row('Frame interval', fmt(frame.avg), fmt(frame.p95), fmt(frame.max)),
      row('Frame work (ms)', fmt(w.avg), fmt(w.p95), fmt(w.max)),
      row('Sim steps (ms)', fmt(s.avg), fmt(s.p95), fmt(s.max)),
      row('Drawing (ms)', fmt(d.avg), fmt(d.p95), fmt(d.max)),
      row('Ticks per frame', fmt(n.avg), fmt(n.p95), fmt(n.max)),
      row(`FPS ${(1000 / Math.max(1, frame.avg)).toFixed(0)}`, '', 'worst work', `${fmt(METRICS.worst.ms)} @${METRICS.worst.at.toFixed(0)}s`),
    )
    if (g) {
      const e = g.enemies
      sim.textContent = [
        `foes ${e.length} (alive ${e.filter((x) => x.dying < 0).length}, maze ${e.filter((x) => x.home !== undefined).length}, elite ${e.filter((x) => x.elite).length}, boss ${e.filter((x) => x.boss).length})`,
        `moves ${g.attacks.length} · hazards ${g.hazards.length} · pickups ${g.pickups.length} · particles ${g.particles.length} · texts ${g.texts.length}`,
        `props ${g.props.length} · map events ${g.mapEvents.list.length} · terrain cells cached ${g.terrain.cells.size} · mazes met ${g.mazes.size}`,
        `run ${g.time.toFixed(1)}s · world ${g.now.toFixed(1)}s · spawn budget ${g.spawnBudget.toFixed(2)} · tension ${g.tension.level.toFixed(2)}`,
      ].join('\n')
    } else sim.textContent = 'Start a run first.'
    const m = sampleMemory()
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
    mem.textContent = [
      heap ? `JS heap ${(heap.usedJSHeapSize / 1048576).toFixed(0)} / ${(heap.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : 'JS heap: not exposed by this browser',
      `sprite sheets ${m.sheets} · ${m.sheetMb} MB (peak ${m.peakSheetMb})`,
      `canvases ${m.canvases} · ${m.canvasMb} MB (peak ${m.peakCanvasMb} MB, ${m.peakCanvases})`,
      `draw quality ${m.quality}`,
    ].join('\n')
  }

  const toggle = (label: string, key: 'counters' | 'fps') => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement
    input.checked = DEBUG_VIEW[key]
    input.addEventListener('change', () => (DEBUG_VIEW[key] = input.checked))
    return h('label', { class: 'dm-line' }, h('span', {}, label), input)
  }
  const reset = h('button', { type: 'button' }, 'Reset samples')
  reset.addEventListener('click', () => {
    resetMetrics()
    say('Samples cleared.')
  })
  const copy = h('button', { type: 'button' }, 'Copy metrics')
  copy.addEventListener('click', () => {
    const text = JSON.stringify({ frame: stats(METRICS.frame), work: stats(METRICS.work), step: stats(METRICS.step), draw: stats(METRICS.draw), steps: stats(METRICS.steps), worst: METRICS.worst, memory: sampleMemory() }, null, 2)
    console.log(text)
    copyText(text)
    say('Metrics copied (and in the console).')
  })
  into.append(
    h('div', { class: 'dm-title', style: 'cursor:default' }, 'Frame work per frame (bars) and frame interval (dots)'),
    canvas,
    table,
    h('div', { class: 'dm-title', style: 'cursor:default' }, 'Simulation'),
    sim,
    h('div', { class: 'dm-title', style: 'cursor:default' }, 'Memory'),
    mem,
    h('div', { class: 'dm-title', style: 'cursor:default' }, 'On the game screen'),
    toggle('Counters (foes, moves, pickups, clock, seed)', 'counters'),
    toggle('Frame time graph', 'fps'),
    h('div', { class: 'dm-btns' }, reset, copy),
  )
  paint()
  live(paint)
}

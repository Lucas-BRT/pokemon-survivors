import { describe, it } from 'vitest'
import { createRng } from '../../engine/rng'
import { MAZE } from '../../data/landmarks'
import { MAZE_PATTERNS } from '../landmarkLayout'
import { generateMaze, mazeMetrics, type MazeLayout, type MazeMetrics, type MazeStyle } from './maze'

/**
 * The generators' lab, off in the regular suite: `VITE_LAB=1 npx vitest run src/game/procgen/lab.test.ts --reporter=verbose` (the report goes to the console).
 * Builds many mazes of each style and prints their metrics, so a generator is
 * judged by numbers (and a few drawings) before it goes anywhere near the game.
 */

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const fixed = (x: number, d = 1) => x.toFixed(d)

/** The maze as text: `+--+` walls, `E` the way in and `X` the treasure. */
const ascii = ({ maze, entrance, goal }: MazeLayout) => {
  const lines: string[] = []
  for (let r = 0; r <= maze.rows; r++) {
    let top = ''
    for (let c = 0; c < maze.cols; c++) top += maze.h[r]![c] ? '+--' : '+  '
    lines.push(top + '+')
    if (r === maze.rows) break
    let mid = ''
    for (let c = 0; c <= maze.cols; c++) {
      mid += maze.v[r]![c] ? '|' : ' '
      if (c < maze.cols) mid += entrance.c === c && entrance.r === r ? 'E ' : goal.c === c && goal.r === r ? 'X ' : '  '
    }
    lines.push(mid)
  }
  return lines.join('\n')
}

/** The maze the game has now: one of `MAZE_PATTERNS`, in at the south middle, the chest at the heart. */
const baseline = (i: number): MazeLayout => {
  const w = MAZE_PATTERNS[i]!
  const n = MAZE.size
  const mid = Math.floor(n / 2)
  return { maze: { cols: n, rows: n, h: w.h, v: w.v }, entrance: { c: mid, r: n - 1, side: 2 }, goal: { c: mid, r: mid } }
}

const STYLES: Record<string, MazeStyle> = {
  'novo 7x7 corredores (newest .9)': { cols: 7, rows: 7, newest: 0.9, braid: 0 },
  'novo 9x9 misto (newest .7)': { cols: 9, rows: 9, newest: 0.7, braid: 0 },
  'novo 9x9 ramificado (newest .3)': { cols: 9, rows: 9, newest: 0.3, braid: 0 },
  'novo 9x9 misto + braid .3': { cols: 9, rows: 9, newest: 0.7, braid: 0.3 },
  'novo 11x11 misto + braid .2': { cols: 11, rows: 11, newest: 0.7, braid: 0.2 },
}

const row = (name: string, ms: readonly MazeMetrics[]) =>
  `${name.padEnd(34)} ${String(ms.length).padStart(4)}  ${[
    mean(ms.map((m) => m.cells)),
    mean(ms.map((m) => m.path)),
    mean(ms.map((m) => m.diameter)),
    mean(ms.map((m) => m.reach)) * 100,
    mean(ms.map((m) => m.deadEnds)),
    mean(ms.map((m) => m.loops)),
    mean(ms.map((m) => m.turns)),
    mean(ms.map((m) => m.wrongTurns)),
  ]
    .map((x) => fixed(x).padStart(6))
    .join(' ')}`

describe.skipIf(!import.meta.env.VITE_LAB)('procgen lab: mazes', () => {
  it('compares the maze the game has now with the new styles', () => {
    const out: string[] = []
    out.push(`${'estilo'.padEnd(34)} ${'n'.padStart(4)}  ${['celul', 'passos', 'diam', 'reach%', 'becos', 'lacos', 'curvas', 'erros'].map((h) => h.padStart(6)).join(' ')}`)
    out.push(row('atual (6 padroes 5x5, baú no centro)', MAZE_PATTERNS.map((_, i) => mazeMetrics(baseline(i)))))
    for (const [name, style] of Object.entries(STYLES)) {
      const ms: MazeMetrics[] = []
      for (let seed = 1; seed <= 200; seed++) ms.push(mazeMetrics(generateMaze(createRng(seed), style)))
      out.push(row(name, ms))
    }
    out.push('', 'passos = entrada ate o tesouro; reach = passos / diametro; erros = becos fora do caminho certo', '')
    for (const [name, style] of [['novo 9x9 misto + braid .3 (semente 7)', STYLES['novo 9x9 misto + braid .3']!], ['novo 9x9 corredores sem braid (semente 7)', { cols: 9, rows: 9, newest: 0.95, braid: 0 }]] as const) {
      out.push(name, ascii(generateMaze(createRng(7), style)), '')
    }
    out.push('atual, padrao 0:', ascii(baseline(0)))
    console.log('\n' + out.join('\n'))
  })
})

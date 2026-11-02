import { CAVE_LEVELS } from '../data/caveLevels'
import { CAVE_SHOP } from '../data/caveShop'
import { HAZARD_HIT, HAZARD_PACE, HAZARD_RULES, WORLD_PATTERNS } from '../data/hazards'
import { LANDMARK } from '../data/landmarks'
import { GRAND, MAZE_RUN } from '../data/mazeEvents'
import { CAVE, PLACE } from '../data/places'
import { CAVE_GEN } from '../data/procgen'
import { TERRAIN } from '../data/terrain'
import { BOSS_FIGHT, ELITE, FINALE, RUNNER, STAGES } from '../data/waves'
import { DIFFICULTIES } from '../game/difficulty'
import { CHEST, DIRECTOR } from '../game/mapEventRules'
import { RENEWAL } from '../game/renewal'
import { SHINY_ODDS } from '../game/shiny'
import { SPITTERS } from '../game/spitters'
import { TENSION, TENSION_PEAK } from '../game/tension'
import { h } from './dom'

/**
 * The debug menu's "Dados" tab: every number and flag of the game's data tables as a field to edit while the run plays. The tables are
 * plain objects (`as const` is only a type), so a change takes effect wherever the game reads the value when it uses it (not the ones
 * it works out once when the page loads, like a place's clock from the floors' clocks); generating a floor, a maze or a room uses it from
 * the next one. Each field remembers its first value for "↺", and "Copiar alterações" prints what changed to paste into the data files.
 */

const TABLES: Record<string, object> = {
  CAVE,
  CAVE_GEN,
  CAVE_SHOP,
  CAVE_LEVELS,
  PLACE,
  GRAND,
  MAZE_RUN,
  STAGES,
  ELITE,
  RUNNER,
  SPITTERS,
  BOSS_FIGHT,
  FINALE,
  RENEWAL,
  SHINY_ODDS,
  TENSION,
  TENSION_PEAK,
  DIFFICULTIES,
  HAZARD_PACE,
  HAZARD_HIT,
  HAZARD_RULES,
  WORLD_PATTERNS,
  DIRECTOR,
  CHEST,
  TERRAIN,
  LANDMARK,
}

type Leaf = { table: string; path: string; read: () => number | boolean; write: (v: number | boolean) => void; first: number | boolean }

let leaves: Leaf[] | null = null

/** Walks every table once, noting each number and flag with the way to read and write it and what it was. */
const collect = (): Leaf[] => {
  if (leaves) return leaves
  const out: Leaf[] = []
  const walk = (table: string, path: string, node: unknown, parent: Record<string, unknown> | null, key: string) => {
    if (typeof node === 'number' || typeof node === 'boolean') {
      if (!parent) return
      out.push({ table, path, read: () => parent[key] as number | boolean, write: (v) => void (parent[key] = v), first: node })
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      for (const k of Object.keys(obj)) walk(table, Array.isArray(node) ? `${path}[${k}]` : path ? `${path}.${k}` : k, obj[k], obj, k)
    }
  }
  for (const [name, table] of Object.entries(TABLES)) walk(name, '', table, null, '')
  return (leaves = out)
}

const stepOf = (v: number) => (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 0.5 : Math.abs(v) >= 1 ? 0.05 : 0.005)

/** Puts text on the clipboard (the browser may refuse without a click or permission: then it's in the console only). */
export const copyText = (text: string): void => {
  navigator.clipboard?.writeText(text).catch(() => {})
}

let filter = ''

/** Draws the tab's fields into `into`; `say` shows a line at the menu's bottom. */
export const renderData = (into: HTMLElement, say: (text: string) => void) => {
  const all = collect()
  const search = h('input', { type: 'search', placeholder: 'buscar (ex.: CAVE_GEN.packs, glint, spawn)', value: filter, style: 'width:100%;margin:4px 0' }) as HTMLInputElement
  const list = h('div', {})
  const changed = () => all.filter((l) => l.read() !== l.first)
  const draw = () => {
    list.replaceChildren()
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    const rows = all.filter((l) => words.every((w) => `${l.table}.${l.path}`.toLowerCase().includes(w)))
    if (words.length === 0) {
      list.append(h('div', { class: 'dm-info' }, `${all.length} campos em ${Object.keys(TABLES).length} tabelas. Busque pelo nome, ou abra um grupo.`))
      const counts = new Map<string, Leaf[]>()
      for (const l of all) counts.set(l.table, [...(counts.get(l.table) ?? []), l])
      for (const [table, ls] of counts) {
        const box = h('details', { class: 'dm-group' }, h('summary', { class: 'dm-title' }, `${table} (${ls.length}${ls.some((l) => l.read() !== l.first) ? ', alterado' : ''})`)) as HTMLDetailsElement
        let built = false
        box.addEventListener('toggle', () => {
          if (!box.open || built) return
          built = true
          for (const l of ls.slice(0, 400)) box.append(row(l))
        })
        list.append(box)
      }
      return
    }
    list.append(h('div', { class: 'dm-info' }, `${rows.length} campos${rows.length > 120 ? ' (mostrando 120)' : ''}`))
    for (const l of rows.slice(0, 120)) list.append(row(l, true))
  }
  const row = (l: Leaf, withTable = false) => {
    const v = l.read()
    const input = h('input', typeof v === 'boolean' ? { type: 'checkbox' } : { type: 'number', step: String(stepOf(Number(v))), value: String(v), style: 'width:84px' }) as HTMLInputElement
    if (typeof v === 'boolean') input.checked = v
    const reset = h('button', { type: 'button', title: 'restaurar' }, '↺')
    const name = h('span', { title: `${l.table}.${l.path}`, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1' }, withTable ? `${l.table}.${l.path}` : l.path)
    const paint = () => (name.style.color = l.read() !== l.first ? '#ffd060' : '')
    input.addEventListener('input', () => {
      const n = typeof v === 'boolean' ? input.checked : Number(input.value)
      if (typeof n === 'number' && !Number.isFinite(n)) return
      l.write(n)
      paint()
    })
    reset.addEventListener('click', () => {
      l.write(l.first)
      if (typeof v === 'boolean') input.checked = Boolean(l.first)
      else input.value = String(l.first)
      paint()
    })
    paint()
    return h('label', { class: 'dm-line', style: 'align-items:center' }, name, input, reset)
  }
  search.addEventListener('input', () => {
    filter = search.value
    draw()
  })
  const copy = h('button', { type: 'button' }, 'Copiar alterações')
  copy.addEventListener('click', () => {
    const diff = Object.fromEntries(changed().map((l) => [`${l.table}.${l.path}`, l.read()]))
    const text = JSON.stringify(diff, null, 2)
    console.log(text)
    copyText(text)
    say(`${Object.keys(diff).length} alterações copiadas (e no console).`)
  })
  const undo = h('button', { type: 'button' }, 'Restaurar tudo')
  undo.addEventListener('click', () => {
    for (const l of changed()) l.write(l.first)
    draw()
    say('Dados restaurados.')
  })
  into.append(search, h('div', { class: 'dm-btns' }, copy, undo), list)
  draw()
}

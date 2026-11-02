import { ENEMY_LIGHT, LIGHT_PROFILES } from '../data/pokemonLight'
import { CAVE_LEVELS } from '../data/caveLevels'
import { CAVE_SHOP } from '../data/caveShop'
import { LIGHT_FIELD, LIGHT_KINDS } from '../data/lightSources'
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
 * The debug menu's "Data" tab: every number and flag of the game's data tables as a field to edit while the run plays. The tables are
 * plain objects (`as const` is only a type), so a change takes effect wherever the game reads the value when it uses it, which is
 * not always now: each field wears a tag saying when (`WHEN`), because many are read once, when a floor, a maze or a run is made, or
 * were copied when the page loaded. Each field remembers its first value for "↺", and "Copy changes" prints what changed.
 */

const TABLES: Record<string, object> = {
  CAVE,
  CAVE_GEN,
  CAVE_SHOP,
  LIGHT_KINDS,
  LIGHT_FIELD,
  LIGHT_PROFILES,
  ENEMY_LIGHT,
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

/** When a change takes effect, as audited from the code that reads the field. */
type When = 'live' | 'floor' | 'later' | 'maze' | 'rebuild' | 'run' | 'cached' | 'captured' | 'diff' | 'split' | 'test' | 'unused'

const TAGS: Record<When, { label: string; color: string; note: string }> = {
  live: { label: 'live', color: '#70e070', note: 'read every time it is used: takes effect now' },
  floor: { label: 'floor', color: '#e0d060', note: 'read when a cave floor is generated: Cave tab → Regenerate floor' },
  later: { label: 'later', color: '#e0d060', note: 'read at a later moment (the next entrance scheduled, the next guardian woken…)' },
  maze: { label: 'maze', color: '#e0d060', note: 'read when a maze is generated (they are cached per world): Maze tab → New world' },
  rebuild: { label: 'rebuild', color: '#e0d060', note: 'read when a maze’s contents are built: Maze tab → Rebuild contents' },
  run: { label: 'run', color: '#e0a060', note: 'read when a run starts: restart the run' },
  cached: { label: 'cached', color: '#e0a060', note: 'only terrain not generated yet (the cells already seen are cached)' },
  captured: { label: 'captured', color: '#e07070', note: 'copied once when the page loaded: changing it does nothing (or breaks things) until a reload' },
  diff: { label: 'row', color: '#e0d060', note: 'one row per difficulty (or level): only the one in play matters' },
  split: { label: 'sim', color: '#e0d060', note: 'only the simulation reads this copy; what is drawn uses the Light tab’s' },
  test: { label: 'tests', color: '#e07070', note: 'only the tests read it: changing it changes nothing in the game' },
  unused: { label: 'unused', color: '#e07070', note: 'nothing reads it' },
}

/** The first rule that matches `TABLE.path` says when the field takes effect; fields no rule matches have not been audited. */
const WHEN: ReadonlyArray<readonly [RegExp, When]> = [
  [/^CAVE_SHOP\.sources$/, 'test'],
  [/^LIGHT_KINDS\./, 'live'],
  [/^LIGHT_FIELD\./, 'captured'],
  [/^(LIGHT_PROFILES|ENEMY_LIGHT)\./, 'live'],
  [/^CAVE\.floors$/, 'unused'],
  [/^CAVE\.lit\./, 'split'],
  [/^CAVE\.card$/, 'floor'],
  [/^CAVE\.(light|stairsRadius|wind|monsterHouse|chestRadius|chestTime|sight|phase)/, 'live'],
  [/^CAVE_SHOP\.(chance|shinyChance|shinyFrom|gemsPerPrize)$/, 'floor'],
  [/^CAVE_SHOP\./, 'live'],
  [/^CAVE_GEN\.(floorTime|chamberTime)/, 'floor'],
  [/^CAVE_GEN\.(wind|spawn|spawnPerFloor|packMax|packs)/, 'live'],
  [/^CAVE_GEN\./, 'floor'],
  // A cave's level row: laid out when a floor is made, the rest read as it plays; only the row of the cave's own level matters.
  [/^CAVE_LEVELS\.\[\d\]\.(floors|grid|big|ambush|items|sources|traps|reward\.(coins|gems|items|shiny))$/, 'floor'],
  [/^CAVE_LEVELS\./, 'diff'],
  [/^PLACE\.firstAt$/, 'run'],
  [/^PLACE\.(every|jitter|openTime|bossWait)$/, 'later'],
  [/^PLACE\./, 'live'],
  [/^GRAND\.(cell|wall)$/, 'captured'],
  [/^GRAND\.(sight|reach)$/, 'live'],
  [/^GRAND\./, 'maze'],
  [/^MAZE_RUN\.(lockOdds|keys|decoyOdds|caches|ringPairs|hidden)/, 'rebuild'],
  [/^MAZE_RUN\.rare/, 'later'],
  [/^MAZE_RUN\./, 'live'],
  [/^SPITTERS\.\w+\.from$/, 'captured'],
  [/^(DIFFICULTIES|SPITTERS|TENSION_PEAK|HAZARD_PACE)\.\w+\./, 'diff'],
  [/^RUNNER\.(from|weight)$/, 'run'],
  [/^(RUNNER|ELITE)\./, 'live'],
  [/^STAGES\.\[\d+\]\.(rate|max)$/, 'live'],
  [/^STAGES\./, 'run'],
  [/^WORLD_PATTERNS\.\w+\.weight$/, 'captured'],
  [/^WORLD_PATTERNS\./, 'live'],
  [/^TERRAIN\.(weights|scatter\.weights|bushVariants|rockVariants|treeVariants)/, 'captured'],
  [/^TERRAIN\./, 'cached'],
  [/^LANDMARK\.(treasureRadius|openTime)$/, 'live'],
  [/^LANDMARK\./, 'cached'],
]

const whenOf = (l: { table: string; path: string }): When | null => {
  const id = `${l.table}.${l.path}`
  return WHEN.find(([re]) => re.test(id))?.[1] ?? null
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

/** The fields for code (the MCP bridge): each one's id, value, first value and when a change takes effect. */
export const dataApi = {
  search: (query: string, limit = 60) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const found = collect().filter((l) => words.every((w) => `${l.table}.${l.path}`.toLowerCase().includes(w)))
    return { total: found.length, fields: found.slice(0, limit).map((l) => describe(l)) }
  },
  get: (id: string) => {
    const l = collect().find((x) => `${x.table}.${x.path}` === id)
    return l ? describe(l) : null
  },
  set: (id: string, value: number | boolean) => {
    const l = collect().find((x) => `${x.table}.${x.path}` === id)
    if (!l || typeof value !== typeof l.first) return null
    l.write(value)
    return describe(l)
  },
  reset: (id: string) => {
    const l = collect().find((x) => `${x.table}.${x.path}` === id)
    if (!l) return null
    l.write(l.first)
    return describe(l)
  },
}

const describe = (l: Leaf) => {
  const when = whenOf(l)
  return { id: `${l.table}.${l.path}`, value: l.read(), first: l.first, when: when ? `${TAGS[when].label}: ${TAGS[when].note}` : 'not audited' }
}

const stepOf = (v: number) => (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 0.5 : Math.abs(v) >= 1 ? 0.05 : 0.005)

/** Puts text on the clipboard (the browser may refuse without a click or permission: then it's in the console only). */
export const copyText = (text: string): void => {
  navigator.clipboard?.writeText(text).catch(() => {})
}

let filter = ''
let onlyNow = false

/** Draws the tab's fields into `into`; `say` shows a line at the menu's bottom. */
export const renderData = (into: HTMLElement, say: (text: string) => void) => {
  const all = collect()
  const search = h('input', { type: 'search', placeholder: 'search (e.g. CAVE_GEN.packs, glint, spawn)', value: filter, style: 'width:100%;margin:4px 0' }) as HTMLInputElement
  const list = h('div', {})
  const changed = () => all.filter((l) => l.read() !== l.first)
  const draw = () => {
    list.replaceChildren()
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    const shown = all.filter((l) => !onlyNow || whenOf(l) === 'live')
    const rows = shown.filter((l) => words.every((w) => `${l.table}.${l.path}`.toLowerCase().includes(w)))
    if (words.length === 0) {
      list.append(h('div', { class: 'dm-info' }, `${shown.length} fields in ${Object.keys(TABLES).length} tables. Search by name, or open a group.`))
      const counts = new Map<string, Leaf[]>()
      for (const l of shown) counts.set(l.table, [...(counts.get(l.table) ?? []), l])
      for (const [table, ls] of counts) {
        const box = h('details', { class: 'dm-group' }, h('summary', { class: 'dm-title' }, `${table} (${ls.length}${ls.some((l) => l.read() !== l.first) ? ', changed' : ''})`)) as HTMLDetailsElement
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
    list.append(h('div', { class: 'dm-info' }, `${rows.length} fields${rows.length > 120 ? ' (showing 120)' : ''}`))
    for (const l of rows.slice(0, 120)) list.append(row(l, true))
  }
  const row = (l: Leaf, withTable = false) => {
    const v = l.read()
    const input = h('input', typeof v === 'boolean' ? { type: 'checkbox' } : { type: 'number', step: String(stepOf(Number(v))), value: String(v), style: 'width:84px' }) as HTMLInputElement
    if (typeof v === 'boolean') input.checked = v
    const reset = h('button', { type: 'button', title: 'restore' }, '↺')
    const when = whenOf(l)
    const tag = when ? h('b', { title: TAGS[when].note, style: `color:${TAGS[when].color};margin-right:4px;font-weight:normal` }, `[${TAGS[when].label}]`) : h('i', { title: 'not audited: it may or may not take effect now', style: 'color:#888;margin-right:4px' }, '[?]')
    const name = h('span', { title: `${l.table}.${l.path}${when ? ` — ${TAGS[when].note}` : ''}`, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1' }, tag, withTable ? `${l.table}.${l.path}` : l.path)
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
  const copy = h('button', { type: 'button' }, 'Copy changes')
  copy.addEventListener('click', () => {
    const diff = Object.fromEntries(changed().map((l) => [`${l.table}.${l.path}`, l.read()]))
    const text = JSON.stringify(diff, null, 2)
    console.log(text)
    copyText(text)
    say(`${Object.keys(diff).length} changes copied (and in the console).`)
  })
  const undo = h('button', { type: 'button' }, 'Restore all')
  undo.addEventListener('click', () => {
    for (const l of changed()) l.write(l.first)
    draw()
    say('Data restored.')
  })
  const now = h('input', { type: 'checkbox' }) as HTMLInputElement
  now.checked = onlyNow
  now.addEventListener('change', () => {
    onlyNow = now.checked
    draw()
  })
  const legend = h(
    'div',
    { class: 'dm-info', style: 'font-size:11px' },
    ...(Object.keys(TAGS) as When[]).flatMap((k) => [h('b', { title: TAGS[k].note, style: `color:${TAGS[k].color};font-weight:normal` }, `[${TAGS[k].label}]`), ` ${TAGS[k].note}\n`]),
    h('i', { style: 'color:#888' }, '[?]'),
    ' not audited',
  )
  into.append(search, h('label', { class: 'dm-line' }, h('span', {}, 'Only fields that take effect now'), now), h('div', { class: 'dm-btns' }, copy, undo), list, h('details', { class: 'dm-group' }, h('summary', { class: 'dm-title' }, 'Legend'), legend))
  draw()
}

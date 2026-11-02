import { playSfx } from '../engine/audio'
import type { Input } from '../engine/input'
import { ENEMIES, type EnemyId } from '../data/enemies'
import { EXPLORER_ORDER, EXPLORER_THEMES, EXPLORERS, type ExplorerThemeId } from '../data/explorers'
import { PLAYABLE, type PlayableId } from '../data/hatchlings'
import { LIGHT_PROFILES, profileIdOf } from '../data/pokemonLight'
import { floorKind } from '../game/explorers'
import { t } from '../i18n'
import { clockIcon, crownIcon, explorersIcon } from '../render/art'
import { portraitUrl } from '../render/sprites'
import { h, later } from './dom'
import { hint, menu, type Screen } from './screens'

/**
 * Explorers outside a run (`docs/explorers.md`): the screen the lobby's tile opens, explaining the mode (the stairs always open, nothing
 * respawning, the clock, a sub-boss every 5 floors and a boss with a new theme every 20, the light your Pokémon gives) beside the partner
 * it takes down and the best floor reached on this device; and the end screen of a descent. A descent is never ranked, banked or replayed.
 */

const BEST_KEY = 'ps:explorersBest'

/** The deepest floor this device has reached (0 before the first descent). */
export const explorersBest = () => {
  try {
    return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0)
  } catch {
    return 0
  }
}

/** Keeps `depth` as the best if it beats the old one; returns whether it did. */
export const keepExplorersBest = (depth: number) => {
  if (depth <= explorersBest()) return false
  try {
    localStorage.setItem(BEST_KEY, String(depth))
  } catch {
    // Storage blocked: the record lasts this page's end screen only.
  }
  return true
}

export type ExplorersActions = {
  /** Starts a descent with `partner`. */
  play: (partner: PlayableId) => void
  back: () => void
}

/** The green of the stairs, the mode's color. */
const GREEN = '#48a060'

/** A 1 to `PIPS` count of `value` between `min` and `max` of the profiles' table. */
const PIPS = 5
const pips = (value: number, min: number, max: number) => 1 + Math.round(((value - min) / (max - min)) * (PIPS - 1))

const profiles = Object.values(LIGHT_PROFILES)
const RANGE = [Math.min(...profiles.map((p) => p.range)), Math.max(...profiles.map((p) => p.range))] as const
const GLOW = [Math.min(...profiles.map((p) => p.glow)), Math.max(...profiles.map((p) => p.glow))] as const

const portrait = (id: EnemyId, title = ENEMIES[id].name) => h('img', { src: portraitUrl(ENEMIES[id].dex), alt: title, title })

/** The partner: its face, how its light compares (the circle it lights in the dark, and two bars) and its evolution line. */
const hero = (partner: PlayableId) => {
  const m = t().explorers
  const line = PLAYABLE[partner].line
  const first = line[0]!
  const id = profileIdOf(first.dex)
  const profile = LIGHT_PROFILES[id]
  const info = m.lights[id]
  const bar = (label: string, n: number) =>
    h('div', { class: 'arena-stat' }, h('span', {}, label), h('span', { class: 'arena-pips' }, ...Array.from({ length: PIPS }, (_, i) => h('i', { class: i < n ? 'on' : '' }))))
  return h(
    'div',
    { class: 'arena-hero explorers-hero', style: `--role:${GREEN}` },
    h('span', { class: 'field-label' }, m.partner),
    h('div', { class: 'arena-hero-top' }, h('img', { class: 'arena-hero-face', src: portraitUrl(first.dex), alt: '' }), h('div', { class: 'arena-hero-id' }, h('b', { class: 'arena-hero-name' }, first.name), h('em', { class: 'explorers-chip' }, info.name))),
    h('span', { class: 'field-label' }, m.sight),
    h(
      'div',
      { class: 'explorers-sight' },
      // The circle it lights in the dark, against the widest one any Pokémon has.
      h('div', { class: 'explorers-lamp', style: `--r:${Math.round((profile.range / RANGE[1]) * 100)}%;--g:${profile.glow}` }, h('i', {})),
      h('div', { class: 'arena-stats' }, bar(m.stats.range, pips(profile.range, ...RANGE)), bar(m.stats.glow, pips(profile.glow, ...GLOW))),
    ),
    h('p', { class: 'arena-hero-info' }, info.text),
    h(
      'div',
      { class: 'arena-line' },
      ...line.flatMap((stage, i) => [...(i > 0 ? [h('span', { class: 'arena-line-arrow' }, '›')] : []), h('img', { src: portraitUrl(stage.dex), alt: stage.name, title: stage.name })]),
    ),
  )
}

/** The 20 floors of a block as a track: a sub-boss every 5 (the guard of the theme shown first), the boss at the end. */
const track = () => {
  const m = t().explorers
  const sample = EXPLORER_THEMES[EXPLORER_ORDER[0]!]
  const cell = (floor: number) => {
    const kind = floorKind(floor)
    const guard = kind === 'boss' ? sample.boss : kind === 'subboss' ? sample.subboss : null
    return h('li', { class: `explorers-cell cell-${kind}`, title: `${m.legend.floor} ${floor}` }, guard ? portrait(guard) : h('i', {}), h('small', {}, String(floor)))
  }
  return h(
    'section',
    { class: 'explorers-track' },
    h('div', { class: 'arena-pick-head' }, h('span', { class: 'field-label' }, m.track), h('small', {}, m.trackNote)),
    h('ol', { class: 'explorers-floors' }, ...Array.from({ length: EXPLORERS.bossEvery }, (_, i) => cell(i + 1))),
    h(
      'p',
      { class: 'explorers-legend' },
      h('span', { class: 'explorers-key key-floor' }, m.legend.floor),
      h('span', { class: 'explorers-key key-sub' }, m.legend.sub),
      h('span', { class: 'explorers-key key-boss' }, m.legend.boss, ' · ', EXPLORERS.bossEvery),
    ),
  )
}

/** The three themes in order: name, what presses the clock, what lives there and its guards. */
const themes = () => {
  const m = t().explorers
  const cards = EXPLORER_ORDER.map((id, i) => {
    const theme = EXPLORER_THEMES[id]
    const text = m.themes[id]
    // The first four species to show up, then the sub-boss and the boss.
    const folk = theme.species.slice(0, 4).map(([species]) => portrait(species))
    return h(
      'li',
      { class: `explorers-theme theme-${id}` },
      h('div', { class: 'explorers-theme-head' }, h('b', {}, `${i + 1}. ${text.name}`), h('em', { class: 'explorers-chip' }, text.clock)),
      h('p', {}, text.text),
      h('div', { class: 'explorers-folk' }, ...folk, h('span', { class: 'explorers-gap' }, '›'), h('span', { class: 'explorers-guard guard-sub' }, portrait(theme.subboss)), h('span', { class: 'explorers-guard guard-boss' }, portrait(theme.boss))),
    )
  })
  return h('section', { class: 'explorers-themes' }, h('span', { class: 'field-label' }, m.themeHead), h('ol', {}, ...cards))
}

/** The Como jogar strip: four steps, each with its picture. */
const howToPlay = () => {
  const m = t().explorers
  const icons = [explorersIcon(), portraitUrl(ENEMIES.rattata.dex), clockIcon(), crownIcon()]
  return h(
    'section',
    { class: 'arena-how', 'aria-label': m.how },
    h('span', { class: 'field-label' }, m.how),
    h(
      'ol',
      { class: 'arena-steps' },
      ...m.steps.map((step, i) =>
        h(
          'li',
          { class: `arena-step step${i + 1}` },
          h('span', { class: 'arena-step-n' }, String(i + 1)),
          h('img', { src: icons[i]!, alt: '' }),
          h('span', { class: 'arena-step-text' }, h('b', {}, step.title), h('small', {}, step.text)),
        ),
      ),
    ),
  )
}

/** The Explorers screen: what the mode is, the partner (and its light), the descent's track and themes, the best floor; Descer or Voltar. */
export const explorersScreen = (root: HTMLElement, input: Input, partner: PlayableId, actions: ExplorersActions): Screen => {
  const m = t().explorers
  const best = explorersBest()
  const buttons = [h('button', { class: 'btn selected', type: 'button' }, m.play), h('button', { class: 'btn', type: 'button' }, m.back)]
  const nav = menu(input, buttons, (i) => (playSfx('select'), later(i === 0 ? () => actions.play(partner) : close)), { horizontal: true })
  const offKeys = input.onKey((key) => (key === 'Escape' || key === 'Backspace') && close())
  let closed = false
  const el = h(
    'div',
    { class: 'screen dim arena-screen explorers-screen' },
    h(
      'div',
      { class: 'dialog box pop arena explorers' },
      h('div', { class: 'dialog-title arena-title' }, h('img', { src: explorersIcon(), alt: '' }), h('span', {}, m.title), h('em', { class: 'arena-tagline explorers-tagline' }, m.tagline), h('small', { class: 'arena-sub' }, m.intro)),
      h('div', { class: 'arena-main' }, hero(partner), h('div', { class: 'explorers-side' }, track(), themes())),
      howToPlay(),
      h('p', { class: 'explorers-best' }, best > 0 ? m.best(best) : m.noBest),
      h('div', { class: 'buttons' }, ...buttons),
      hint(m.hintKeys, m.hintTouch),
    ),
  )

  function close() {
    if (closed) return
    closed = true
    playSfx('select')
    dispose()
    later(actions.back)
  }
  function dispose() {
    nav.off()
    offKeys()
    el.remove()
  }

  root.append(el)
  return { el, dispose, dim: 0.5 }
}

export type ExplorersEnd = { depth: number; theme: ExplorerThemeId; again: () => void; lobby: () => void }

/** The end of a descent: the floor reached and its theme, whether it's a new best, and Descer de novo or Sair. */
export const explorersEnd = (root: HTMLElement, input: Input, end: ExplorersEnd): Screen => {
  const m = t().explorers
  const isBest = keepExplorersBest(end.depth)
  const buttons = [h('button', { class: 'btn selected', type: 'button' }, m.end.again), h('button', { class: 'btn', type: 'button' }, m.end.lobby)]
  const nav = menu(input, buttons, (i) => (playSfx('select'), later(i === 0 ? end.again : end.lobby)), { horizontal: true })
  const el = h(
    'div',
    { class: 'screen dim profile-screen invites-screen explorers-screen' },
    h(
      'div',
      { class: 'dialog box pop profile invites explorers' },
      h('div', { class: 'dialog-title' }, m.end.title),
      h('div', { class: 'invite-body' }, h('p', { class: 'invite-note' }, m.end.reached(end.depth, m.themes[end.theme].name)), h('p', { class: 'invite-tip' }, isBest ? m.end.newBest : m.end.best(explorersBest()))),
      h('div', { class: 'buttons' }, ...buttons),
    ),
  )
  root.append(el)
  return { el, dispose: () => (nav.off(), el.remove()), dim: 0.5 }
}

import { themeOf } from '../game/explorers'
import type { Game } from '../game/types'
import { t } from '../i18n'
import { h, setText } from './dom'

/**
 * Mystery Dungeon's floor card: the screen goes black with the dungeon's name
 * and floor ("Dark Cave", "B1F") while the floor's title card holds the
 * simulation still (`updatePlaceIntro`). Part of the HUD, so it follows the
 * game's own clock (pausing on it pauses the card).
 */
export const createPlaceCard = () => {
  const name = h('b', {})
  const floor = h('span', {})
  const el = h('div', { class: 'floor-card hidden' }, name, floor)
  let shown = false
  const update = (g: Game) => {
    const inside = g.place.inside
    const show = inside?.id === 'cave' && inside.intro > 0
    if (show && inside?.id === 'cave') {
      // An Explorers descent names its theme, not a cave and its level.
      setText(name, g.explorers ? t().explorers.themes[themeOf(g.explorers.depth)].name : `${t().places.names.cave} · ${t().places.level(inside.state.level)}`)
      setText(floor, t().places.floor(g.explorers ? g.explorers.depth : inside.state.floor + 1))
    }
    if (show === shown) return
    shown = show
    el.classList.toggle('hidden', !show)
  }
  return { el, update }
}

import { playSfx } from '../engine/audio'
import type { Input } from '../engine/input'
import { CAVE_NPCS, WARES, type WareId, type WareKind } from '../data/caveShop'
import { CONSUMABLES } from '../game/consumables'
import { EVO_ITEMS, type EvoItemId } from '../data/shop'
import type { Game, Offer } from '../game/types'
import { formatPokeDollars, t } from '../i18n'
import { itemArt } from '../render/art'
import { h } from './dom'
import { hint, menu, type Screen } from './screens'
import { localPlayer } from '../game/players'

/**
 * The Cristalário's sheet (`game/caveShop.ts`, on the TM phase): the dweller's
 * wares with their ₽ and gem prices, and "leave". Buying a ware doesn't close
 * it (the table is rebuilt), so the shell shows the sheet again with what's
 * left; picks go through `onChoose` like the Move Tutor's.
 */

/** Taps this soon after the sheet opens are ignored (a thumb still on the joystick). */
const GUARD_MS = 400

const CAVE_ICONS = { lantern: 'incense', compass: 'escapeRope', fortune: 'luckIncense' } as const

const stoneOf = (id: WareId): EvoItemId | null => (id.startsWith('stone:') ? (id.slice(6) as EvoItemId) : null)

/** A ware's name, icon and what it does. */
const describe = (id: WareId) => {
  const m = t().caveShop
  const stone = stoneOf(id)
  if (stone) return { name: EVO_ITEMS[stone].name, icon: itemArt(stone), desc: m.stone }
  const kind = id as WareKind
  const w = WARES[kind]
  if ('use' in w) return { name: CONSUMABLES[w.use].name, icon: itemArt(w.use), desc: m.wares[kind] }
  return { name: m.names[w.cave], icon: itemArt(CAVE_ICONS[w.cave]), desc: m.wares[kind] }
}

const priceOf = (offer: Extract<Offer, { kind: 'ware' }>) => [offer.price > 0 ? formatPokeDollars(offer.price) : '', offer.gems > 0 ? `◆ ${offer.gems}` : ''].filter(Boolean).join(' · ')

const wareCard = (g: Game, offer: Extract<Offer, { kind: 'ware' }>, i: number) => {
  const { name, icon, desc } = describe(offer.id)
  const me = localPlayer(g)
  const broke = offer.price > g.coins || offer.gems > me.gems
  return h(
    'button',
    { class: ['offer', 'tm-card', broke && 'tm-broke'].filter(Boolean).join(' '), style: `--type:#58a8d8;--i:${i}` },
    h('span', { class: 'offer-key' }, i + 1),
    h('div', { class: 'offer-icon tm-icon' }, h('img', { src: icon, alt: '' })),
    h('div', { class: 'offer-body' }, h('div', { class: 'offer-name' }, name), h('div', { class: 'offer-desc' }, desc)),
    h('span', { class: broke ? 'tm-price broke' : 'tm-price' }, broke ? t().caveShop.broke : priceOf(offer)),
  )
}

/** The sheet for the offers on the table: wares and "leave". */
export const caveShopPick = (root: HTMLElement, input: Input, g: Game, onChoose: (offer: Offer) => void): Screen => {
  const m = t().caveShop
  const me = localPlayer(g)
  const inside = g.place.inside
  const npc = inside?.id === 'cave' && inside.state.shop ? inside.state.shop.npc : 'sableye'
  const def = CAVE_NPCS[npc]
  const buttons = me.offers.map((offer, i) => (offer.kind === 'ware' ? wareCard(g, offer, i) : h('button', { class: 'btn tm-pass' }, m.leave)))
  const cards = buttons.filter((_, i) => me.offers[i]?.kind !== 'pass')
  const pass = buttons.find((_, i) => me.offers[i]?.kind === 'pass')
  const stage = h(
    'div',
    { class: 'tm-stage' },
    h('div', { class: 'tm-head' }, h('div', {}, h('div', { class: 'dialog-title' }, m.title(def.name)), h('p', { class: 'tm-sub' }, m.lines[npc]), h('p', { class: 'tm-sub' }, m.sub))),
    h('p', { class: 'tm-wallet' }, m.wallet(formatPokeDollars(g.coins), me.gems)),
    h('div', { class: 'offers tm-offers' }, ...cards),
    pass && h('div', { class: 'buttons' }, pass),
    hint(t().tm.hintKeys, t().tm.hintTouch),
  )
  const openedAt = performance.now()
  const nav = menu(input, buttons, (i) => {
    const offer = me.offers[i]
    if (!offer || performance.now() - openedAt < GUARD_MS) return
    if (offer.kind === 'ware' && (offer.price > g.coins || offer.gems > me.gems)) return playSfx('denied')
    playSfx(offer.kind === 'ware' ? 'item' : 'select')
    onChoose(offer)
  })
  const el = h('div', { class: 'screen dim' }, h('div', { class: 'dialog box pop tm-pick tm-tutor', style: '--type:#58a8d8' }, stage))
  root.append(el)
  return { el, dispose: () => (nav.off(), el.remove()) }
}

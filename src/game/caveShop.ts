import { CAVE_NPC_IDS, CAVE_NPCS, CAVE_SHOP, WARES, type CaveNpcId, type WareId, type WareKind } from '../data/caveShop'
import { EVO_ITEM_IDS, type EvoItemId } from '../data/shop'
import { chance } from '../engine/rng'
import type { Rng } from '../engine/rng'
import { useConsumable } from './consumables'
import { burst, floatText } from './effects'
import { collectEvoItem, missingEvoItems } from './evoGate'
import { setPhase } from './players'
import type { CaveState } from './cave'
import type { Game, Offer } from './types'

/**
 * The cave's Cristalário rules: which dweller a floor has (the shiny Sableye
 * only now and then, and he sells the stones the run's Pokémon still needs),
 * the wares on the table, and buying. Wares are run-only: a consumable used on
 * the spot, a cave effect that lasts until the stairs (`CaveState.lantern`,
 * `compass`, `fortune`) or an evolution stone kept for the run
 * (`Player.evoFound`, as a boss's find). The sheet is `ui/caveShop.ts`; picks
 * go through `chooseOffer` like the Move Tutor's, so the replay records them.
 */

/** One floor's dweller and what's been sold. */
export type CaveShop = { npc: CaveNpcId; x: number; y: number; stand: number; sold: WareId[] }

/** Draws a floor's dweller from the run's rng (the shiny Sableye only by `CAVE_SHOP.shinyChance`, from `shinyFrom`). */
export const drawNpc = (rng: Rng, floor: number): CaveNpcId => {
  if (floor >= CAVE_SHOP.shinyFrom && chance(rng, CAVE_SHOP.shinyChance)) return 'sableyeShiny'
  return CAVE_NPC_IDS[Math.floor(rng() * CAVE_NPC_IDS.length)]!
}

/** A stone's gems: dearer for each evolution item the acting player already holds. */
export const stoneGems = (g: Game) => CAVE_SHOP.stone.gems + CAVE_SHOP.stone.step * g.player.evoFound.length

const stoneOf = (id: WareId): EvoItemId | null => (id.startsWith('stone:') ? (id.slice(6) as EvoItemId) : null)

const offerOf = (g: Game, id: WareId): Offer => {
  const stone = stoneOf(id)
  if (stone) return { kind: 'ware', id, price: 0, gems: stoneGems(g) }
  const w = WARES[id as WareKind]
  return { kind: 'ware', id, price: w.price, gems: w.gems }
}

/** What's on the table for the acting player: the dweller's stock, or the shiny Sableye's stones, less what was sold; then "leave". */
export const shopOffers = (g: Game, shop: CaveShop): Offer[] => {
  const npc = CAVE_NPCS[shop.npc]
  const stones = shop.npc === 'sableyeShiny'
  const ids: WareId[] = stones
    ? missingEvoItems(g).filter((id) => EVO_ITEM_IDS.includes(id)).slice(0, CAVE_SHOP.stone.stones).map((id): WareId => `stone:${id}`)
    : [...npc.stock]
  // A stone seller whose customer needs none still has the regular Sableye's things.
  const wares = (stones && ids.length === 0 ? [...CAVE_NPCS.sableye.stock] : ids).filter((id) => !shop.sold.includes(id)).slice(0, CAVE_SHOP.offers)
  return [...wares.map((id) => offerOf(g, id)), { kind: 'pass' }]
}

/** Opens the sheet for the acting player; false when nothing is left to sell. */
export const openShop = (g: Game, shop: CaveShop) => {
  const offers = shopOffers(g, shop)
  if (offers.length <= 1) return false
  setPhase(g, 'tm')
  g.player.offers = offers
  return true
}

/** Applies a cave effect to the floor. */
const applyCave = (state: CaveState, effect: 'lantern' | 'compass' | 'fortune') => {
  state[effect] = true
}

/**
 * Buys `offer` for the acting player: false (nothing changes) when they can't pay; otherwise it pays, grants it and
 * refreshes the table. The sheet stays open until "leave" or nothing is left, so it returns whether the pick closes it.
 */
export const buyWare = (g: Game, offer: Extract<Offer, { kind: 'ware' }>): { bought: boolean; close: boolean } => {
  const inside = g.place.inside
  if (inside?.id !== 'cave' || !inside.state.shop) return { bought: false, close: true }
  const p = g.player
  if (offer.price > g.coins || offer.gems > p.gems) return { bought: false, close: false }
  const state = inside.state
  g.coins -= offer.price
  p.gems -= offer.gems
  state.shop!.sold.push(offer.id)
  const stone = stoneOf(offer.id)
  if (stone) collectEvoItem(g, stone)
  else {
    const w = WARES[offer.id as WareKind]
    if ('use' in w) useConsumable(g, w.use)
    else applyCave(state, w.cave)
  }
  burst(g, p.x, p.y - 12, { colors: ['#ffffff', '#f8e8a0', '#a8e0f8', '#c890f8'], count: 18, speed: 80, ttl: 0.6, gravity: -30 })
  if (offer.price > 0) floatText(g, p.x, p.y - 30, `-₽${offer.price}`, '#f8d030')
  p.offers = shopOffers(g, state.shop!)
  return { bought: true, close: p.offers.length <= 1 }
}

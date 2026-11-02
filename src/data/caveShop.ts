import type { ConsumableId } from '../game/consumables'
import type { EvoItemId } from './shop'

/**
 * The cave's Cristalário: a room of crystals on each floor (`DungeonFloor.sanctuary`)
 * with a peaceful Pokémon selling things for this run only. Rules in
 * `game/caveShop.ts`, the sheet in `ui/caveShop.ts`, lines in `i18n` (`caveShop`).
 * Prices are run ₽ (`Game.coins`) plus gems (`Player.gems`, found in the cave:
 * ambush prizes and item spots), which the dearer wares ask for.
 */

/** A ware's effect: a consumable used on the spot, or a cave effect that lasts until the stairs. */
export type CaveEffect = 'lantern' | 'compass' | 'fortune'

export const WARES = {
  potion: { use: 'potion', price: 60, gems: 0 },
  superPotion: { use: 'superPotion', price: 120, gems: 0 },
  xAttack: { use: 'xAttack', price: 100, gems: 0 },
  xSpeed: { use: 'xSpeed', price: 100, gems: 0 },
  maxRepel: { use: 'maxRepel', price: 90, gems: 0 },
  expShare: { use: 'expShare', price: 150, gems: 0 },
  pokeFlute: { use: 'pokeFlute', price: 140, gems: 0 },
  revive: { use: 'revive', price: 150, gems: 2 },
  rareCandy: { use: 'rareCandy', price: 250, gems: 2 },
  lantern: { cave: 'lantern', price: 120, gems: 0 },
  compass: { cave: 'compass', price: 80, gems: 0 },
  fortune: { cave: 'fortune', price: 150, gems: 1 },
} as const satisfies Record<string, { use: ConsumableId; price: number; gems: number } | { cave: CaveEffect; price: number; gems: number }>

export type WareKind = keyof typeof WARES

/** A ware on the table: one of `WARES`, or an evolution stone (`stone:waterStone`, the shiny Sableye's). */
export type WareId = WareKind | `stone:${EvoItemId}`

/** The peaceful dwellers: their dex, what they sell (and what the shiny Sableye sells instead: stones). */
export const CAVE_NPCS = {
  clefairy: { dex: 35, name: 'Clefairy', stock: ['potion', 'superPotion', 'revive', 'fortune'] },
  chansey: { dex: 113, name: 'Chansey', stock: ['potion', 'superPotion', 'revive', 'expShare'] },
  shuckle: { dex: 213, name: 'Shuckle', stock: ['xAttack', 'xSpeed', 'maxRepel', 'potion'] },
  nosepass: { dex: 299, name: 'Nosepass', stock: ['compass', 'expShare', 'maxRepel', 'lantern'] },
  lunatone: { dex: 337, name: 'Lunatone', stock: ['lantern', 'compass', 'pokeFlute', 'fortune'] },
  sableye: { dex: 302, name: 'Sableye', stock: ['rareCandy', 'revive', 'fortune', 'superPotion'] },
  sableyeShiny: { dex: 302, name: 'Sableye', stock: [] },
} as const satisfies Record<string, { dex: number; name: string; stock: readonly WareKind[] }>

export type CaveNpcId = keyof typeof CAVE_NPCS

/** Regular dwellers drawn for a floor (the shiny Sableye comes only by `shinyChance`). */
export const CAVE_NPC_IDS = ['clefairy', 'chansey', 'shuckle', 'nosepass', 'lunatone', 'sableye'] as const satisfies readonly CaveNpcId[]

export const CAVE_SHOP = {
  /** Stand this many seconds in the ring (px radius) to open the sheet. */
  stand: 1.6,
  radius: 28,
  /** Wares on the table at once. */
  offers: 4,
  /** Crystals ringing the room, at least. */
  crystals: 5,
  /** Share of the floors that have a Cristalário. */
  chance: 0.6,
  /** Chance a floor from `shinyFrom` (0 is B1F) on has the shiny Sableye instead of the regular dweller. */
  shinyChance: 0.06,
  shinyFrom: 1,
  /** The shiny Sableye's stones: gems each, +`step` for every stone bought in the run; at most `stones` on the table. */
  stone: { gems: 3, step: 1, stones: 3 },
  /** Gems: how many each ambush prize and item spot leaves. */
  gemsPerPrize: 2,
  /** Lantern: px added to the light until the stairs. Fortune: share added to the ₽ picked up until the stairs. */
  lantern: 40,
  fortune: 0.5,
} as const

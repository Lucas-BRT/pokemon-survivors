import { CAVE } from './places'

/**
 * How a Pokémon lights the dark (the cave's, `render/caveDark.ts`): a profile is the radius of its light in px (`range`), how bright it is
 * at its middle from 0 to 1 (`glow`: the share of the dark it clears) and whether the Pokémon is an *emitter*, a light of its own that
 * shows on a wild one too (`emits`). Fire alone doesn't make an emitter: Torchic carries no flame to see by, so it lights like any other.
 *
 *  - `plain`: no light of its own, only what it sees by (the default);
 *  - `ember`: a small flame (Charmander's tail): a little farther than plain, mostly brighter;
 *  - `blaze`: a big fire or a body of flame: far and bright;
 *  - `spark`: electric charge or a living lamp (Pikachu, Lanturn);
 *  - `sonar`: sees without light (bats): a very wide, faint circle, and it lights nothing for others.
 *
 * A species not in `PROFILE_OF_DEX` is plain. The numbers are tuned from the debug menu's Data tab (`LIGHT_PROFILES`).
 */
export const LIGHT_PROFILES = {
  plain: { range: CAVE.light, glow: 0.75, emits: false },
  ember: { range: 84, glow: 0.9, emits: true },
  blaze: { range: 104, glow: 1, emits: true },
  spark: { range: 96, glow: 0.95, emits: true },
  sonar: { range: 220, glow: 0.35, emits: false },
} as const

export type LightProfileId = keyof typeof LIGHT_PROFILES

/** What a *wild* emitter's light is next to a player's: its radius and brightness times these. */
export const ENEMY_LIGHT = { range: 0.55, glow: 0.8, /** Emitters lit at once, nearest the screen first come, the rest stay dark. */ max: 16 } as const

const group = (profile: LightProfileId, dexes: readonly number[]) => dexes.map((dex) => [dex, profile] as const)

/** Dex numbers by profile; every evolution stage is listed on its own. */
export const PROFILE_OF_DEX: Readonly<Record<number, LightProfileId>> = Object.fromEntries([
  // A small flame: Charmander and Charmeleon, Cyndaquil and Quilava, Chimchar and Monferno, Magby, Slugma, Larvesta, Litwick.
  ...group('ember', [4, 5, 155, 156, 390, 391, 240, 218, 636, 607]),
  // Fire that lights a room: Charizard, Typhlosion, Infernape, Magmar, Magmortar, Ponyta, Rapidash, Magcargo, Lampent, Chandelure,
  // Volcarona, Flareon, Moltres, Entei, Ho-Oh, Heatran, Reshiram.
  ...group('blaze', [6, 157, 392, 126, 467, 77, 78, 219, 608, 609, 637, 136, 146, 244, 250, 485, 643]),
  // Charge and living lamps: Pichu line, Mareep line, Elekid line, Jolteon, Zapdos, Raikou, Zekrom, Magnemite line, Plusle, Minun,
  // Pachirisu, Emolga, Joltik, Galvantula, Rotom, Shinx line, Chinchou, Lanturn, Finneon, Lumineon, Volbeat, Illumise.
  ...group('spark', [172, 25, 26, 179, 180, 181, 239, 125, 466, 135, 145, 243, 644, 81, 82, 462, 311, 312, 417, 587, 595, 596, 479, 403, 404, 405, 170, 171, 456, 457, 313, 314]),
  // Bats that see by sound: the Zubat line, the Woobat line, the Noibat line.
  ...group('sonar', [41, 42, 169, 527, 528, 714, 715]),
])

/** The profile's name for a dex number (`plain` unless listed). */
export const profileIdOf = (dex: number): LightProfileId => PROFILE_OF_DEX[dex] ?? 'plain'

export const profileOf = (dex: number) => LIGHT_PROFILES[profileIdOf(dex)]

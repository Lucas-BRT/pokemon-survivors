/**
 * The cave's light sources. A source has a kind (today only the `crystal`; a new kind is a new entry here with its own rules) and at
 * least two states: *off*, where it gives no light at all, and *on*, where it lights its space (the room or corridor it stands in)
 * and has an aura. The crystal comes on when a player's foot touches it, stays on `time` s (kept full while a foot stays on it),
 * blinks for the last `blink` s and goes off; touching it again lights it afresh.
 *
 * The maths is in `game/lightSources.ts` (a space's energy and level, the fall-off with distance) and the drawing in
 * `render/caveDark.ts`; the screen-only numbers (aura radius, strength…) are `render/caveSight.ts`'s `lit`, tunable from the debug menu.
 */
export type LightKind = 'crystal'

export type LightKindDef = {
  /** What the source adds to its space's energy while on (1: as one crystal). */
  strength: number
  /** The foot that turns it on: an ellipse round its base (`rx`, `ry` px: its own foot plus the player's, so it takes a real touch). */
  rx: number
  ry: number
  /** Seconds it stays on after the last touch, and how many of the last ones it blinks. */
  time: number
  blink: number
}

export const LIGHT_KINDS = {
  crystal: { strength: 1, rx: 17, ry: 13, time: 25, blink: 3 },
} as const satisfies Record<LightKind, LightKindDef>

/**
 * How a source's light is seen from another space (`game/lightSources.ts`, `attenuation`): `remoteMin` is the share it keeps far away
 * (a source that is on stays visible), `remoteDecay` the px over which the rest fades (exponentially), and past `remoteReach` px it
 * fades out over `remoteFade` px more. Defaults of `render/caveSight.ts`'s `lit`.
 */
export const LIGHT_FIELD = { remoteMin: 0.18, remoteDecay: 220, remoteReach: 700, remoteFade: 250 } as const

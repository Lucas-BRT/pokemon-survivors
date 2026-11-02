import { type LandmarkGround, type LandmarkId, type LandmarkPiece } from '../data/landmarks'
import type { Ellipse } from '../data/terrain'
import * as dm from '../engine/dmath'

/**
 * Where each landmark's pieces stand, around its anchor (world px, before
 * `game/terrain.ts` places it in its cell). Pure: the same id and variant
 * always build the same layout, so the replay rebuilds the same map.
 */

type Pos = { x: number; y: number }

/** A piece of a landmark: what it is, where its art stands and what it blocks. `loot` marks the ones that change once the treasure is taken (the treasure itself, the ruins' glyphs). */
export type PiecePlan = { kind: LandmarkPiece; x: number; y: number; variant: number; foot: readonly Ellipse[]; loot?: true }

export type LandmarkPlan = {
  pieces: readonly PiecePlan[]
  /** Flat art under it (a floor, gravel paths), its art anchored at (x, y). */
  ground: { kind: LandmarkGround; variant: number; x: number; y: number }
  /** Where its treasure stands, if it has one: the player opens it standing close (`LANDMARK.treasureRadius`). */
  treasure: Pos | null
  /** The tunnel's mouths, west then east: the spot in front of each one. */
  mouths: readonly Pos[]
}

/** Looks of each landmark (`landmarkPlan`'s `variant`). */
export const LANDMARK_VARIANTS: Record<LandmarkId, number> = { cottage: 2, tunnel: 1, ruins: 2, camp: 2 }

/** A straight wall from (x0, y0) to (x1, y1), along x or along y, as a chain of ellipses `half` px thick. */
export const wallFoot = (x0: number, y0: number, x1: number, y1: number, half: number): Ellipse[] => {
  const len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  const n = Math.max(1, Math.ceil(len / 14))
  const step = len / n
  const along = Math.abs(x1 - x0) >= Math.abs(y1 - y0)
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n
    return along
      ? { x: x0 + (x1 - x0) * t, y: y0, rx: step / 2 + 3, ry: half }
      : { x: x0, y: y0 + (y1 - y0) * t, rx: half, ry: step / 2 + 3 }
  })
}

const ellipseAt = (x: number, y: number, rx: number, ry: number): Ellipse => ({ x, y, rx, ry })

/** A piece whose foot is one ellipse around its anchor. */
const single = (kind: LandmarkPiece, x: number, y: number, rx: number, ry: number, variant = 0): PiecePlan => ({ kind, x, y, variant, foot: [ellipseAt(x, y - 1, rx, ry)] })

/* ---------------- The cottage ---------------- */

/** The cottage's size: half its width, its depth, half its door and half a wall's thickness. */
export const COTTAGE = { half: 58, depth: 68, door: 13, wall: 4 } as const

/**
 * An abandoned cottage without its roof, anchored at its door: four stone
 * walls (the south one split by the door), a bed, a table and a crate with the
 * treasure inside; a well in the yard (left or right) and what's left of a fence.
 */
const cottage = (variant: number): LandmarkPlan => {
  const { half: W, depth: D, door, wall: T } = COTTAGE
  const side = variant % 2 === 0 ? 1 : -1
  const crate = { x: 38 * side, y: -D + 14 }
  return {
    pieces: [
      { kind: 'wallN', x: 0, y: -D, variant: 0, foot: wallFoot(-W, -D, W, -D, T) },
      { kind: 'wallW', x: -W, y: 0, variant: 0, foot: wallFoot(-W, -D, -W, 0, T) },
      { kind: 'wallE', x: W, y: 0, variant: 0, foot: wallFoot(W, -D, W, 0, T) },
      { kind: 'wallS', x: -dm.round((W + door) / 2), y: 0, variant: 0, foot: wallFoot(-W, 0, -door, 0, T) },
      { kind: 'wallS', x: dm.round((W + door) / 2), y: 0, variant: 1, foot: wallFoot(door, 0, W, 0, T) },
      { ...single('crate', crate.x, crate.y, 8, 4), loot: true },
      single('bed', -34 * side, -D + 18, 12, 6),
      single('table', -8 * side, -30, 9, 4),
      single('well', 86 * side, -24, 11, 6),
      { kind: 'fence', x: -60 * side, y: 30, variant: 0, foot: wallFoot(-80 * side, 30, -40 * side, 30, 2) },
    ],
    ground: { kind: 'floor', variant, x: 0, y: 0 },
    treasure: crate,
    mouths: [],
  }
}

/* ---------------- The tunnel ---------------- */

/** The tunnel's ridge, as terraced footprints (the map's mountains, stretched long), and its mouths. */
export const RIDGE = {
  tiers: [
    {
      foot: [
        { x: 0, y: -24, rx: 112, ry: 20 },
        { x: -80, y: -12, rx: 32, ry: 18 },
        { x: 80, y: -12, rx: 32, ry: 18 },
        { x: -30, y: -38, rx: 58, ry: 16 },
        { x: 40, y: -40, rx: 52, ry: 14 },
      ],
      h: 30,
    },
    { foot: [{ x: -12, y: -34, rx: 64, ry: 12 }, { x: 46, y: -34, rx: 30, ry: 10 }], h: 20 },
    { foot: [{ x: -16, y: -38, rx: 30, ry: 8 }], h: 14 },
  ],
  /** Mouths at the foot of its two ends (x of each). */
  mouthX: 80,
} as const

/** A long ridge with a mine tunnel through it: a timbered mouth at each end, rails out of both and a mine cart left by one. */
const tunnel = (): LandmarkPlan => {
  const mouthY = 14
  return {
    pieces: [
      { kind: 'ridge', x: 0, y: 0, variant: 0, foot: RIDGE.tiers[0].foot },
      single('cart', -40, 16, 8, 4),
    ],
    ground: { kind: 'rails', variant: 0, x: 0, y: 0 },
    treasure: null,
    mouths: [
      { x: -RIDGE.mouthX, y: mouthY },
      { x: RIDGE.mouthX, y: mouthY },
    ],
  }
}

/* ---------------- The ruins ---------------- */

/** Standing stones around the altar, and the ring they stand on. */
export const RUINS = { stones: 7, rx: 62, ry: 46, gap: 1.1 } as const

/**
 * Unown ruins: standing stones carved with glyphs in a ring open to the
 * south, a stone altar in the middle (the treasure) and broken columns outside.
 */
const ruins = (variant: number): LandmarkPlan => {
  const { stones, rx, ry, gap } = RUINS
  const span = Math.PI * 2 - gap
  const ring = Array.from({ length: stones }, (_, i) => {
    const a = Math.PI / 2 + gap / 2 + (span * i) / (stones - 1)
    return { ...single('menhir', dm.round(dm.cos(a) * rx), dm.round(dm.sin(a) * ry), 6, 3.5, (i + variant * 3) % 8), loot: true as const }
  })
  const side = variant % 2 === 0 ? 1 : -1
  const altar = { x: 0, y: -8 }
  return {
    pieces: [
      ...ring,
      { ...single('altar', altar.x, altar.y, 12, 5), loot: true },
      single('column', -88 * side, -24, 7, 4, 0),
      single('column', 90 * side, 16, 7, 4, 1),
    ],
    ground: { kind: 'plaza', variant, x: 0, y: 0 },
    treasure: altar,
    mouths: [],
  }
}

/* ---------------- The camp ---------------- */

/** An abandoned camp around a campfire: a tent, log benches and a backpack someone left behind. */
const camp = (variant: number): LandmarkPlan => {
  const s = variant % 2 === 0 ? 1 : -1
  const pack = { x: -14 * s, y: 6 }
  return {
    pieces: [
      single('campfire', 0, 0, 7, 4),
      single('tent', -38 * s, -24, 20, 8, variant),
      single('log', 4 * s, -22, 13, 4),
      single('log', 30 * s, 8, 11, 4, 1),
      { ...single('pack', pack.x, pack.y, 5, 3), loot: true },
    ],
    ground: { kind: 'camp', variant, x: 0, y: 0 },
    treasure: pack,
    mouths: [],
  }
}

/** Every landmark's layout around its anchor. */
export const landmarkPlan = (id: LandmarkId, variant: number): LandmarkPlan => {
  switch (id) {
    case 'cottage':
      return cottage(variant)
    case 'tunnel':
      return tunnel()
    case 'ruins':
      return ruins(variant)
    case 'camp':
      return camp(variant)
  }
}

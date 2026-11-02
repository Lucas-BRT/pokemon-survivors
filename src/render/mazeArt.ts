import { GRAND } from '../data/mazeEvents'
import type { BiomeId } from '../data/biomes'
import { hash2 } from '../engine/rng'
import { context2d, createCanvas } from '../engine/pixelart'
import { isHedge, mazeSitesNear, type MazeSite } from '../game/grandMaze'
import type { Game } from '../game/types'

/**
 * The big hedge maze's art: one canvas per maze, painted pixel by pixel the way the cave's floor is (`bakeCave` in `render/places.ts`):
 * every pixel is hedge or corridor (`isHedge`), a hedge's top shows where it drops to the floor with a lit lip, the face of a hedge
 * stands above each corridor's north edge, the south hedge's top reaches over the corridor's last px and the corridor floor darkens
 * toward its walls. The look (leaves, stone, ice) is the biome's skin. Painted in strips a few frames at a time so a maze coming into
 * range never hitches; what isn't painted yet simply isn't drawn.
 */

type Ctx = CanvasRenderingContext2D

/** A skin: hedge tops, the lip, the face's nine rows, the floor's colors and what scatters over it. */
type Skin = {
  top: readonly [string, string, string]
  lip: string
  face: readonly string[]
  crack: string
  edge: readonly [string, string]
  floor: readonly [string, string, string]
  speck: readonly [string, string]
  fleck: string | null
}

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const

const HEDGE: Skin = {
  top: ['#2f6a34', '#3c8040', '#285a2c'],
  lip: '#6cb25a',
  face: ['#4f9448', '#488a44', '#3f7c3c', '#376e36', '#2f6030', '#285429', '#224a24', '#1c401f', '#173619'],
  crack: '#143016',
  edge: ['#8a8470', '#a09a84'],
  floor: ['#b0aa98', '#a39d8b', '#bab4a2'],
  speck: ['#8f8977', '#cfc8b4'],
  fleck: '#f0a8c0',
}
const STONE: Skin = {
  top: ['#2a2430', '#322b3a', '#241f2a'],
  lip: '#6c6078',
  face: ['#5c5068', '#54485f', '#4c4156', '#443a4f', '#3c3348', '#342c40', '#2d2639', '#262032', '#201a2b'],
  crack: '#17121f',
  edge: ['#322a3c', '#3c3448'],
  floor: ['#40384a', '#473f52', '#3a3344'],
  speck: ['#2c2636', '#6a5e7a'],
  fleck: null,
}
const ICE: Skin = {
  top: ['#8fb4cc', '#a0c4da', '#7ea6c0'],
  lip: '#ffffff',
  face: ['#b8d8ec', '#acd0e6', '#9fc6de', '#93bcd6', '#86b0cc', '#7aa4c2', '#6e98b8', '#628cae', '#5680a4'],
  crack: '#4a74a0',
  edge: ['#c8dcec', '#d8e8f4'],
  floor: ['#e8f2fa', '#dcebf6', '#f2f8fd'],
  speck: ['#c4d8ea', '#ffffff'],
  fleck: null,
}

const SKINS: Record<BiomeId, Skin> = { meadow: HEDGE, forest: HEDGE, cave: STONE, tower: STONE, snow: ICE }

const FACE = 9
const LIP = 6
/** Px of the canvas past the box on every side: the hedge's face and the overhang above the north edge. */
const PAD = 16
const STRIP = 96

type Baked = { canvas: HTMLCanvasElement; ctx: Ctx; skin: BiomeId; done: number; wall: Uint8Array }

const baked = new WeakMap<MazeSite, Baked>()

const SIZE = (site: MazeSite) => site.side + PAD * 2

/** Paints the next strip of rows of `b`; true while rows are left. */
const paint = (site: MazeSite, b: Baked) => {
  const size = SIZE(site)
  const skin = SKINS[b.skin]
  const end = Math.min(size, b.done + STRIP)
  const img = b.ctx.createImageData(size, end - b.done)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : b.wall[y * size + x]!)
  const seed = site.seed
  for (let y = b.done; y < end; y++) {
    for (let x = 0; x < size; x++) {
      let color: string | null = null
      const wx = x + site.x - PAD
      const wy = y + site.y - PAD
      // The corridors' pixels (floor and faces) are inside the box; past it only the outer hedge, half of which lies out there, is drawn.
      const inBox = x >= PAD && y >= PAD && x < size - PAD && y < size - PAD
      if (at(x, y)) {
        // A hedge's top, lit along the lip where it drops to the corridor.
        if (!at(x, y + 1) && inBox) color = skin.lip
        else {
          const n = hash2(wx >> 2, wy >> 2, seed) * 0.6 + hash2(wx, wy, seed + 1) * 0.4
          color = n > 0.7 ? skin.top[1] : n < 0.28 ? skin.top[2] : skin.top[0]
          if (skin.fleck && hash2(wx, wy, seed + 2) > 0.992) color = skin.fleck
        }
      } else if (inBox) {
        // South hedge reaching over the corridor, then the face of a north one, then the floor.
        let south = 0
        for (let d = 1; d <= LIP + 2 && !south; d++) if (at(x, y + d)) south = d
        let k = 0
        for (let d = 1; d <= FACE && !k; d++) if (at(x, y - d)) k = d
        if (south && south < LIP - 1) color = skin.top[0]
        else if (south === LIP - 1) color = skin.lip
        else if (south === LIP) color = skin.edge[1]
        else if (south === LIP + 1) color = skin.edge[0]
        else if (k) {
          const strata = (k + Math.floor(hash2(wx >> 3, 1, seed) * 2)) % 3 === 0
          color = hash2(wx, 0, seed + 3) < 0.05 && k > 2 ? skin.crack : skin.face[Math.min(FACE - 1, k - 1 + (strata ? 1 : 0))]!
        } else if (at(x - 1, y) || at(x + 1, y) || at(x - 2, y) || at(x + 2, y)) color = skin.edge[0]
        else {
          const h = hash2(wx, wy, seed + 4)
          if (h < 0.018) color = skin.speck[0]
          else if (h > 0.992) color = skin.speck[1]
          else {
            const n = hash2((wx + 400) >> 3, (wy + 400) >> 2, seed + 5) * 0.6 + hash2((wx + 400) >> 2, (wy + 400) >> 1, seed + 6) * 0.4
            color = n > 0.62 ? skin.floor[2] : n < 0.32 ? skin.floor[1] : skin.floor[0]
          }
        }
      }
      if (!color) continue
      const [r, g, bl] = rgb(color)
      const i = ((y - b.done) * size + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = bl
      img.data[i + 3] = 255
    }
  }
  b.ctx.putImageData(img, 0, b.done)
  b.done = end
  return b.done < size
}

/** The canvas of `site` for `skin`, started on first ask and painted a strip per frame; null until it has anything to draw. */
const bakeOf = (site: MazeSite, skin: BiomeId): Baked => {
  let b = baked.get(site)
  if (b && b.skin === skin) return b
  const size = SIZE(site)
  const canvas = createCanvas(size, size)
  // Which pixels are hedge: worked out once, rows at a time with the painting would repeat neighbors' lookups.
  const wall = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) wall[y * size + x] = isHedge(site, x + site.x - PAD, y + site.y - PAD) ? 1 : 0
  b = { canvas, ctx: context2d(canvas), skin, done: 0, wall }
  baked.set(site, b)
  return b
}

/** Draws the mazes in view: their hedges and corridors, one painted strip further each frame until whole. */
export const drawMazeGround = (ctx: Ctx, g: Game, camX: number, camY: number) => {
  if (g.place.inside || g.rift.arena) return
  const { w, h } = g.view
  for (const site of mazeSitesNear(g.terrain.seed, camX + w / 2, camY + h / 2, Math.max(w, h) / 2 + GRAND.cell)) {
    const b = bakeOf(site, g.biome.id)
    if (b.done < SIZE(site) && (site.x - camX < w + 600 && site.y - camY < h + 600)) paint(site, b)
    if (b.done > 0) ctx.drawImage(b.canvas, 0, 0, SIZE(site), b.done, Math.round(site.x - PAD), Math.round(site.y - PAD), SIZE(site), b.done)
  }
}

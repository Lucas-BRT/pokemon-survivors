import { describe, expect, it } from 'vitest'
import { CAVE_SHOP } from '../data/caveShop'
import { createRng } from '../engine/rng'
import { buyWare, drawNpc, openShop, shopOffers } from './caveShop'
import { generateFloorV2 } from './dungeon'
import { createGame } from './game'
import { enterPlace } from './placeInterior'
import type { Game } from './types'

/** A run in a cave whose first floor has a Cristalário (a seed that draws one: 6 in 10 floors do). */
const inCave = (seed = 5) => {
  for (let s = seed; ; s++) {
    const g: Game = createGame('charmander', { w: 480, h: 270 }, s)
    enterPlace(g, 'cave', 0, 0)
    const inside = g.place.inside
    if (inside?.id !== 'cave') throw new Error('not in the cave')
    if (inside.state.shop) return { g, inside }
  }
}

describe('the Cristalário’s room', () => {
  it('is a regular room with crystals all round, never the start, the stairs or an ambush', () => {
    let found = 0
    for (let seed = 1; seed <= 40; seed++) {
      const f = generateFloorV2(createRng(seed), seed % 3)
      if (f.sanctuary < 0) continue
      found++
      expect([f.startRoom, f.stairsRoom, ...f.ambush]).not.toContain(f.sanctuary)
      const r = f.rooms[f.sanctuary]!
      const inside = f.sources.filter(([x, y]) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
      expect(inside.length).toBeGreaterThanOrEqual(CAVE_SHOP.sources)
    }
    expect(found).toBeGreaterThan(15)
  })
})

describe('buying', () => {
  it('takes ₽ and gems, grants the ware and keeps the sheet open on what is left', () => {
    const { g, inside } = inCave()
    const shop = inside.state.shop!
    shop.npc = 'lunatone'
    g.coins = 500
    g.player.gems = 1
    expect(openShop(g, shop)).toBe(true)
    const lantern = g.player.offers.find((o) => o.kind === 'ware' && o.id === 'lantern')!
    if (lantern.kind !== 'ware') throw new Error('not a ware')
    const before = g.coins
    expect(buyWare(g, lantern)).toEqual({ bought: true, close: false })
    expect(g.coins).toBe(before - lantern.price)
    expect(inside.state.lantern).toBe(true)
    expect(g.player.offers.some((o) => o.kind === 'ware' && o.id === 'lantern')).toBe(false)
  })

  it('refuses a ware the player cannot pay for, changing nothing', () => {
    const { g, inside } = inCave()
    const shop = inside.state.shop!
    shop.npc = 'sableye'
    g.coins = 10_000
    g.player.gems = 0
    openShop(g, shop)
    const candy = g.player.offers.find((o) => o.kind === 'ware' && o.id === 'rareCandy')!
    if (candy.kind !== 'ware') throw new Error('not a ware')
    expect(buyWare(g, candy).bought).toBe(false)
    expect(g.coins).toBe(10_000)
  })
})

describe('the shiny Sableye', () => {
  it('turns up now and then from the second floor on, never on the first', () => {
    const rng = createRng(3)
    const shiny = (floor: number) => Array.from({ length: 400 }, () => drawNpc(rng, floor)).filter((n) => n === 'sableyeShiny').length
    expect(shiny(0)).toBe(0)
    expect(shiny(1)).toBeGreaterThan(5)
    expect(shiny(1)).toBeLessThan(60)
  })

  it('sells only the stones the run’s Pokémon still needs, and a bought one is held for the run', () => {
    const { g, inside } = inCave()
    const shop = inside.state.shop!
    shop.npc = 'sableyeShiny'
    // Eevee's line wants stones; the first on the table is one it lacks.
    const eevee = createGame('eevee', { w: 480, h: 270 }, 9)
    enterPlace(eevee, 'cave', 0, 0)
    const eInside = eevee.place.inside
    if (eInside?.id !== 'cave') throw new Error('not in the cave')
    eInside.state.shop!.npc = 'sableyeShiny'
    const offers = shopOffers(eevee, eInside.state.shop!)
    const stones = offers.filter((o) => o.kind === 'ware' && o.id.startsWith('stone:'))
    expect(stones.length).toBeGreaterThan(0)
    eevee.player.gems = 10
    const first = stones[0]!
    if (first.kind !== 'ware') throw new Error('not a ware')
    openShop(eevee, eInside.state.shop!)
    expect(buyWare(eevee, first).bought).toBe(true)
    expect(eevee.player.evoFound).toContain(first.id.slice(6))
    expect(g.player.evoFound).toEqual([])
  })
})

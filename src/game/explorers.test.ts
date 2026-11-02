import { describe, expect, it } from 'vitest'
import { ENEMIES } from '../data/enemies'
import { EXPLORER_ORDER, EXPLORER_THEMES } from '../data/explorers'
import { blockOf, floorKind, floorsToBoss, guardOf, powerAt, speciesAt, themeOf } from './explorers'

describe('Explorers by depth', () => {
  it('puts a boss on every 20th floor and a sub-boss on every 5th in between', () => {
    expect([20, 40, 60].map(floorKind)).toEqual(['boss', 'boss', 'boss'])
    expect([5, 10, 15, 25, 35].map(floorKind)).toEqual(Array(5).fill('subboss'))
    for (let d = 1; d <= 100; d++) expect(floorKind(d) === 'boss').toBe(d % 20 === 0)
  })

  it('changes the theme after each boss, the three in order and then around again', () => {
    expect([1, 20, 21, 40, 41, 60, 61, 80].map(themeOf)).toEqual(['field', 'field', 'forest', 'forest', 'cave', 'cave', 'field', 'field'])
    expect(blockOf(21)).toBe(1)
  })

  it('names the guard of boss and sub-boss floors only', () => {
    expect(guardOf(5)).toBe(EXPLORER_THEMES.field.subboss)
    expect(guardOf(20)).toBe(EXPLORER_THEMES.field.boss)
    expect(guardOf(45)).toBe(EXPLORER_THEMES.cave.subboss)
    expect(guardOf(7)).toBeNull()
  })

  it('never makes a special floor of a guarded one, and gives every kind a floor in the first block', () => {
    const kinds = new Set(Array.from({ length: 20 }, (_, i) => floorKind(i + 1)))
    for (const k of ['normal', 'subboss', 'boss', 'rest', 'market', 'hall', 'corridor'] as const) expect(kinds.has(k), k).toBe(true)
  })

  it('grows stronger with depth and with each lap of the themes', () => {
    expect(powerAt(1)).toBe(1)
    expect(powerAt(30)).toBeGreaterThan(powerAt(10))
    expect(powerAt(61)).toBeGreaterThan(powerAt(60) + 0.4)
  })

  it('lets species in from their floor of the block, and every theme has some from the first', () => {
    for (const id of EXPLORER_ORDER) expect(EXPLORER_THEMES[id].species.some(([, from]) => from === 1)).toBe(true)
    expect(speciesAt(1)).not.toContain('butterfree')
    expect(speciesAt(14)).toContain('butterfree')
    expect(speciesAt(21)).not.toContain('pinsir')
  })

  it('counts the floors to the boss', () => {
    expect([1, 19, 20, 21].map(floorsToBoss)).toEqual([20, 2, 1, 20])
  })

  it('uses species the game has', () => {
    for (const id of EXPLORER_ORDER) {
      const t = EXPLORER_THEMES[id]
      for (const [s] of t.species) expect(ENEMIES[s], s).toBeDefined()
      expect(ENEMIES[t.boss]).toBeDefined()
      expect(ENEMIES[t.subboss]).toBeDefined()
    }
  })
})

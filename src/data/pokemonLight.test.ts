import { describe, expect, it } from 'vitest'
import { LIGHT_PROFILES, PROFILE_OF_DEX, profileOf } from './pokemonLight'

describe('Pokémon light', () => {
  it('keeps every glow in 0..1 (the dark multiplies by 1 − glow)', () => {
    for (const p of Object.values(LIGHT_PROFILES)) expect(p.glow).toBeGreaterThan(0), expect(p.glow).toBeLessThanOrEqual(1)
  })

  it('lights Charmander a little farther and brighter than plain, and Torchic like any other', () => {
    expect(profileOf(4).range).toBeGreaterThan(profileOf(0).range)
    expect(profileOf(4).glow).toBeGreaterThan(profileOf(0).glow)
    expect(profileOf(255)).toBe(LIGHT_PROFILES.plain)
  })

  it('gives bats the widest, faintest light and no emission', () => {
    const zubat = profileOf(41)
    for (const p of Object.values(LIGHT_PROFILES)) expect(zubat.range).toBeGreaterThanOrEqual(p.range)
    expect(zubat.glow).toBeLessThan(LIGHT_PROFILES.plain.glow)
    expect(zubat.emits).toBe(false)
  })

  it('lists each dex number once', () => {
    expect(Object.keys(PROFILE_OF_DEX).length).toBe(new Set(Object.keys(PROFILE_OF_DEX)).size)
  })
})

import { describe, expect, it } from 'vitest'
import { parseDebug } from './debugStart'

describe('parseDebug', () => {
  it('is null without ?debug and reads a place, floor, Pokémon and ₽ with it', () => {
    expect(parseDebug('?loja')).toBeNull()
    expect(parseDebug('?debug=cave&floor=2&mon=charmander&coins=5000&shop=sableyeShiny&gems=4')).toEqual({ place: 'cave', floor: 2, mon: 'charmander', coins: 5000, gems: 4, shop: 'sableyeShiny', lab: null, maze: false, biome: null })
  })

  it('reads the light lab’s room: size, crystals inside and in the door tile', () => {
    expect(parseDebug('?debug=cave&lab=4:2:1')?.lab).toEqual({ size: 4, inside: 2, doors: 1, vertical: 0 })
  })

  it('drops unknown places and bad numbers', () => {
    expect(parseDebug('?debug=nowhere&floor=-3&coins=abc')).toEqual({ place: null, floor: 0, mon: null, coins: 0, gems: 0, shop: null, lab: null, maze: false, biome: null })
  })
})

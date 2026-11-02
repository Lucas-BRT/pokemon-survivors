import { describe, expect, it } from 'vitest'
import { CAVE } from '../data/places'
import { levelOf } from './caveLevel'

describe('a cave room’s level of light', () => {
  const n = CAVE.lit

  it('starts at the floor with no crystal, grows with each and never passes the ceiling', () => {
    const area = n.aref
    expect(levelOf(0, area, n)).toBeCloseTo(n.floor)
    let before = levelOf(0, area, n)
    for (let e = 1; e <= 30; e++) {
      const now = levelOf(e, area, n)
      expect(now).toBeGreaterThan(before)
      expect(now).toBeLessThanOrEqual(n.max)
      before = now
    }
  })

  it('takes more crystals to light a bigger room', () => {
    expect(levelOf(1, n.aref * 12, n)).toBeLessThan(levelOf(1, n.aref, n))
  })
})

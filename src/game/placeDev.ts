import { caveLevel } from '../data/caveLevels'
import { GRAVEYARD, PLACE_IDS, type PlaceId } from '../data/places'
import { descendCave } from './cave'
import { openEntrance } from './placeEntrance'
import { enterPlace } from './placeInterior'
import type { Game } from './types'

/**
 * Dev-console shortcuts for staging places (`ps.place()`, `ps.enter()`,
 * `ps.floor()`, `ps.spirits()`). Wired in `main.ts` for dev builds only.
 */
export const placeDevTools = (game: () => Game | undefined) => {
  const playing = (fn: (g: Game) => unknown) => {
    const g = game()
    return g ? fn(g) : 'ps: start a run first'
  }
  const known = (id: PlaceId | undefined) => id === undefined || PLACE_IDS.includes(id)
  return {
    /** Opens a place's entrance 70 px to the right of the player (`ps.place('graveyard')`; the director's pick without an argument). */
    place: (id?: PlaceId, level?: number) =>
      known(id) ? playing((g) => openEntrance(g, id, { x: Math.round(g.player.x + 70), y: Math.round(g.player.y) }, level)) : `Places: ${PLACE_IDS.join(', ')}`,
    /** Steps straight into a place (`ps.enter('sky')` works for any Pokémon). */
    enter: (id: PlaceId, level?: number) => (known(id) ? playing((g) => enterPlace(g, id, Math.round(g.player.x), Math.round(g.player.y), level)) : `Places: ${PLACE_IDS.join(', ')}`),
    /** In the cave, takes the stairs now (`ps.floor()`), as many times as given; the last floor is the treasure chamber. */
    floor: (times = 1) =>
      playing((g) => {
        for (let i = 0; i < times; i++) {
          const inside = g.place.inside
          if (inside?.id !== 'cave' || inside.state.floor >= caveLevel(inside.state.level).floors) break
          descendCave(g, inside)
        }
        return g.place.inside?.id === 'cave' ? g.place.inside.state.floor : 'ps: not in the cave'
      }),
    /** In the graveyard, sets the keystone's spirits (one short of waking Spiritomb by default). */
    spirits: (n = GRAVEYARD.spirits - 1) =>
      playing((g) => {
        const inside = g.place.inside
        if (inside?.id !== 'graveyard') return 'ps: not in the graveyard'
        inside.state.spirits = Math.min(GRAVEYARD.spirits, n)
        if (inside.state.spirits >= GRAVEYARD.spirits) inside.state.wakeAt = inside.age
        return inside.state.spirits
      }),
  }
}

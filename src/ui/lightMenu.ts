import { applyLab, type Lab } from '../game/debugStart'
import type { Game } from '../game/types'
import { LIT_DEFAULTS, lit, retune, roomLevel, type Lit } from '../render/caveSight'
import { h } from './dom'

/**
 * Dev-only light menu for the cave (F4, or `ps.light()`): sliders for every number
 * of the cave's light (`CAVE.lit` and the screen-only extras in `render/caveSight.ts`),
 * changed live, a room lab to rebuild the floor around a room of a given size and crystals,
 * and "Copiar" to get the values to paste into `CAVE.lit`. Never in a production build.
 */

type Control = { key: keyof Lit; label: string; min: number; max: number; step: number }

const CONTROLS: readonly Control[] = [
  { key: 'black', label: 'Escuridão (alpha do preto)', min: 0.5, max: 1, step: 0.005 },
  { key: 'floor', label: 'L0: piso da sala visitada', min: 0, max: 0.6, step: 0.01 },
  { key: 'max', label: 'Teto de luz de uma sala (L máx)', min: 0.1, max: 1, step: 0.05 },
  { key: 'e0', label: 'E0: energia p/ 63% (sala média)', min: 0.1, max: 3, step: 0.05 },
  { key: 'gamma', label: 'γ: diluição por tamanho', min: 0, max: 1.5, step: 0.05 },
  { key: 'aref', label: 'Área de referência (px²)', min: 4000, max: 30000, step: 500 },
  { key: 'door', label: 'Peso do cristal de porta', min: 0, max: 1, step: 0.05 },
  { key: 'reach', label: 'Alcance do cristal de porta (px)', min: 20, max: 240, step: 4 },
  { key: 'spill', label: 'Alcance da luz que sai da porta (px)', min: 0, max: 160, step: 4 },
  { key: 'allOn', label: 'Todos os cristais ativos (0/1, lab)', min: 0, max: 1, step: 1 },
  { key: 'rim', label: 'Luz na borda da rocha (px)', min: 0, max: 24, step: 1 },
  { key: 'fade', label: 'Velocidade da transição (1/s)', min: 0.5, max: 12, step: 0.5 },
  { key: 'auraGain', label: 'Força da aura do cristal', min: 0, max: 1, step: 0.05 },
  { key: 'aura', label: 'Aura do cristal (px)', min: 10, max: 90, step: 2 },
  { key: 'playerScale', label: 'Luz do jogador (escala)', min: 0.2, max: 2, step: 0.05 },
]

let panel: HTMLElement | null = null

/** Opens or closes the menu over the game. */
export const toggleLightMenu = (game: () => Game | undefined) => {
  if (panel) {
    panel.remove()
    panel = null
    return
  }
  const lab: Lab = { size: 4, inside: 1, doors: 0, vertical: 0 }
  const status = h('div', { class: 'lm-status' })
  const showStatus = () => (status.textContent = `L de uma sala média com 1 cristal: ${roomLevel(1, lit.aref).toFixed(2)} · com 0: ${roomLevel(0, lit.aref).toFixed(2)}`)
  const rows = CONTROLS.map((c) => {
    const value = h('span', { class: 'lm-value' }, String(lit[c.key]))
    const input = h('input', { type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(lit[c.key]) }) as HTMLInputElement
    input.addEventListener('input', () => {
      lit[c.key] = Number(input.value)
      value.textContent = input.value
      retune()
      showStatus()
    })
    return h('label', { class: 'lm-row' }, h('span', {}, c.label), value, input)
  })
  const number = (key: 'size' | 'inside' | 'doors', label: string) => {
    const input = h('input', { type: 'number', min: '0', step: key === 'size' ? '0.5' : '1', value: String(lab[key]) }) as HTMLInputElement
    input.addEventListener('input', () => (lab[key] = Math.max(0, Number(input.value) || 0)))
    return h('label', { class: 'lm-lab' }, h('span', {}, label), input)
  }
  const apply = h('button', { type: 'button' }, 'Aplicar sala')
  apply.addEventListener('click', () => {
    const g = game()
    status.textContent = g && applyLab(g, { ...lab, size: lab.size || 1 }) ? 'Sala aplicada (B2F do laboratório).' : 'Entre na caverna primeiro (?debug=cave).'
  })
  const reset = h('button', { type: 'button' }, 'Restaurar')
  reset.addEventListener('click', () => {
    Object.assign(lit, LIT_DEFAULTS)
    retune()
    panel?.remove()
    panel = null
    toggleLightMenu(game)
  })
  const copy = h('button', { type: 'button' }, 'Copiar')
  copy.addEventListener('click', () => {
    const text = JSON.stringify(lit, null, 2)
    console.log(text)
    void navigator.clipboard?.writeText(text)
    status.textContent = 'Valores copiados (e no console).'
  })
  panel = h(
    'div',
    {
      id: 'light-menu',
      style:
        'position:fixed;left:8px;top:8px;z-index:99999;width:300px;max-height:96vh;overflow:auto;padding:8px;background:rgba(10,10,20,.88);color:#fff;font:12px monospace;border:1px solid #58a8d8;border-radius:6px',
    },
    h('div', { style: 'font-weight:bold;margin-bottom:6px' }, 'Luz da caverna (F4 fecha)'),
    ...rows,
    h('div', { style: 'margin:8px 0 4px;font-weight:bold' }, 'Sala do laboratório'),
    number('size', 'Tamanho (x sala média)'),
    number('inside', 'Cristais dentro'),
    number('doors', 'Cristais na porta'),
    h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, apply, reset, copy),
    status,
  )
  const style = h('style', {}, '#light-menu .lm-row{display:grid;grid-template-columns:1fr auto;gap:0 6px;margin:3px 0}#light-menu .lm-row input{grid-column:1/3;width:100%}#light-menu .lm-lab{display:flex;justify-content:space-between;margin:2px 0}#light-menu .lm-lab input{width:70px}#light-menu button{flex:1;padding:3px;cursor:pointer}#light-menu .lm-status{margin-top:6px;color:#9fd}')
  panel.append(style)
  document.body.append(panel)
  showStatus()
}

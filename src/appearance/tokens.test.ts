import css from './tokens.css?raw'
import { expect, it } from 'vitest'
function luminance(hex: string) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
}
for (const [index, block] of [...css.matchAll(/:root(?:\[data-theme='dark'\])?\s*\{([^}]+)\}/g)].slice(0, 2).entries()) {
  it(`${index === 0 ? 'light' : 'dark'} semantic foregrounds, disabled labels and meaningful boundaries meet contrast`, () => {
    const tokens = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]+)/g)].map(m => [m[1], m[2]]))
    for (const [fg, bg, minimum] of [
      ['foreground', 'surface', 4.5], ['muted', 'surface', 4.5], ['muted', 'subtle', 4.5], ['primary', 'selected', 4.5],
      ['on-accent', 'primary-solid', 4.5], ['disabled', 'disabled-surface', 4.5], ['control', 'surface', 3], ['focus', 'surface', 3],
      ['on-accent', 'primary-hover', 4.5], ['foreground', 'hover', 4.5], ['muted', 'hover', 4.5],
      ...['primary', 'success', 'warning', 'danger', 'info'].map(role => [role, 'hover', 4.5]),
      ...['success', 'warning', 'danger', 'info'].map(role => ['on-accent', `${role}-hover`, 4.5]),
      ...['success', 'warning', 'danger', 'info'].map(role => [role, `${role}-soft`, 4.5]),
    ] as [string, string, number][]) {
      const [low, high] = [luminance(tokens[fg]), luminance(tokens[bg])].sort((a, b) => a - b)
      expect((high + .05) / (low + .05), `${fg} on ${bg}`).toBeGreaterThanOrEqual(minimum)
    }
  })
}

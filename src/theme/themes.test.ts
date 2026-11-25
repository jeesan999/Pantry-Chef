import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, THEMES, contrast, contrastProblems, derivedVars } from './themes'

describe('themes', () => {
  it('every theme defines every colour the app uses, in both modes', () => {
    const keys = Object.keys(THEMES[0].light)
    for (const t of THEMES) for (const m of ['light', 'dark'] as const) expect(Object.keys(t[m]).sort()).toEqual([...keys].sort())
    for (const [fg, bg] of CONTRAST_PAIRS) expect(keys).toEqual(expect.arrayContaining([fg, bg]))
  })
  it('all text stays readable: every pair meets its contrast minimum in every theme and mode', () => {
    expect(contrastProblems()).toEqual([])
  })
  it('contrast maths', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
  it('chart and nutrient colours are readable on cards', () => {
    for (const t of THEMES) for (const m of ['light', 'dark'] as const) {
      const v = derivedVars(t, m)
      for (const k of ['--chart-series', '--nut-energy', '--nut-protein', '--nut-carbs', '--nut-fat']) {
        expect(contrast(v[k], v['--color-white']), `${t.name} ${m} ${k}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { expectedByNow, fitStatus, gaugeStatus, limitStatus } from './fit'

describe('status words', () => {
  it('day totals against targets', () => {
    expect(fitStatus(2600, 2690).label).toBe('on target')
    expect(fitStatus(2200, 2690).label).toBe('slightly below')
    expect(fitStatus(1500, 2690).label).toBe('significantly below')
    expect(fitStatus(3100, 2690).label).toBe('above')
    expect(limitStatus(31, 30).label).toBe('above the limit')
    expect(limitStatus(30, 30).label).toBe('within the limit')
  })
  it('gauges: early in the day a small total is on track, not low; over is never hidden', () => {
    expect(gaugeStatus(600, 2690, expectedByNow(['07:00', '11:00', '14:00', '18:00'], '08:00'))).toBe('on track')
    expect(gaugeStatus(600, 2690, 1)).toBe('low')
    expect(gaugeStatus(2600, 2690)).toBe('reached')
    expect(gaugeStatus(3000, 2690)).toBe('over')
    expect(gaugeStatus(0, 2690, 0)).toBe('on track')
    expect(expectedByNow(['07:00', '11:00', '14:00', '18:00'], '15:00')).toBe(0.75)
  })
})

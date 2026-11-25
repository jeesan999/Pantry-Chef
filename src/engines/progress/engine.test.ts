import { describe, expect, it } from 'vitest'
import { addDays } from '../nutrition/engine'
import {
  dailyWeights,
  expectedRate,
  fmtRate,
  goalProgress,
  goalStartKg,
  hasRate,
  monthlySummary,
  rollingAverage,
  suggestAdjustment,
  weeklyRate,
  type DayValue,
} from './engine'

/** n daily weigh-ins from start, changing by perWeek, with a fixed +-0.3 kg zig-zag. */
const series = (start: string, n: number, startKg: number, perWeek: number, every = 1): DayValue[] =>
  Array.from({ length: n }, (_, i) => i * every).map((d, i) => ({ date: addDays(start, d), kg: Math.round((startKg + (perWeek / 7) * d + (i % 2 ? 0.3 : -0.3)) * 100) / 100 }))

describe('daily weights and rolling average', () => {
  it('prefers morning weigh-ins; otherwise averages the day', () => {
    const d = dailyWeights([
      { date: '2026-11-01', weightKg: 81, timeOfDay: 'evening' },
      { date: '2026-11-01', weightKg: 80, timeOfDay: 'morning' },
      { date: '2026-11-02', weightKg: 80.6, timeOfDay: 'evening' },
      { date: '2026-11-02', weightKg: 81, timeOfDay: 'midday' },
    ])
    expect(d).toEqual([{ date: '2026-11-01', kg: 80 }, { date: '2026-11-02', kg: 80.8 }])
  })

  it('7-day average needs 3 weigh-ins in the window; gaps leave it empty', () => {
    const d: DayValue[] = [
      { date: '2026-11-01', kg: 80 }, { date: '2026-11-02', kg: 81 }, { date: '2026-11-03', kg: 82 },
      { date: '2026-11-20', kg: 79 }, // 17 days later: alone in its window
    ]
    expect(rollingAverage(d).map((x) => x.avg)).toEqual([null, null, 81, null])
  })
})

describe('weekly rate', () => {
  it('recovers the slope through noise', () => {
    const r = weeklyRate(series('2026-10-01', 28, 82, -0.5))
    expect(hasRate(r) && r.kgPerWeek).toBeCloseTo(-0.5, 1)
  })
  it('needs 8 weigh-ins over 14 days', () => {
    const few = weeklyRate(series('2026-10-01', 5, 82, -0.5))
    expect(hasRate(few)).toBe(false)
    if (!hasRate(few)) expect(few.why).toMatch(/you have 5 over 4 days/)
    const short = weeklyRate(series('2026-10-01', 10, 82, -0.5)) // 9 days
    expect(hasRate(short)).toBe(false)
    expect(hasRate(weeklyRate(series('2026-10-01', 8, 82, -0.5, 2)))).toBe(true) // every 2nd day, 14 days
  })
  it('uses only the last 28 days', () => {
    const d = [...series('2026-08-01', 30, 90, 1), ...series('2026-10-01', 28, 82, -0.3)]
    const r = weeklyRate(d)
    expect(hasRate(r) && r.kgPerWeek).toBeCloseTo(-0.3, 1)
  })
})

describe('monthly summary', () => {
  it('averages per month, newest first, with change across a year boundary', () => {
    const rows = monthlySummary(
      [{ date: '2025-12-10', kg: 82 }, { date: '2025-12-20', kg: 81 }, { date: '2026-01-05', kg: 80 }],
      [{ date: '2026-01-06', waistCm: 90 }, { date: '2026-01-20', waistCm: 89 }],
    )
    expect(rows).toEqual([
      { month: '2026-01', avgKg: 80, changeKg: -1.5, avgWaistCm: 89.5, weighIns: 1 },
      { month: '2025-12', avgKg: 81.5, changeKg: null, avgWaistCm: null, weighIns: 2 },
    ])
  })
})

describe('goal progress', () => {
  it('percent, kg to go and a finish date when heading the right way', () => {
    const g = goalProgress({ startKg: 85, currentKg: 82, targetKg: 79, kgPerWeek: -0.5, asOf: '2026-11-26' })
    expect(g).toMatchObject({ pct: 50, toGoKg: 3, direction: 'down', reached: false, eta: '2027-01-07' })
  })
  it('no finish date when the trend is flat or the wrong way; reached when past it', () => {
    expect(goalProgress({ startKg: 85, currentKg: 84, targetKg: 79, kgPerWeek: 0.2, asOf: '2026-11-26' }).eta).toBeNull()
    expect(goalProgress({ startKg: 85, currentKg: 84, targetKg: 79, kgPerWeek: null, asOf: '2026-11-26' }).eta).toBeNull()
    expect(goalProgress({ startKg: 75, currentKg: 78.2, targetKg: 78, kgPerWeek: 0.2, asOf: '2026-11-26' })).toMatchObject({ reached: true, pct: 100, toGoKg: 0, direction: 'up' })
  })
  it('starts from the 7-day average when the goal began', () => {
    const rolled = rollingAverage(series('2026-10-01', 20, 82, 0))
    expect(goalStartKg({ startDate: '2026-10-10' }, rolled, 90)).toBeCloseTo(rolled[9].avg!, 5)
    expect(goalStartKg({ startDate: '2026-09-01' }, rolled, 90)).toBe(rolled[0].kg)
    expect(goalStartKg({ startDate: '2026-12-01' }, [], 90)).toBe(90)
  })
})

describe('maintenance calibration', () => {
  const base = { targetKcal: 2290, maintenanceKcal: 2690, bmrKcal: 1735, activityFactor: 1.55, daysSinceGoalChange: 30 }
  it('expected rate from the energy gap', () => {
    expect(expectedRate(2290, 2690)).toBeCloseTo(-0.364, 3)
    expect(fmtRate(-0.364)).toBe('losing 0.4 kg/week')
    expect(fmtRate(0.02)).toBe('steady')
  })
  it('flat weight on a deficit: maintenance was overestimated, so lower it', () => {
    const rate = weeklyRate(series('2026-10-01', 28, 82, 0))
    const a = suggestAdjustment({ ...base, rate })
    expect(a.kind).toBe('suggest')
    if (a.kind === 'suggest') {
      expect(a.newActivityFactor).toBeLessThan(1.55)
      expect(a.maintenanceAfter).toBeLessThan(2690)
      expect(a.kcalChange).toBeGreaterThanOrEqual(-269) // capped at 10%
      expect(a.reason).toMatch(/expected losing 0\.4 kg\/week/)
    }
  })
  it('losing faster than expected: maintenance was underestimated, so raise it', () => {
    const a = suggestAdjustment({ ...base, rate: weeklyRate(series('2026-10-01', 28, 82, -1)) })
    expect(a.kind === 'suggest' && a.newActivityFactor).toBeGreaterThan(1.55)
  })
  it('a big gap is capped at 10% a step, and the factor stays in 1.2-2.0 on 0.025 steps', () => {
    const a = suggestAdjustment({ ...base, rate: weeklyRate(series('2026-10-01', 28, 82, 1.5)) })
    if (a.kind !== 'suggest') throw new Error('expected a suggestion')
    expect(a.maintenanceAfter).toBeGreaterThanOrEqual(2690 * 0.9 - 10)
    expect((a.newActivityFactor * 40) % 1).toBeCloseTo(0, 6)
    const low = suggestAdjustment({ ...base, activityFactor: 1.2, maintenanceKcal: 2080, rate: weeklyRate(series('2026-10-01', 28, 82, 1.5)) })
    expect(low.kind).toBe('none')
  })
  it('no suggestion: on track, too soon after a goal change, or not enough data', () => {
    expect(suggestAdjustment({ ...base, rate: weeklyRate(series('2026-10-01', 28, 82, -0.36)) })).toMatchObject({ kind: 'none', why: expect.stringMatching(/matches/) })
    expect(suggestAdjustment({ ...base, daysSinceGoalChange: 5, rate: weeklyRate(series('2026-10-01', 28, 82, 0)) })).toMatchObject({ kind: 'none', why: expect.stringMatching(/5 days ago/) })
    expect(suggestAdjustment({ ...base, rate: weeklyRate(series('2026-10-01', 3, 82, 0)) })).toMatchObject({ kind: 'none', why: expect.stringMatching(/Need 8/) })
  })
})

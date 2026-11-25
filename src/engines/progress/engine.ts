/**
 * Engine F (Progress): weight trend, monthly summaries, goal progress and maintenance
 * calibration from the real trend. Pure functions; dates are 'YYYY-MM-DD'.
 * Assumes meals were eaten roughly as planned (eaten meals are not logged yet).
 */
import type { BodyGoal, WaistMeasurement, WeightMeasurement } from '../../db/types'
import { addDays } from '../nutrition/engine'

export const KCAL_PER_KG = 7700

export interface DayValue { date: string; kg: number }

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp

/** One value per day: the morning weigh-in if there is one (averaged if several), else the day's average. */
export function dailyWeights(ms: Pick<WeightMeasurement, 'date' | 'weightKg' | 'timeOfDay'>[]): DayValue[] {
  const by = new Map<string, Array<Pick<WeightMeasurement, 'weightKg' | 'timeOfDay'>>>()
  for (const m of ms) by.set(m.date, [...(by.get(m.date) ?? []), m])
  return [...by.entries()]
    .map(([date, xs]) => {
      const morning = xs.filter((x) => x.timeOfDay === 'morning')
      const use = morning.length ? morning : xs
      return { date, kg: use.reduce((s, x) => s + x.weightKg, 0) / use.length }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Average of the weigh-ins in the `window` days ending on each weigh-in date. A day gets a value only
 * when its window holds at least `minPoints` weigh-ins, so sparse stretches don't swing the line.
 */
export function rollingAverage(daily: DayValue[], window = 7, minPoints = 3): Array<DayValue & { avg: number | null }> {
  return daily.map((d, i) => {
    const from = addDays(d.date, -(window - 1))
    const xs: number[] = []
    for (let j = i; j >= 0 && daily[j].date >= from; j--) xs.push(daily[j].kg)
    return { ...d, avg: xs.length >= minPoints ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null }
  })
}

export interface Rate { kgPerWeek: number; points: number; spanDays: number; from: string; to: string }
export type RateResult = Rate | { none: true; points: number; spanDays: number; why: string }

/** Least-squares trend over the last `days` days. Needs `minPoints` weigh-ins spread over `minSpan` days. */
export function weeklyRate(daily: DayValue[], opts: { days?: number; asOf?: string; minPoints?: number; minSpan?: number } = {}): RateResult {
  const days = opts.days ?? 28
  const minPoints = opts.minPoints ?? 8
  const minSpan = opts.minSpan ?? 14
  const asOf = opts.asOf ?? daily[daily.length - 1]?.date
  if (!asOf) return { none: true, points: 0, spanDays: 0, why: `Need ${minPoints} weigh-ins over ${minSpan} days (you have none yet).` }
  const from = addDays(asOf, -(days - 1))
  const xs = daily.filter((d) => d.date >= from && d.date <= asOf)
  const spanDays = xs.length ? dayNum(xs[xs.length - 1].date) - dayNum(xs[0].date) : 0
  if (xs.length < minPoints || spanDays < minSpan) {
    return { none: true, points: xs.length, spanDays, why: `Need ${minPoints} weigh-ins over ${minSpan} days (you have ${xs.length} over ${spanDays} day${spanDays === 1 ? '' : 's'}).` }
  }
  const t = xs.map((d) => dayNum(d.date))
  const mt = t.reduce((s, x) => s + x, 0) / t.length
  const my = xs.reduce((s, d) => s + d.kg, 0) / xs.length
  let num = 0
  let den = 0
  xs.forEach((d, i) => {
    num += (t[i] - mt) * (d.kg - my)
    den += (t[i] - mt) ** 2
  })
  return { kgPerWeek: round((num / den) * 7, 3), points: xs.length, spanDays, from: xs[0].date, to: xs[xs.length - 1].date }
}

export const hasRate = (r: RateResult): r is Rate => !('none' in r)

export interface MonthRow { month: string; avgKg: number | null; changeKg: number | null; avgWaistCm: number | null; weighIns: number }

/** Per month (newest first): average weight, change from the previous month with data, average waist. */
export function monthlySummary(daily: DayValue[], waists: Pick<WaistMeasurement, 'date' | 'waistCm'>[]): MonthRow[] {
  const months = new Set([...daily.map((d) => d.date.slice(0, 7)), ...waists.map((w) => w.date.slice(0, 7))])
  const rows = [...months].sort().map((month) => {
    const ws = daily.filter((d) => d.date.startsWith(month))
    const wa = waists.filter((w) => w.date.startsWith(month))
    return {
      month,
      avgKg: ws.length ? round(ws.reduce((s, d) => s + d.kg, 0) / ws.length) : null,
      changeKg: null as number | null,
      avgWaistCm: wa.length ? round(wa.reduce((s, w) => s + w.waistCm, 0) / wa.length, 1) : null,
      weighIns: ws.length,
    }
  })
  let prev: number | null = null
  for (const r of rows) {
    if (r.avgKg !== null) {
      r.changeKg = prev === null ? null : round(r.avgKg - prev)
      prev = r.avgKg
    }
  }
  return rows.reverse()
}

export interface GoalProgress { startKg: number; currentKg: number; targetKg: number; pct: number; toGoKg: number; eta: string | null; direction: 'down' | 'up'; reached: boolean }

/** Progress from the starting weight to the target; finish date at the current rate when it is heading the right way. */
export function goalProgress(args: { startKg: number; currentKg: number; targetKg: number; kgPerWeek: number | null; asOf: string }): GoalProgress {
  const { startKg, currentKg, targetKg, kgPerWeek, asOf } = args
  const direction = targetKg < startKg ? 'down' : 'up'
  const total = Math.abs(targetKg - startKg)
  const done = direction === 'down' ? startKg - currentKg : currentKg - startKg
  const toGo = direction === 'down' ? currentKg - targetKg : targetKg - currentKg
  const reached = toGo <= 0
  const pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 100
  let eta: string | null = null
  const rightWay = kgPerWeek !== null && (direction === 'down' ? kgPerWeek < -0.05 : kgPerWeek > 0.05)
  if (!reached && rightWay) {
    const weeks = toGo / Math.abs(kgPerWeek!)
    if (weeks <= 260) eta = addDays(asOf, Math.ceil(weeks * 7))
  }
  return { startKg: round(startKg), currentKg: round(currentKg), targetKg, pct: round(pct, 0), toGoKg: round(Math.max(0, toGo)), eta, direction, reached }
}

/** What the targets imply: kg per week from the daily energy gap against maintenance. */
export const expectedRate = (targetKcal: number, maintenanceKcal: number) => round(((targetKcal - maintenanceKcal) * 7) / KCAL_PER_KG, 3)

export interface Adjustment { kind: 'suggest'; newActivityFactor: number; maintenanceBefore: number; maintenanceAfter: number; kcalChange: number; actual: number; expected: number; reason: string }
export type AdjustmentResult = Adjustment | { kind: 'none'; why: string }

const STEP_CAP = 0.1 // never move maintenance more than 10% at once
const NOISE_KCAL = 100

/**
 * Recalibrate maintenance from the real trend. If weight moves faster or slower than the targets
 * imply, true maintenance differs by (actual − expected) × 7700 / 7 kcal a day. The goal's energy
 * adjustment % is left alone; only the activity factor (the estimate of what you burn) changes.
 */
export function suggestAdjustment(args: {
  rate: RateResult
  targetKcal: number
  maintenanceKcal: number
  bmrKcal: number
  activityFactor: number
  daysSinceGoalChange: number
}): AdjustmentResult {
  const { rate, targetKcal, maintenanceKcal, bmrKcal, activityFactor, daysSinceGoalChange } = args
  if (!hasRate(rate)) return { kind: 'none', why: rate.why }
  if (daysSinceGoalChange < 14) return { kind: 'none', why: `Your goal changed ${daysSinceGoalChange} day${daysSinceGoalChange === 1 ? '' : 's'} ago. Give it at least 2 weeks before judging the trend.` }
  const expected = expectedRate(targetKcal, maintenanceKcal)
  const gapKcal = ((rate.kgPerWeek - expected) * KCAL_PER_KG) / 7 // + means you burn less than estimated
  if (Math.abs(gapKcal) < NOISE_KCAL) {
    return { kind: 'none', why: `Your trend (${fmtRate(rate.kgPerWeek)}) matches what your targets expect (${fmtRate(expected)}). No change needed.` }
  }
  const capped = Math.max(-STEP_CAP * maintenanceKcal, Math.min(STEP_CAP * maintenanceKcal, gapKcal))
  const rawAf = (maintenanceKcal - capped) / bmrKcal
  const newAf = Math.round(Math.min(2.0, Math.max(1.2, rawAf)) * 40) / 40 // 0.025 steps
  if (newAf === activityFactor) return { kind: 'none', why: 'Your estimated maintenance is already at its limit for this calibration.' }
  const after = Math.round((bmrKcal * newAf) / 10) * 10
  return {
    kind: 'suggest',
    newActivityFactor: newAf,
    maintenanceBefore: maintenanceKcal,
    maintenanceAfter: after,
    kcalChange: after - maintenanceKcal,
    actual: rate.kgPerWeek,
    expected,
    reason: `Your ${Math.round(rate.spanDays / 7)}-week trend is ${fmtRate(rate.kgPerWeek)}; your targets expected ${fmtRate(expected)}. Estimated maintenance ${maintenanceKcal.toLocaleString('en-AU')} → ${after.toLocaleString('en-AU')} kcal (assumes you ate to plan).`,
  }
}

export function fmtRate(kgPerWeek: number): string {
  if (Math.abs(kgPerWeek) < 0.05) return 'steady'
  return `${kgPerWeek < 0 ? 'losing' : 'gaining'} ${Math.abs(kgPerWeek).toFixed(1)} kg/week`
}

/** The weight to measure goal progress from: the 7-day average when the goal began, else the first weigh-in after it, else a fallback. */
export function goalStartKg(goal: Pick<BodyGoal, 'startDate'>, rolled: Array<DayValue & { avg: number | null }>, fallbackKg: number): number {
  const before = rolled.filter((d) => d.date <= goal.startDate)
  const at = before[before.length - 1]
  if (at) return at.avg ?? at.kg
  const after = rolled.find((d) => d.date >= goal.startDate)
  return after ? after.kg : fallbackKg
}

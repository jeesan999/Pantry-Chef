/** How totals compare with targets. Shared by Today, Plan and Chef so every screen says the same thing. */

export type Tone = 'leaf' | 'ember' | 'red' | 'stone' | 'sky'

/** A planned or eaten total against a day target (or a minimum). */
export function fitStatus(value: number, target: number): { tone: Tone; label: string } {
  if (target <= 0) return { tone: 'stone', label: '' }
  const r = value / target
  if (r > 1.1) return { tone: 'red', label: 'above' }
  if (r >= 0.9) return { tone: 'leaf', label: 'on target' }
  if (r >= 0.75) return { tone: 'ember', label: 'slightly below' }
  return { tone: 'ember', label: 'significantly below' }
}

/** A nutrient with an upper limit (saturated fat, added sugar). */
export function limitStatus(value: number, max: number): { tone: Tone; label: string } {
  if (max <= 0) return { tone: 'stone', label: '' }
  return value > max ? { tone: 'red', label: 'above the limit' } : { tone: 'leaf', label: 'within the limit' }
}

export type GaugeStatus = 'low' | 'on track' | 'reached' | 'over'

/**
 * Progress through the day. `expected` is the share of the day's food that should be eaten by now
 * (1 for a whole-day plan or a past day): early in the day a small total is "on track", not "low".
 */
export function gaugeStatus(value: number, target: number, expected = 1): GaugeStatus {
  if (target <= 0) return 'on track'
  const r = value / target
  if (r > 1.1) return 'over'
  if (r >= 0.95) return 'reached'
  return r >= Math.max(0, expected - 0.15) * 0.85 ? 'on track' : 'low'
}

export const GAUGE_TONE: Record<GaugeStatus, Tone> = { low: 'ember', 'on track': 'sky', reached: 'leaf', over: 'red' }

/** Share of the day's meals whose time has passed (each meal counts a quarter). */
export function expectedByNow(slotTimes: string[], now: string): number {
  if (!slotTimes.length) return 1
  return slotTimes.filter((t) => t <= now).length / slotTimes.length
}

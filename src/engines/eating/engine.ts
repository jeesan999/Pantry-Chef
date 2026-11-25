/**
 * Engine G (Eating): what comes out of the pantry when a meal is eaten, split into the share eaten
 * (consumed) and the share not eaten (thrown out as leftover). Pure; the caller writes the ledger.
 * Lots past their use-by on the day are never used. Missing stock never blocks: it is reported.
 */
import type { Nutrients, QtyUnit } from '../../db/types'
import { addNutrients, emptyNutrients, scaleNutrients } from '../../lib/nutrition'

export interface LotInfo {
  id: string
  productId: string
  foodId?: string
  unit: QtyUnit
  remaining: number
  unitCostCents: number // per g / ml / unit of the lot
  expiryDate?: string
  expiryKind?: 'use_by' | 'best_before'
  gramsPerUnit?: number
  densityGPerMl?: number
}

/** One ingredient line at the portion cooked. grams is the raw weight when known. */
export interface Need { label: string; foodId?: string; productId?: string; grams: number | null; qty: number; unit: QtyUnit; ingredientId?: string }

export interface Take { lotId: string; qty: number } // in the lot's unit
export interface LineResult { label: string; consume: Take[]; discard: Take[]; coveredFrac: number; missing: { amount: number; unit: QtyUnit } | null }
export interface EatPlan { lines: LineResult[]; eatenCostCents: number; wasteCostCents: number }

const usable = (l: LotInfo, date: string) => !l.expiryDate || l.expiryKind === 'best_before' || l.expiryDate >= date

/** Grams in one unit of a lot; null when unknown (that lot can't serve a weight). */
function gramsPerLotUnit(l: LotInfo): number | null {
  if (l.unit === 'g') return 1
  if (l.unit === 'ml') return l.densityGPerMl ?? 1
  return l.gramsPerUnit ?? null
}

/** Take a need from lots (soonest-dated first), changing `left` in place. Returns takes in lot units and the share covered. */
export function allocate(need: Need, lots: LotInfo[], left: Map<string, number>, date: string): { takes: Take[]; coveredFrac: number } {
  const byGrams = need.grams !== null
  const total = byGrams ? need.grams! : need.qty
  if (!(total > 0)) return { takes: [], coveredFrac: 1 }
  const candidates = lots
    .filter((l) => (need.productId && l.productId === need.productId) || (need.foodId && l.foodId === need.foodId))
    .filter((l) => usable(l, date) && (left.get(l.id) ?? l.remaining) > 1e-9)
    .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') || a.id.localeCompare(b.id))
  let want = total
  const takes: Take[] = []
  for (const l of candidates) {
    if (want <= 1e-9) break
    const rem = left.get(l.id) ?? l.remaining
    // amount the lot can give, in the need's basis (grams, or the need's own unit)
    const per = byGrams ? gramsPerLotUnit(l) : l.unit === need.unit ? 1 : null
    if (!per) continue
    const give = Math.min(rem * per, want)
    const qty = give / per
    takes.push({ lotId: l.id, qty })
    left.set(l.id, rem - qty)
    want -= give
  }
  return { takes, coveredFrac: (total - Math.max(0, want)) / total }
}

/** Everything cooked comes out of the pantry; the eaten fraction is consumed and the rest is waste. */
export function planEating(needs: Need[], lots: LotInfo[], fraction: number, date: string): EatPlan {
  const left = new Map<string, number>()
  const cost = new Map(lots.map((l) => [l.id, l.unitCostCents]))
  let eatenCostCents = 0
  let wasteCostCents = 0
  const lines: LineResult[] = needs.map((n) => {
    const { takes, coveredFrac } = allocate(n, lots, left, date)
    const consume: Take[] = []
    const discard: Take[] = []
    for (const t of takes) {
      const eat = t.qty * fraction
      const waste = t.qty - eat
      if (eat > 1e-9) consume.push({ lotId: t.lotId, qty: eat })
      if (waste > 1e-9) discard.push({ lotId: t.lotId, qty: waste })
      eatenCostCents += eat * (cost.get(t.lotId) ?? 0)
      wasteCostCents += waste * (cost.get(t.lotId) ?? 0)
    }
    const short = 1 - coveredFrac
    const missing = short > 1e-6 ? (n.grams !== null ? { amount: n.grams * short, unit: 'g' as QtyUnit } : { amount: n.qty * short, unit: n.unit }) : null
    return { label: n.label, consume, discard, coveredFrac, missing }
  })
  return { lines, eatenCostCents: Math.round(eatenCostCents), wasteCostCents: Math.round(wasteCostCents) }
}

/** Grams of a quick food: g as is, ml through density, items through grams per item. Null when an item has no weight. */
export function quickGrams(quantity: number, unit: QtyUnit, food?: { gramsPerUnit?: number; densityGPerMl?: number }): number | null {
  if (unit === 'g') return quantity
  if (unit === 'ml') return quantity * (food?.densityGPerMl ?? 1)
  return food?.gramsPerUnit ? quantity * food.gramsPerUnit : null
}

/** Nutrition of an amount, from values per 100 g. */
export const quickNutrition = (per100g: Nutrients, grams: number): Nutrients => scaleNutrients(per100g, grams / 100)

export interface DayLog { slots: Array<{ slot: string; plannedMealId?: string }>; eaten: Array<{ plannedMealId?: string; nutrition: Nutrients; undone: boolean }> }

/** Totals of what was eaten, and whether every planned meal (breakfast included) was eaten or skipped. */
export function dayIntake(log: DayLog): { totals: Nutrients; complete: boolean; logged: number } {
  const live = log.eaten.filter((e) => !e.undone)
  const totals = live.reduce((t, e) => addNutrients(t, e.nutrition), emptyNutrients())
  const done = new Set(live.map((e) => e.plannedMealId).filter(Boolean))
  const complete = log.slots.length > 0 && log.slots.every((s) => s.plannedMealId && done.has(s.plannedMealId))
  return { totals, complete, logged: live.length }
}

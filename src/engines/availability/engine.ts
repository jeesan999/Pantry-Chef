/**
 * Engine H (Availability): is each ingredient of a recipe in the pantry? Read-only: it uses the same
 * lot matching as eating (soonest-dated first, never past use-by) on a copy, so nothing is deducted.
 */
import type { QtyUnit } from '../../db/types'
import { allocate, type LotInfo, type Need } from '../eating/engine'

export type IngStatus = 'available' | 'partial' | 'missing'
export interface IngredientCheck {
  index: number // position in the needs list
  ingredientId?: string // the recipe line, for substitutions
  label: string
  foodId?: string
  productId?: string
  required: { amount: number; unit: QtyUnit }
  have: { amount: number; unit: QtyUnit }
  short: { amount: number; unit: QtyUnit } // what's still needed (0 when available)
  status: IngStatus
  datedSoon: boolean // covered partly by stock dated within 2 days
}
export interface AvailabilitySummary { lines: IngredientCheck[]; available: number; partial: number; missing: number; allAvailable: boolean; coverage: number }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

export function checkAvailability(needs: Need[], lots: LotInfo[], date: string): AvailabilitySummary {
  const left = new Map<string, number>()
  const byId = new Map(lots.map((l) => [l.id, l]))
  let weightNeed = 0
  let weightHave = 0
  const lines = needs.map((n, index): IngredientCheck => {
    const { takes, coveredFrac } = allocate(n, lots, left, date)
    const byGrams = n.grams !== null
    const unit: QtyUnit = byGrams ? 'g' : n.unit
    const total = byGrams ? n.grams! : n.qty
    const have = total * coveredFrac
    const status: IngStatus = coveredFrac >= 0.999 ? 'available' : coveredFrac > 0.001 ? 'partial' : 'missing'
    // weight the overall coverage by grams where known (a pinch of salt shouldn't count like a steak)
    const w = byGrams ? Math.max(n.grams!, 5) : 50
    weightNeed += w
    weightHave += w * coveredFrac
    const soon = takes.some((t) => {
      const l = byId.get(t.lotId)
      return !!l?.expiryDate && l.expiryDate <= addDays(date, 2)
    })
    return {
      index,
      ingredientId: n.ingredientId,
      label: n.label,
      foodId: n.foodId,
      productId: n.productId,
      required: { amount: total, unit },
      have: { amount: have, unit },
      short: { amount: Math.max(0, total - have), unit },
      status,
      datedSoon: soon,
    }
  })
  const count = (s: IngStatus) => lines.filter((l) => l.status === s).length
  return {
    lines,
    available: count('available'),
    partial: count('partial'),
    missing: count('missing'),
    allAvailable: lines.every((l) => l.status === 'available'),
    coverage: weightNeed ? weightHave / weightNeed : 1,
  }
}

/** "4 ingredients available · 1 missing · shopping needed" */
export function summaryText(s: AvailabilitySummary): string {
  const parts = [`${s.available} available`]
  if (s.partial) parts.push(`${s.partial} partly available`)
  if (s.missing) parts.push(`${s.missing} missing`)
  return `${parts.join(' · ')}${s.allAvailable ? ' · everything is in your pantry' : ' · shopping needed'}`
}

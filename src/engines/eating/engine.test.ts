import { describe, expect, it } from 'vitest'
import type { Nutrients } from '../../db/types'
import { allocate, dayIntake, planEating, quickGrams, quickNutrition, type LotInfo } from './engine'

const lot = (id: string, extra: Partial<LotInfo>): LotInfo => ({ id, productId: 'p', foodId: 'chicken', unit: 'g', remaining: 500, unitCostCents: 1, ...extra })
const N = (kcal: number, p = 0): Nutrients => ({ energyKj: 0, energyKcal: kcal, proteinG: p, fatG: 0, satFatG: 0, carbsG: 0, sugarsG: 0, addedSugarG: 0, fibreG: 0, sodiumMg: 0 })

describe('allocate', () => {
  it('takes from the soonest-dated lot first, then the next', () => {
    const lots = [lot('late', { expiryDate: '2026-12-10' }), lot('soon', { expiryDate: '2026-11-28', remaining: 100 })]
    const r = allocate({ label: 'Chicken', foodId: 'chicken', grams: 250, qty: 250, unit: 'g' }, lots, new Map(), '2026-11-26')
    expect(r.takes).toEqual([{ lotId: 'soon', qty: 100 }, { lotId: 'late', qty: 150 }])
    expect(r.coveredFrac).toBe(1)
  })
  it('skips lots past their use-by; best-before still counts', () => {
    const lots = [lot('off', { expiryDate: '2026-11-20', expiryKind: 'use_by' }), lot('bb', { expiryDate: '2026-11-20', expiryKind: 'best_before', remaining: 50 })]
    const r = allocate({ label: 'Chicken', foodId: 'chicken', grams: 200, qty: 200, unit: 'g' }, lots, new Map(), '2026-11-26')
    expect(r.takes).toEqual([{ lotId: 'bb', qty: 50 }])
    expect(r.coveredFrac).toBe(0.25)
  })
  it('converts grams to items and millilitres', () => {
    const eggs = lot('eggs', { foodId: 'egg', unit: 'unit', remaining: 12, gramsPerUnit: 50 })
    expect(allocate({ label: 'Eggs', foodId: 'egg', grams: 100, qty: 2, unit: 'unit' }, [eggs], new Map(), '2026-11-26').takes).toEqual([{ lotId: 'eggs', qty: 2 }])
    const milk = lot('milk', { foodId: 'milk', unit: 'ml', remaining: 1000, densityGPerMl: 1.03 })
    expect(allocate({ label: 'Milk', foodId: 'milk', grams: 206, qty: 200, unit: 'ml' }, [milk], new Map(), '2026-11-26').takes[0].qty).toBeCloseTo(200, 6)
  })
  it('items without a known weight are matched by unit only', () => {
    const avo = lot('avo', { foodId: 'avo', unit: 'unit', remaining: 3 })
    expect(allocate({ label: 'Avocado', foodId: 'avo', grams: null, qty: 1, unit: 'unit' }, [avo], new Map(), '2026-11-26').takes).toEqual([{ lotId: 'avo', qty: 1 }])
    expect(allocate({ label: 'Avocado', foodId: 'avo', grams: 150, qty: 1, unit: 'unit' }, [avo], new Map(), '2026-11-26').coveredFrac).toBe(0)
  })
})

describe('planEating', () => {
  it('half eaten: everything cooked leaves the pantry, half consumed and half waste, with costs', () => {
    const lots = [lot('c', { remaining: 1000, unitCostCents: 1.04 })]
    const p = planEating([{ label: 'Chicken', foodId: 'chicken', grams: 200, qty: 200, unit: 'g' }], lots, 0.5, '2026-11-26')
    expect(p.lines[0].consume).toEqual([{ lotId: 'c', qty: 100 }])
    expect(p.lines[0].discard).toEqual([{ lotId: 'c', qty: 100 }])
    expect(p.eatenCostCents).toBe(104)
    expect(p.wasteCostCents).toBe(104)
  })
  it('two lines of the same food share the stock; missing stock is reported, not blocking', () => {
    const lots = [lot('c', { remaining: 250 })]
    const p = planEating([
      { label: 'Chicken', foodId: 'chicken', grams: 200, qty: 200, unit: 'g' },
      { label: 'More chicken', foodId: 'chicken', grams: 100, qty: 100, unit: 'g' },
      { label: 'Rice', foodId: 'rice', grams: 150, qty: 150, unit: 'g' },
    ], lots, 1, '2026-11-26')
    expect(p.lines[1].coveredFrac).toBe(0.5)
    expect(p.lines[1].missing).toEqual({ amount: 50, unit: 'g' })
    expect(p.lines[2]).toMatchObject({ consume: [], coveredFrac: 0, missing: { amount: 150, unit: 'g' } })
  })
  it('skipped (0) consumes nothing and wastes everything cooked', () => {
    const p = planEating([{ label: 'Chicken', foodId: 'chicken', grams: 200, qty: 200, unit: 'g' }], [lot('c', {})], 0, '2026-11-26')
    expect(p.lines[0].consume).toEqual([])
    expect(p.lines[0].discard).toEqual([{ lotId: 'c', qty: 200 }])
  })
})

describe('quick foods and the day', () => {
  it('grams from items, ml and g; nutrition per 100 g', () => {
    expect(quickGrams(2, 'unit', { gramsPerUnit: 50 })).toBe(100)
    expect(quickGrams(1, 'unit', {})).toBeNull()
    expect(quickGrams(250, 'ml', { densityGPerMl: 1.03 })).toBeCloseTo(257.5)
    expect(quickNutrition(N(89, 1.1), 120)).toMatchObject({ energyKcal: 106.8 })
  })
  it('day totals ignore undone; complete only when every planned meal was eaten or skipped', () => {
    const slots = [{ slot: 'breakfast', plannedMealId: 'b' }, { slot: 'lunch', plannedMealId: 'l' }]
    const eaten = [{ plannedMealId: 'b', nutrition: N(600), undone: false }, { plannedMealId: 'l', nutrition: N(700), undone: true }, { nutrition: N(100), undone: false }]
    expect(dayIntake({ slots, eaten })).toMatchObject({ totals: { energyKcal: 700 }, complete: false, logged: 2 })
    eaten[1].undone = false
    expect(dayIntake({ slots, eaten }).complete).toBe(true)
    expect(dayIntake({ slots: [{ slot: 'breakfast' }], eaten }).complete).toBe(false) // breakfast never planned
  })
})

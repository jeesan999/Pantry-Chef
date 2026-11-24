import { describe, expect, it } from 'vitest'
import type { Expense, Food, GroceryPurchase, Product } from '../../db/types'
import {
  budgetStatus,
  buildPriceIndex,
  costOf,
  dayCost,
  periodLabel,
  periodRange,
  perServing,
  priceSummary,
  proteinPerDollar,
  recipeCostEstimate,
  shiftPeriod,
  spendByCategory,
  spendByPeriod,
  spendByProductCategory,
  spendByStore,
  type PricePoint,
} from './engine'

const exp = (date: string, amountCents: number, store = 'Woolworths', category = 'Groceries'): Expense => ({ id: `${date}-${amountCents}`, date, amountCents, store, category })
const prod = (id: string, foodId?: string, category = 'Meat'): Product => ({ id, foodId, name: id, category, storage: 'fridge', createdAt: '' })
const food = (id: string, extra: Partial<Food> = {}): Food => ({
  id, name: id, source: 'interim', state: 'raw', ediblePortion: 1, updatedAt: '',
  per100g: { energyKj: 0, energyKcal: 0, proteinG: 0, fatG: 0, satFatG: 0, carbsG: 0, sugarsG: 0, addedSugarG: 0, fibreG: 0, sodiumMg: 0 },
  ...extra,
})

describe('periods', () => {
  it('weeks run Monday to Sunday', () => {
    expect(periodRange('week', '2026-11-26')).toEqual({ start: '2026-11-23', end: '2026-11-29' }) // Thursday
    expect(periodRange('week', '2026-11-29')).toEqual({ start: '2026-11-23', end: '2026-11-29' }) // Sunday
  })
  it('months end on the right day, including leap February', () => {
    expect(periodRange('month', '2026-11-15')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(periodRange('month', '2028-02-10').end).toBe('2028-02-29')
    expect(periodRange('month', '2026-02-10').end).toBe('2026-02-28')
    expect(periodRange('year', '2026-06-01')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })
  it('shifts across month and year boundaries', () => {
    expect(shiftPeriod('month', '2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftPeriod('month', '2026-01-15', -1)).toBe('2025-12-01')
    expect(shiftPeriod('week', '2026-12-31', 1)).toBe('2027-01-04')
    expect(shiftPeriod('year', '2026-05-05', -1)).toBe('2025-01-01')
  })
  it('labels', () => {
    expect(periodLabel('week', '2026-11-26')).toBe('23 Nov – 29 Nov')
    expect(periodLabel('month', '2026-11-26')).toBe('Nov 2026')
    expect(periodLabel('year', '2026-11-26')).toBe('2026')
  })
})

describe('spending', () => {
  const xs = [exp('2026-11-23', 1000), exp('2026-11-29', 500, 'Coles'), exp('2026-11-30', 700, 'Coles', 'Household'), exp('2026-12-01', 300)]
  it('week buckets are days and leave out other weeks', () => {
    const b = spendByPeriod(xs, 'week', '2026-11-25')
    expect(b.map((x) => x.cents)).toEqual([1000, 0, 0, 0, 0, 0, 500])
  })
  it('month buckets are Monday-weeks clipped to the month', () => {
    const b = spendByPeriod(xs, 'month', '2026-11-25')
    expect(b[0]).toMatchObject({ start: '2026-11-01', end: '2026-11-01' }) // Sunday 1 Nov
    expect(b[b.length - 1]).toMatchObject({ start: '2026-11-30', end: '2026-11-30', cents: 700 })
    expect(b.reduce((s, x) => s + x.cents, 0)).toBe(2200)
  })
  it('year buckets are months', () => {
    const b = spendByPeriod(xs, 'year', '2026-01-01')
    expect(b).toHaveLength(12)
    expect(b[10].cents).toBe(2200)
    expect(b[11].cents).toBe(300)
  })
  it('splits by store and category, largest first, with shares', () => {
    expect(spendByStore(xs).map((s) => [s.name, s.cents])).toEqual([['Woolworths', 1300], ['Coles', 1200]])
    const cat = spendByCategory(xs)
    expect(cat[0]).toMatchObject({ name: 'Groceries', cents: 1800 })
    expect(cat[1].pct).toBeCloseTo(28, 0)
  })
  it('product categories are net of line discounts', () => {
    const products = new Map([['p1', prod('p1', undefined, 'Meat')], ['p2', prod('p2', undefined, 'Fruit')]])
    const gp = (productId: string, priceCents: number, discountCents: number): GroceryPurchase => ({ id: productId, productId, store: 'W', date: '2026-11-23', quantity: 1, unit: 'unit', priceCents, discountCents })
    expect(spendByProductCategory([gp('p1', 1300, 260), gp('p2', 400, 0)], products).map((s) => [s.name, s.cents])).toEqual([['Meat', 1040], ['Fruit', 400]])
  })
})

describe('budgets', () => {
  const b = { limitCents: 10000, alertPct: 80 }
  it('ok, warn at the alert %, over above the limit', () => {
    expect(budgetStatus(b, 7999).level).toBe('ok')
    expect(budgetStatus(b, 8000).level).toBe('warn')
    expect(budgetStatus(b, 10000).level).toBe('warn')
    expect(budgetStatus(b, 10001)).toMatchObject({ level: 'over', remainingCents: -1 })
  })
})

describe('prices and meal costs', () => {
  const products = new Map([['chicken', prod('chicken', 'food:chicken')], ['eggs', prod('eggs', 'food:egg')], ['milk', prod('milk', 'food:milk')]])
  const points: PricePoint[] = [
    { productId: 'chicken', date: '2026-11-01', store: 'W', cents: 1200, unit: 'g' },
    { productId: 'chicken', date: '2026-11-20', store: 'C', cents: 1040, unit: 'g' },
    { productId: 'eggs', date: '2026-11-20', store: 'W', cents: 50, unit: 'unit' },
    { productId: 'milk', date: '2026-11-20', store: 'W', cents: 150, unit: 'ml' },
  ]
  const idx = buildPriceIndex(points, products)
  const foods = new Map([['food:egg', food('food:egg', { gramsPerUnit: 50 })], ['food:chicken', food('food:chicken')]])

  it('latest price per product and per food', () => {
    expect(idx.byProduct.get('chicken')).toMatchObject({ cents: 1040, store: 'C' })
    expect(idx.byFood.get('food:chicken')!.cents).toBe(1040)
    expect(priceSummary(points.filter((p) => p.productId === 'chicken'))).toEqual({ latest: 1040, lowest: 1040, average: 1120, count: 2 })
  })

  it('converts units: g at per-kg, items at per-item, grams of an item food through grams per item', () => {
    expect(costOf(250, 'g', idx.byFood.get('food:chicken')!)).toBeCloseTo(260)
    expect(costOf(3, 'unit', idx.byFood.get('food:egg')!)).toBe(150)
    expect(costOf(100, 'g', idx.byFood.get('food:egg')!, foods.get('food:egg'))).toBe(100) // 2 eggs
    expect(costOf(100, 'g', idx.byFood.get('food:egg')!)).toBeNull() // no weight per egg
    expect(costOf(500, 'ml', idx.byFood.get('food:milk')!)).toBe(75)
  })

  it('recipe cost is partial when a price is missing, never made up; optional ingredients skipped', () => {
    const c = recipeCostEstimate([
      { label: 'Chicken', foodId: 'food:chicken', quantity: 500, unit: 'g' },
      { label: 'Eggs', foodId: 'food:egg', quantity: 2, unit: 'unit' },
      { label: 'Rice', foodId: 'food:rice', quantity: 200, unit: 'g' },
      { label: 'Parsley', foodId: 'food:parsley', quantity: 5, unit: 'g', optional: true },
    ], idx, foods)
    expect(c.cents).toBe(520 + 100)
    expect(c.missing).toEqual(['Rice'])
    expect(c.coveredPct).toBeCloseTo(66.7, 0)
    expect(perServing(c, 2, 1.5).cents).toBe(465)
    expect(dayCost([c, { cents: 100, coveredPct: 100, missing: [] }])).toMatchObject({ cents: 720, missing: ['Rice'] })
  })

  it('protein per dollar', () => {
    // 31 g protein / 100 g at $10.40/kg = 310 g per $10.40 ≈ 29.8 g/$
    expect(proteinPerDollar(31, idx.byFood.get('food:chicken')!)).toBeCloseTo(29.8, 1)
    // eggs: 12.6 g/100 g, 50 g each at 50c → $10/kg → 12.6 g/$
    expect(proteinPerDollar(12.6, idx.byFood.get('food:egg')!, foods.get('food:egg'))).toBeCloseTo(12.6, 5)
    expect(proteinPerDollar(12.6, idx.byFood.get('food:egg')!)).toBeNull()
  })
})

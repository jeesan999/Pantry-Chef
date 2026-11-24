/**
 * Engine C (Cost): pure functions over expenses, purchases and price history.
 * No database access. Money is whole cents; dates are 'YYYY-MM-DD'; weeks start Monday.
 */
import type { Budget, Expense, Food, GroceryPurchase, Product, QtyUnit } from '../../db/types'
import { addDays, mondayOf } from '../nutrition/engine'

export type PeriodKind = 'week' | 'month' | 'year'
export interface Range { start: string; end: string } // inclusive

// ---------- Periods ----------

const pad = (n: number) => String(n).padStart(2, '0')
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based

export function periodRange(kind: PeriodKind, anchor: string): Range {
  const [y, m] = anchor.split('-').map(Number)
  if (kind === 'week') {
    const start = mondayOf(anchor)
    return { start, end: addDays(start, 6) }
  }
  if (kind === 'month') return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` }
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

/** The same kind of period, n periods before (negative) or after (positive) the one containing anchor. */
export function shiftPeriod(kind: PeriodKind, anchor: string, n: number): string {
  if (kind === 'week') return addDays(mondayOf(anchor), 7 * n)
  const [y, m] = anchor.split('-').map(Number)
  if (kind === 'year') return `${y + n}-01-01`
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`
}

export const inRange = (date: string, r: Range) => date >= r.start && date <= r.end

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function periodLabel(kind: PeriodKind, anchor: string): string {
  const r = periodRange(kind, anchor)
  if (kind === 'year') return r.start.slice(0, 4)
  if (kind === 'month') return `${MONTHS[Number(r.start.slice(5, 7)) - 1]} ${r.start.slice(0, 4)}`
  const d = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`
  return `${d(r.start)} – ${d(r.end)}`
}

// ---------- Spending ----------

export interface Bucket { key: string; label: string; start: string; end: string; cents: number }

/** Chart buckets for a period: days of a week, Monday-weeks of a month (clipped to it), months of a year. */
export function spendByPeriod(expenses: Pick<Expense, 'date' | 'amountCents'>[], kind: PeriodKind, anchor: string): Bucket[] {
  const r = periodRange(kind, anchor)
  const buckets: Bucket[] = []
  if (kind === 'week') {
    for (let i = 0; i < 7; i++) {
      const d = addDays(r.start, i)
      buckets.push({ key: d, label: WEEKDAYS[i], start: d, end: d, cents: 0 })
    }
  } else if (kind === 'month') {
    let s = r.start
    while (s <= r.end) {
      const sunday = addDays(mondayOf(s), 6)
      const e = sunday < r.end ? sunday : r.end
      buckets.push({ key: s, label: `${Number(s.slice(8, 10))}–${Number(e.slice(8, 10))}`, start: s, end: e, cents: 0 })
      s = addDays(e, 1)
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      const pr = periodRange('month', `${r.start.slice(0, 4)}-${pad(m)}-01`)
      buckets.push({ key: pr.start, label: MONTHS[m - 1], ...pr, cents: 0 })
    }
  }
  for (const e of expenses) {
    if (!inRange(e.date, r)) continue
    const b = buckets.find((x) => e.date >= x.start && e.date <= x.end)
    if (b) b.cents += e.amountCents
  }
  return buckets
}

export const total = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0)

export interface Share { name: string; cents: number; pct: number }

function shares(entries: Iterable<[string, number]>): Share[] {
  const list = [...entries].filter(([, c]) => c !== 0)
  const sum = list.reduce((s, [, c]) => s + c, 0)
  return list
    .map(([name, cents]) => ({ name, cents, pct: sum > 0 ? (cents / sum) * 100 : 0 }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
}

function groupSum<T>(xs: T[], key: (x: T) => string, cents: (x: T) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + cents(x))
  return m
}

export const spendByStore = (expenses: Expense[]) => shares(groupSum(expenses, (e) => e.store || 'Unknown', (e) => e.amountCents))
export const spendByCategory = (expenses: Expense[]) => shares(groupSum(expenses, (e) => e.category || 'Other', (e) => e.amountCents))

/** Food spending by product category, net of line discounts (whole-receipt discounts are not split out). */
export function spendByProductCategory(purchases: GroceryPurchase[], products: Map<string, Product>): Share[] {
  return shares(groupSum(purchases, (p) => products.get(p.productId)?.category ?? 'Other', (p) => p.priceCents - p.discountCents))
}

// ---------- Budgets ----------

export type BudgetLevel = 'ok' | 'warn' | 'over'
export interface BudgetStatus { spentCents: number; limitCents: number; remainingCents: number; pct: number; level: BudgetLevel }

export function budgetStatus(budget: Pick<Budget, 'limitCents' | 'alertPct'>, spentCents: number): BudgetStatus {
  const pct = budget.limitCents > 0 ? (spentCents / budget.limitCents) * 100 : 0
  const level: BudgetLevel = spentCents > budget.limitCents ? 'over' : pct >= budget.alertPct ? 'warn' : 'ok'
  return { spentCents, limitCents: budget.limitCents, remainingCents: budget.limitCents - spentCents, pct, level }
}

// ---------- Prices ----------

/** A price observation, in cents per kg (g), per litre (ml) or per item (unit). */
export interface PricePoint { productId: string; date: string; store: string; cents: number; unit: QtyUnit }
export interface UnitPrice { cents: number; unit: QtyUnit; date: string; store: string }

const newer = (a: PricePoint, b: PricePoint) => a.date > b.date || (a.date === b.date && a.cents < b.cents)

/** Latest price per product, and per food (the most recent price among products linked to that food). */
export interface PriceIndex { byProduct: Map<string, UnitPrice>; byFood: Map<string, UnitPrice> }

export function buildPriceIndex(points: PricePoint[], products: Map<string, Product>): PriceIndex {
  const latest = new Map<string, PricePoint>()
  for (const p of points) {
    const cur = latest.get(p.productId)
    if (!cur || newer(p, cur)) latest.set(p.productId, p)
  }
  const byProduct = new Map<string, UnitPrice>()
  const byFood = new Map<string, UnitPrice>()
  const foodPoint = new Map<string, PricePoint>()
  for (const [pid, p] of latest) {
    byProduct.set(pid, { cents: p.cents, unit: p.unit, date: p.date, store: p.store })
    const foodId = products.get(pid)?.foodId
    if (!foodId) continue
    const cur = foodPoint.get(foodId)
    if (!cur || newer(p, cur)) foodPoint.set(foodId, p)
  }
  for (const [fid, p] of foodPoint) byFood.set(fid, { cents: p.cents, unit: p.unit, date: p.date, store: p.store })
  return { byProduct, byFood }
}

export interface PriceSummary { latest: number; lowest: number; average: number; count: number }

export function priceSummary(series: PricePoint[]): PriceSummary | null {
  if (!series.length) return null
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const cs = sorted.map((p) => p.cents)
  return { latest: cs[cs.length - 1], lowest: Math.min(...cs), average: cs.reduce((s, c) => s + c, 0) / cs.length, count: cs.length }
}

/**
 * Cost in cents of an amount, given a unit price. Grams and millilitres use the per-kg/L price;
 * a per-item price converts through the food's grams per item when known. Returns null when it can't.
 */
export function costOf(qty: number, unit: QtyUnit, price: UnitPrice, food?: Pick<Food, 'gramsPerUnit' | 'densityGPerMl'>): number | null {
  if (unit === price.unit) return unit === 'unit' ? qty * price.cents : (qty / 1000) * price.cents
  // g <-> ml through density (default water-like is not assumed)
  if (unit !== 'unit' && price.unit !== 'unit') {
    const d = food?.densityGPerMl
    if (!d) return null
    const converted = unit === 'g' ? qty / d : qty * d
    return (converted / 1000) * price.cents
  }
  const gpu = food?.gramsPerUnit
  if (!gpu) return null
  if (unit === 'unit') return price.unit === 'g' ? ((qty * gpu) / 1000) * price.cents : null
  return unit === 'g' ? (qty / gpu) * price.cents : null
}

// ---------- Cost per meal ----------

export interface IngredientForCost { label: string; foodId?: string; productId?: string; quantity: number; unit: QtyUnit; optional?: boolean }
export interface MealCost { cents: number; coveredPct: number; missing: string[] }

/** Whole-recipe cost from the latest prices. Optional ingredients are left out. Never invents a price for a missing one. */
export function recipeCostEstimate(ings: IngredientForCost[], prices: PriceIndex, foods: Map<string, Food>): MealCost {
  const needed = ings.filter((i) => !i.optional)
  let cents = 0
  const missing: string[] = []
  for (const i of needed) {
    const price = (i.productId && prices.byProduct.get(i.productId)) || (i.foodId && prices.byFood.get(i.foodId)) || undefined
    const c = price ? costOf(i.quantity, i.unit, price, i.foodId ? foods.get(i.foodId) : undefined) : null
    if (c === null) missing.push(i.label)
    else cents += c
  }
  const coveredPct = needed.length ? ((needed.length - missing.length) / needed.length) * 100 : 100
  return { cents: Math.round(cents), coveredPct, missing }
}

export function perServing(cost: MealCost, servings: number, portionScale = 1): MealCost {
  return { ...cost, cents: Math.round((cost.cents / Math.max(servings, 1)) * portionScale) }
}

/** Sum of meal costs; partial if any meal is partial. */
export function dayCost(meals: MealCost[]): MealCost {
  const missing = meals.flatMap((m) => m.missing)
  const coveredPct = meals.length ? meals.reduce((s, m) => s + m.coveredPct, 0) / meals.length : 100
  return { cents: meals.reduce((s, m) => s + m.cents, 0), coveredPct, missing: [...new Set(missing)] }
}

// ---------- Protein per dollar ----------

/** Grams of protein per dollar spent, from protein per 100 g and a per-kg price. Null for per-item prices without a weight. */
export function proteinPerDollar(proteinPer100g: number, price: UnitPrice, food?: Pick<Food, 'gramsPerUnit' | 'densityGPerMl'>): number | null {
  const centsPerKg =
    price.unit === 'g' ? price.cents
    : price.unit === 'ml' ? (food?.densityGPerMl ? price.cents / food.densityGPerMl : null)
    : food?.gramsPerUnit ? (price.cents / food.gramsPerUnit) * 1000 : null
  if (!centsPerKg || centsPerKg <= 0) return null
  return (proteinPer100g * 10) / (centsPerKg / 100)
}

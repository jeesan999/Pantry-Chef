/** Database side of the Expenses screen: loads rows for the cost engine and writes budgets and manual expenses. */
import { IntegrityError, newId, type Repo } from '../db/repo'
import { SETTINGS_ID } from '../db/seed'
import type { Budget, Food, Product } from '../db/types'
import {
  budgetStatus,
  buildPriceIndex,
  perServing,
  periodRange,
  recipeCostEstimate,
  total,
  type BudgetStatus,
  type MealCost,
  type PriceIndex,
  type PricePoint,
} from '../engines/cost/engine'

export const MANUAL_CATEGORIES = ['Groceries', 'Household', 'Eating out', 'Other'] as const

/** Every price observation, with its unit taken from the purchase it came from (g and ml share the per-kg/L field). */
export async function loadPricePoints(repo: Repo): Promise<PricePoint[]> {
  const [history, purchases] = await Promise.all([repo.db.price_history.toArray(), repo.db.grocery_purchases.toArray()])
  const unitOf = new Map(purchases.map((p) => [p.id, p.unit]))
  return history.map((h) => ({ productId: h.productId, date: h.date, store: h.store, cents: h.centsPerKgOrUnit, unit: unitOf.get(h.purchaseId) ?? 'unit' }))
}

export interface CostContext { prices: PriceIndex; products: Map<string, Product>; foods: Map<string, Food>; points: PricePoint[] }

export async function loadCostContext(repo: Repo): Promise<CostContext> {
  const [points, products, foods] = await Promise.all([loadPricePoints(repo), repo.db.products.toArray(), repo.db.foods.toArray()])
  const productMap = new Map(products.map((p) => [p.id, p]))
  return { points, prices: buildPriceIndex(points, productMap), products: productMap, foods: new Map(foods.map((f) => [f.id, f])) }
}

/** Estimated cost per serving of every recipe, from the latest prices. */
export async function recipeServingCosts(repo: Repo, ctx: CostContext): Promise<Map<string, MealCost>> {
  const [recipes, ings] = await Promise.all([repo.db.recipes.toArray(), repo.db.recipe_ingredients.toArray()])
  const byRecipe = new Map<string, typeof ings>()
  for (const i of ings) byRecipe.set(i.recipeId, [...(byRecipe.get(i.recipeId) ?? []), i])
  const out = new Map<string, MealCost>()
  for (const r of recipes) out.set(r.id, perServing(recipeCostEstimate(byRecipe.get(r.id) ?? [], ctx.prices, ctx.foods), r.servings))
  return out
}

export async function getBudgets(repo: Repo): Promise<Partial<Record<Budget['period'], Budget>>> {
  const rows = await repo.db.budgets.where('settingsId').equals(SETTINGS_ID).toArray()
  return Object.fromEntries(rows.map((b) => [b.period, b]))
}

/** Create, change or (limit 0 / empty) remove the budget for a period. */
export async function saveBudget(repo: Repo, period: Budget['period'], limitCents: number | null, alertPct: number): Promise<void> {
  await repo.tx(async () => {
    const existing = (await getBudgets(repo))[period]
    if (!limitCents) {
      if (existing) await repo.remove('budgets', existing.id)
      return
    }
    if (existing) await repo.update('budgets', existing.id, { limitCents, alertPct })
    else await repo.insert('budgets', { id: newId(), settingsId: SETTINGS_ID, period, limitCents, alertPct })
  })
}

/** Status of each set budget for the period containing date. */
export async function budgetStatuses(repo: Repo, date: string): Promise<Array<{ period: Budget['period']; status: BudgetStatus }>> {
  const budgets = await getBudgets(repo)
  const out: Array<{ period: Budget['period']; status: BudgetStatus }> = []
  for (const period of ['week', 'month'] as const) {
    const b = budgets[period]
    if (!b) continue
    const r = periodRange(period, date)
    const spent = total(await repo.db.expenses.where('date').between(r.start, r.end, true, true).toArray())
    out.push({ period, status: budgetStatus(b, spent) })
  }
  return out
}

export async function addManualExpense(repo: Repo, e: { store: string; date: string; amountCents: number; category: string }): Promise<void> {
  if (!e.store.trim()) throw new IntegrityError('Add where the money was spent.')
  if (!Number.isInteger(e.amountCents) || e.amountCents <= 0) throw new IntegrityError('Enter an amount above $0.')
  await repo.insert('expenses', { id: newId(), store: e.store.trim(), date: e.date, amountCents: e.amountCents, category: e.category })
}

/** Only manual expenses can be deleted here; a receipt's expenses go with the receipt. */
export async function deleteManualExpense(repo: Repo, id: string): Promise<void> {
  const e = await repo.db.expenses.get(id)
  if (!e) return
  if (e.receiptId) throw new IntegrityError('This came from a receipt; it can only be removed with the receipt.')
  await repo.remove('expenses', id)
}

/** Parse a dollars string like "12.50" or "$1,200" to whole cents; null if not a number. */
export function parseDollars(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '')
  if (!t) return null
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

/**
 * Plan-tab operations: copy or repeat a meal, regenerate one meal, day summaries, bulk preparation
 * and plan costs. Built on the existing engines (planner, shopping, cost, availability); every
 * change returns an undo, and nothing here touches pantry stock.
 */
import type { Repo } from '../db/repo'
import { FIXED_BREAKFAST_ID } from '../db/seed'
import type { Nutrients, PlannedMeal, Recipe } from '../db/types'
import { SLOTS, type DayTargets, type SlotName } from '../engines/contract'
import { budgetStatus, costOf, type BudgetStatus } from '../engines/cost/engine'
import { addDays } from '../engines/nutrition/engine'
import { approvedTargets } from '../engines/nutrition/service'
import type { PlanSlot } from '../engines/planner/engine'
import type { ShoppingNeed } from '../engines/shopping/engine'
import { assignMeal, clearMeal, targetsForDate } from './day'
import { eatenFor } from './eating'
import { getBudgets, loadCostContext, recipeServingCosts } from './expenses'
import { loadMealContext, mealAvailability, mealNutrition } from './meals'
import { addNutrients, emptyNutrients, portionForProtein } from './nutrition'
import { loadRecipeNutrition } from './rank'
import { dayChoices } from './schedule'
import { datesBetween, shoppingNeedsFor, type ListRange } from './shopping'
import { suggestForSlot } from './suggestions'

const mid = ([a, b]: [number, number]) => (a + b) / 2

async function targets(repo: Repo, dates: string[]): Promise<{ id: string; version: number; days: Map<string, DayTargets> }> {
  const t = await approvedTargets(repo)
  if (!t?.version) throw new Error('Approve your targets on the Goals screen first.')
  const choices = await dayChoices(repo, dates)
  return { id: t.id, version: t.version, days: new Map(choices.map((c) => [c.date, targetsForDate(t.targetSet, c)])) }
}

const plannedAt = (repo: Repo, date: string, slot: SlotName) => repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first()

/** Put back what was in these slots before a change. */
function undoFor(repo: Repo, before: Array<{ date: string; slot: SlotName; prev?: PlannedMeal }>, t: { id: string; version: number }) {
  return async () => {
    await repo.tx(async () => {
      for (const b of before) {
        if (b.prev) await assignMeal(repo, { date: b.date, slot: b.slot, time: b.prev.time, recipeId: b.prev.recipeId, portionScale: b.prev.portionScale, targetsId: t.id, targetsVersion: t.version })
        else await clearMeal(repo, b.date, b.slot)
        const now = await plannedAt(repo, b.date, b.slot)
        if (now && b.prev) await repo.update('planned_meals', now.id, { substitutions: b.prev.substitutions })
      }
    })
  }
}

/**
 * Copy a meal to other days (same slot), re-portioned for each day's protein target; swaps come too.
 * Days whose meal is already logged are skipped. Returns how many were set, and an undo.
 */
export async function copyMeal(repo: Repo, from: PlannedMeal, toDates: string[]): Promise<{ copied: number; skipped: string[]; undo: () => Promise<void> }> {
  const dates = toDates.filter((d) => d !== from.date)
  const t = await targets(repo, dates)
  const n = (await loadRecipeNutrition(repo)).get(from.recipeId)
  const before: Array<{ date: string; slot: SlotName; prev?: PlannedMeal }> = []
  const skipped: string[] = []
  await repo.tx(async () => {
    for (const date of dates) {
      const prev = await plannedAt(repo, date, from.slot)
      if (prev && (await eatenFor(repo, prev.id))) {
        skipped.push(date)
        continue
      }
      before.push({ date, slot: from.slot, prev })
      const day = t.days.get(date)!
      const scale = n && from.slot !== 'breakfast' ? portionForProtein(n.perServing.proteinG, mid(day.slots[from.slot].proteinG)) : from.portionScale
      await assignMeal(repo, { date, slot: from.slot, time: day.slots[from.slot].time, recipeId: from.recipeId, portionScale: scale, targetsId: t.id, targetsVersion: t.version })
      const row = await plannedAt(repo, date, from.slot)
      if (row) await repo.update('planned_meals', row.id, { substitutions: from.substitutions })
    }
  })
  return { copied: before.length, skipped, undo: undoFor(repo, before, t) }
}

/** Choose a recipe for one meal (portioned to that day's target), keeping the rest of the plan. */
export async function setMealRecipe(repo: Repo, date: string, slot: PlanSlot, recipeId: string): Promise<() => Promise<void>> {
  const t = await targets(repo, [date])
  const prev = await plannedAt(repo, date, slot)
  if (prev && (await eatenFor(repo, prev.id))) throw new Error('This meal is already logged; undo that on Today first.')
  const n = (await loadRecipeNutrition(repo)).get(recipeId)
  const day = t.days.get(date)!
  const scale = n ? portionForProtein(n.perServing.proteinG, mid(day.slots[slot].proteinG)) : 1
  await assignMeal(repo, { date, slot, time: day.slots[slot].time, recipeId, portionScale: scale, targetsId: t.id, targetsVersion: t.version })
  return undoFor(repo, [{ date, slot, prev }], t)
}

/** Replace one meal with the planner's best alternative; nothing else in the plan changes. */
export async function regenerateMeal(repo: Repo, date: string, slot: PlanSlot, today: string, now?: string): Promise<{ recipe: Recipe; undo: () => Promise<void> } | null> {
  const s = await suggestForSlot(repo, { date, slot, today, now, limit: 4 })
  const pick = s.suggestions.find((x) => !x.current)
  if (!pick) return null
  const t = await targets(repo, [date])
  const prev = await plannedAt(repo, date, slot)
  if (prev && (await eatenFor(repo, prev.id))) throw new Error('This meal is already logged; undo that on Today first.')
  await assignMeal(repo, { date, slot, time: t.days.get(date)!.slots[slot].time, recipeId: pick.recipe.id, portionScale: pick.portionScale, targetsId: t.id, targetsVersion: t.version })
  return { recipe: pick.recipe, undo: undoFor(repo, [{ date, slot, prev }], t) }
}

// ---------- day summaries ----------

export interface MealSummary { slot: SlotName; meal?: PlannedMeal; recipe?: Recipe; nutrition: Nutrients | null; costCents: number | null; toBuy: number | null; logged: boolean }
export interface DaySummary { date: string; target: DayTargets; totals: Nutrients; meals: MealSummary[]; costCents: number; unpriced: number; toBuy: number }

/** Each day's meals (fixed breakfast included), totals with swaps, cost and pantry status. Reads only. */
export async function daySummaries(repo: Repo, dates: string[]): Promise<DaySummary[]> {
  const t = await targets(repo, dates)
  const [planned, recipes, mctx, costCtx, logs] = await Promise.all([
    repo.db.planned_meals.where('date').anyOf(dates).toArray(),
    repo.db.recipes.toArray(),
    loadMealContext(repo),
    loadCostContext(repo),
    repo.db.meal_consumption.where('date').anyOf(dates).toArray(),
  ])
  const costs = await recipeServingCosts(repo, costCtx)
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const loggedIds = new Set(logs.filter((c) => !c.undone && c.plannedMealId).map((c) => c.plannedMealId!))
  const out: DaySummary[] = []
  for (const date of dates) {
    const meals: MealSummary[] = []
    let totals = emptyNutrients()
    let costCents = 0
    let unpriced = 0
    let toBuy = 0
    for (const slot of SLOTS) {
      const meal = planned.find((p) => p.date === date && p.slot === slot)
      const recipeId = meal?.recipeId ?? (slot === 'breakfast' ? FIXED_BREAKFAST_ID : undefined)
      if (!recipeId) {
        meals.push({ slot, nutrition: null, costCents: null, toBuy: null, logged: false })
        continue
      }
      const m = { recipeId, portionScale: meal?.portionScale ?? 1, substitutions: meal?.substitutions, date }
      const nutrition = mealNutrition(mctx, m).n
      const c = costs.get(recipeId)
      const cost = c && c.coveredPct === 100 ? Math.round(c.cents * m.portionScale) : null
      const avail = await mealAvailability(repo, m)
      const missing = avail.missing + avail.partial
      totals = addNutrients(totals, nutrition)
      if (cost === null) unpriced++
      else costCents += cost
      toBuy += missing
      meals.push({ slot, meal, recipe: byId.get(recipeId), nutrition, costCents: cost, toBuy: missing, logged: !!meal && loggedIds.has(meal.id) })
    }
    out.push({ date, target: t.days.get(date)!, totals, meals, costCents, unpriced, toBuy })
  }
  return out
}

// ---------- bulk preparation ----------

export interface PrepGroup { recipe: Recipe; portions: number; meals: Array<{ date: string; slot: SlotName; portionScale: number }> }
export interface PrepSession { date: string; recipe: Recipe; portions: number; forDates: string[]; freeze: number }
export interface BulkPrep { groups: PrepGroup[]; needs: ShoppingNeed[]; toBuyCents: number; unpricedItems: number; sessions: PrepSession[]; mealIds: string[] }

/** Cooked food keeps about 3 days in the fridge (fish and seafood 2); beyond that, freeze. */
export const fridgeDays = (r: Recipe) => (r.protein === 'fish' || r.protein === 'seafood' ? 2 : 3)

export async function bulkPrep(repo: Repo, mealIds: string[]): Promise<BulkPrep> {
  const meals = (await repo.db.planned_meals.bulkGet(mealIds)).filter((m): m is PlannedMeal => !!m)
  const recipes = new Map((await repo.db.recipes.toArray()).map((r) => [r.id, r]))
  const groupsBy = new Map<string, PrepGroup>()
  for (const m of [...meals].sort((a, b) => a.date.localeCompare(b.date))) {
    const recipe = recipes.get(m.recipeId)
    if (!recipe) continue
    const key = `${m.recipeId}|${JSON.stringify(m.substitutions ?? {})}`
    const g = groupsBy.get(key) ?? { recipe, portions: 0, meals: [] }
    g.portions += m.portionScale
    g.meals.push({ date: m.date, slot: m.slot, portionScale: m.portionScale })
    groupsBy.set(key, g)
  }
  const groups = [...groupsBy.values()].sort((a, b) => b.portions - a.portions || a.recipe.name.localeCompare(b.recipe.name))

  // schedule: cook on the first day a recipe is eaten; meals within the fridge window share that
  // session; later meals get their own session, or freeze portions from the first one
  const sessions: PrepSession[] = []
  for (const g of groups) {
    let i = 0
    while (i < g.meals.length) {
      const start = g.meals[i].date
      const last = addDays(start, fridgeDays(g.recipe) - 1)
      const batch = g.meals.filter((m, j) => j >= i && m.date <= last)
      const rest = g.meals.slice(i + batch.length)
      sessions.push({ date: start, recipe: g.recipe, portions: batch.reduce((s, m) => s + m.portionScale, 0), forDates: [...new Set(batch.map((m) => m.date))], freeze: rest.length })
      i += batch.length
    }
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.recipe.name.localeCompare(b.recipe.name))

  const dates = meals.map((m) => m.date).sort()
  const { needs } = dates.length ? await shoppingNeedsFor(repo, { from: dates[0], to: dates[dates.length - 1] }, mealIds) : { needs: [] }
  return {
    groups,
    needs,
    toBuyCents: needs.reduce((s, n) => s + (n.costCents ?? 0), 0),
    unpricedItems: needs.filter((n) => n.buyQty > 0 && n.costCents === null).length,
    sessions,
    mealIds,
  }
}

// ---------- plan costs ----------

export interface PlanCosts {
  days: number
  meals: number
  totalCents: number // all planned meals at your latest prices (priced meals only)
  unpricedMeals: number
  perDayCents: number
  perMealCents: number
  pantryCents: number // value of pantry stock the plan uses
  toBuyCents: number // estimated extra spending
  unpricedToBuy: number
  budget: { limitCents: number; status: BudgetStatus } | null // weekly budget against what's left to buy
}

export async function planCosts(repo: Repo, r: ListRange): Promise<PlanCosts> {
  const dates = datesBetween(r)
  const [summaries, { needs }, costCtx, budgets] = await Promise.all([daySummaries(repo, dates), shoppingNeedsFor(repo, r), loadCostContext(repo), getBudgets(repo)])
  const meals = summaries.flatMap((d) => d.meals.filter((m) => m.recipe))
  const priced = meals.filter((m) => m.costCents !== null)
  const totalCents = priced.reduce((s, m) => s + (m.costCents ?? 0), 0)
  let pantryCents = 0
  for (const n of needs) {
    if (n.haveQty <= 0) continue
    const price = (n.productId && costCtx.prices.byProduct.get(n.productId)) || (n.foodId && costCtx.prices.byFood.get(n.foodId)) || undefined
    const c = price ? costOf(n.haveQty, n.unit, price, n.foodId ? costCtx.foods.get(n.foodId) : undefined) : null
    if (c) pantryCents += c
  }
  const toBuyCents = needs.reduce((s, n) => s + (n.costCents ?? 0), 0)
  const week = budgets.week
  return {
    days: dates.length,
    meals: meals.length,
    totalCents,
    unpricedMeals: meals.length - priced.length,
    perDayCents: dates.length ? Math.round(totalCents / dates.length) : 0,
    perMealCents: priced.length ? Math.round(totalCents / priced.length) : 0,
    pantryCents: Math.round(pantryCents),
    toBuyCents: Math.round(toBuyCents),
    unpricedToBuy: needs.filter((n) => n.buyQty > 0 && n.costCents === null).length,
    budget: week ? { limitCents: week.limitCents, status: budgetStatus(week, Math.round(toBuyCents)) } : null,
  }
}

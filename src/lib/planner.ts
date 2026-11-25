/**
 * Database side of the meal planner: builds a draft plan from your data, accepts it (with undo),
 * and re-portions upcoming meals when new targets are approved. Nothing is written until accepted.
 */
import { IntegrityError, type Repo } from '../db/repo'
import { FIXED_BREAKFAST_ID } from '../db/seed'
import type { Food, Nutrients, PlannedMeal } from '../db/types'
import { CONTRACT_VERSION, type DayTargets } from '../engines/contract'
import { addDays, mondayOf } from '../engines/nutrition/engine'
import { approvedTargets } from '../engines/nutrition/service'
import { PLAN_SLOTS, planWeek, type Meal, type PlanInput, type PlanResult, type PlanSlot, type PlannerIngredient, type PlannerRecipe, type StockLot } from '../engines/planner/engine'
import { assignMeal, clearMeal, targetsForDate } from './day'
import { loadCostContext, recipeServingCosts } from './expenses'
import { displayName } from './itemSearch'
import { ingredientGrams, portionForProtein } from './nutrition'
import { loadRecipeNutrition } from './rank'
import { loadMealContext, mealIngredients, mealNutrition } from './meals'
import { addNutrients, emptyNutrients } from './nutrition'
import { allRatings } from './ratings'
import { dayChoices } from './schedule'
import { datesBetween } from './shopping'

export interface DraftParams {
  from: string
  to: string
  mode: 'empty' | 'unlocked' // fill only empty meals, or replan every meal you haven't locked
  seed: number
  locks: Meal[] // meals pinned in the draft (kept, or swapped in by you)
  skips: string[] // `${date}|${slot}` left empty on purpose
  exclude?: Record<string, string[]> // recipes swapped away from a slot
}
export interface Draft { params: DraftParams; result: PlanResult; existing: Meal[]; locked: Meal[]; past: string[]; days: Record<string, DayTargets>; names: Map<string, string> }

export const slotKey = (m: { date: string; slot: string }) => `${m.date}|${m.slot}`

async function current(repo: Repo) {
  const t = await approvedTargets(repo)
  if (!t || t.targetSet.contractVersion !== CONTRACT_VERSION) throw new IntegrityError('Approve your targets on the Goals screen first.')
  return t
}

/** Raw grams per serving for each non-optional ingredient with a food and a known weight. */
function gramsPerServing(ings: Array<{ foodId?: string; optional: boolean; quantity: number; unit: 'g' | 'ml' | 'unit'; weighed: 'raw' | 'cooked'; label: string }>, servings: number, foods: Map<string, Food>, yields: Parameters<typeof ingredientGrams>[2]): PlannerIngredient[] {
  const out: PlannerIngredient[] = []
  for (const i of ings) {
    if (i.optional || !i.foodId) continue
    const f = foods.get(i.foodId)
    if (!f) continue
    try {
      out.push({ foodId: i.foodId, grams: ingredientGrams(i, f, yields) / Math.max(servings, 1) })
    } catch {
      // no weight per unit or cooking yield recorded: the line can't be matched to stock
    }
  }
  return out
}

export async function buildDraft(repo: Repo, params: DraftParams, today: string, now?: string): Promise<Draft> {
  if (params.from > params.to) throw new IntegrityError('The last day must be on or after the first day.')
  const approved = await current(repo)
  const dates = datesBetween({ from: params.from < today ? today : params.from, to: params.to })
  if (!dates.length) throw new IntegrityError('These days are already over.')
  const [choices, recipes, ingredients, foods, yields, products, lots, planned, recentRows, nutrition, ratings, costCtx] = await Promise.all([
    dayChoices(repo, dates),
    repo.db.recipes.toArray(),
    repo.db.recipe_ingredients.toArray(),
    repo.db.foods.toArray(),
    repo.db.cooking_yields.toArray(),
    repo.db.products.toArray(),
    repo.db.inventory_lots.toArray(),
    repo.db.planned_meals.where('date').between(dates[0], dates[dates.length - 1], true, true).toArray(),
    repo.db.planned_meals.where('date').between(addDays(dates[0], -3), addDays(dates[0], -1), true, true).toArray(),
    loadRecipeNutrition(repo),
    allRatings(repo),
    loadCostContext(repo),
  ])
  const costs = await recipeServingCosts(repo, costCtx)
  const foodMap = new Map(foods.map((f) => [f.id, f]))
  const days = Object.fromEntries(choices.map((c) => [c.date, targetsForDate(approved.targetSet, c)]))
  const byRecipe = new Map<string, typeof ingredients>()
  for (const i of ingredients) byRecipe.set(i.recipeId, [...(byRecipe.get(i.recipeId) ?? []), i])

  const plannerRecipes: PlannerRecipe[] = recipes
    .filter((r) => !r.fixedSlot && nutrition.get(r.id))
    .map((r) => {
      const c = costs.get(r.id)
      return {
        id: r.id,
        name: r.name,
        cuisine: r.cuisine,
        slotTags: r.slotTags,
        perServing: nutrition.get(r.id)!.perServing,
        ingredients: gramsPerServing(byRecipe.get(r.id) ?? [], r.servings, foodMap, yields),
        costPerServing: c && c.coveredPct === 100 ? c.cents : null,
        totalMin: r.prepMin + r.cookMin,
      }
    })

  // pantry stock in grams per food
  const productFood = new Map(products.map((p) => [p.id, p.foodId]))
  const stock: StockLot[] = []
  for (const l of lots) {
    if (l.remaining <= 1e-9) continue
    const foodId = productFood.get(l.productId)
    const f = foodId ? foodMap.get(foodId) : undefined
    if (!foodId || !f) continue
    const grams = l.unit === 'g' ? l.remaining : l.unit === 'ml' ? l.remaining * (f.densityGPerMl ?? 1) : f.gramsPerUnit ? l.remaining * f.gramsPerUnit : null
    if (grams) stock.push({ foodId, grams, expiryDate: l.expiryDate, expiryKind: l.expiryKind })
  }

  const fb = recipes.find((r) => r.id === FIXED_BREAKFAST_ID)
  const breakfast = fb && nutrition.get(fb.id) ? { perDay: nutrition.get(fb.id)!.perServing, ingredients: gramsPerServing(byRecipe.get(fb.id) ?? [], fb.servings, foodMap, yields) } : null

  // what's fixed: past meals, existing meals (fill-empty mode), and anything pinned in the draft
  const existing: Meal[] = planned.filter((p) => p.slot !== 'breakfast').map((p) => ({ date: p.date, slot: p.slot as PlanSlot, recipeId: p.recipeId, portionScale: p.portionScale }))
  const past = new Set<string>()
  for (const date of dates) for (const s of PLAN_SLOTS) if (date === today && now && days[date].slots[s].time <= now) past.add(slotKey({ date, slot: s }))
  // meals already logged (eaten or skipped) are fixed, whatever the time
  const logs = (await repo.db.meal_consumption.where('date').between(dates[0], dates[dates.length - 1], true, true).toArray()).filter((c) => !c.undone)
  const logOf = new Map(logs.filter((c) => c.plannedMealId).map((c) => [c.plannedMealId!, c]))
  const logged = new Set(logOf.keys())
  for (const p of planned) if (logged.has(p.id) && p.slot !== 'breakfast') past.add(slotKey({ date: p.date, slot: p.slot }))
  const lockKeys = new Set(params.locks.map(slotKey))
  const skipKeys = new Set(params.skips)
  const locked: Meal[] = [
    ...params.locks.filter((l) => dates.includes(l.date)),
    ...existing.filter((m) => !lockKeys.has(slotKey(m)) && !skipKeys.has(slotKey(m)) && (params.mode === 'empty' || past.has(slotKey(m)))),
  ]
  const fixedKeys = new Set(locked.map(slotKey))
  const fill = dates.flatMap((date) => PLAN_SLOTS.map((slot) => ({ date, slot }))).filter((f) => !fixedKeys.has(slotKey(f)) && !skipKeys.has(slotKey(f)) && !past.has(slotKey(f)))

  // What the planner judges the day by: logged meals at the share eaten (skipped = nothing), meals with
  // swaps as their own recipe, quick foods and part-eaten breakfasts as extra intake for the day.
  const mctx = await loadMealContext(repo)
  const plannerById = new Map(plannerRecipes.map((r) => [r.id, r]))
  const extraRecipes: PlannerRecipe[] = []
  const plannerLocked = locked.flatMap((m) => {
    const row = planned.find((p) => p.date === m.date && p.slot === m.slot && p.recipeId === m.recipeId)
    const c = row ? logOf.get(row.id) : undefined
    const scale = c ? m.portionScale * c.fractionEaten : m.portionScale
    if (scale <= 0) return []
    if (row?.substitutions && Object.keys(row.substitutions).length && plannerById.get(m.recipeId)) {
      const id = `${m.recipeId}~${row.id}`
      const base = plannerById.get(m.recipeId)!
      const servings = mctx.servings.get(m.recipeId) ?? 1
      extraRecipes.push({ ...base, id, perServing: mealNutrition(mctx, { recipeId: m.recipeId, portionScale: 1, substitutions: row.substitutions }).n, ingredients: gramsPerServing(mealIngredients(mctx, row), servings, foodMap, yields) })
      return [{ ...m, recipeId: id, portionScale: scale }]
    }
    return [{ ...m, portionScale: scale }]
  })
  const extra: Record<string, Nutrients> = {}
  const add = (date: string, n: Nutrients, k = 1) => { extra[date] = addNutrients(extra[date] ?? emptyNutrients(), n, k) }
  for (const c of logs) {
    if (c.quick) add(c.date, c.nutrition)
    const row = c.plannedMealId ? planned.find((p) => p.id === c.plannedMealId) : undefined
    if (row?.slot === 'breakfast' && breakfast && c.fractionEaten < 1) add(c.date, breakfast.perDay, -(1 - c.fractionEaten))
  }

  const input: PlanInput = {
    dates,
    days,
    recipes: [...plannerRecipes, ...extraRecipes],
    breakfast,
    stock,
    ratings: new Map([...ratings].map(([k, v]) => [k, { stars: v.stars, flags: v.flags }])),
    locked: plannerLocked,
    extra,
    fill,
    recent: recentRows.map((r) => ({ date: r.date, recipeId: r.recipeId })),
    foodNames: new Map(foods.map((f) => [f.id, displayName(f.name)])),
    seed: params.seed,
    exclude: params.exclude,
  }
  return { params, result: planWeek(input), existing, locked, past: [...past], days, names: new Map(recipes.map((r) => [r.id, r.name])) }
}

export interface Accepted { written: number; cleared: number; undo: () => Promise<void> }

/** Write the draft: suggested meals, pinned swaps, and (in replan mode) slots you cleared. One transaction; undo restores. */
export async function acceptDraft(repo: Repo, draft: Draft): Promise<Accepted> {
  const approved = await current(repo)
  const existingBy = new Map(draft.existing.map((m) => [slotKey(m), m]))
  const writes: Meal[] = [
    ...draft.result.meals,
    ...draft.params.locks.filter((l) => {
      const e = existingBy.get(slotKey(l))
      return !e || e.recipeId !== l.recipeId || e.portionScale !== l.portionScale
    }),
  ]
  const clears = draft.params.mode === 'unlocked' ? draft.params.skips.filter((k) => existingBy.has(k) && !draft.past.includes(k)) : []
  const touched = [...new Set([...writes.map(slotKey), ...clears])]
  const snapshot = new Map<string, PlannedMeal | undefined>()
  await repo.tx(async () => {
    for (const k of touched) {
      const [date, slot] = k.split('|')
      snapshot.set(k, await repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first())
    }
    for (const m of writes) {
      await assignMeal(repo, { date: m.date, slot: m.slot, time: draft.days[m.date].slots[m.slot].time, recipeId: m.recipeId, portionScale: m.portionScale, targetsId: approved.id, targetsVersion: approved.version! })
    }
    for (const k of clears) {
      const [date, slot] = k.split('|')
      await clearMeal(repo, date, slot as PlanSlot)
    }
  })
  return {
    written: writes.length,
    cleared: clears.length,
    undo: async () => {
      await repo.tx(async () => {
        for (const [k, prev] of snapshot) {
          const [date, slot] = k.split('|') as [string, PlanSlot]
          if (prev) await assignMeal(repo, { date, slot, time: prev.time, recipeId: prev.recipeId, portionScale: prev.portionScale, targetsId: approved.id, targetsVersion: approved.version! })
          else await clearMeal(repo, date, slot)
        }
      })
    },
  }
}

export interface Stale { version: number; meals: number }

/** Upcoming meals planned under older targets than the approved ones. */
export async function staleTargets(repo: Repo, today: string): Promise<Stale | null> {
  const approved = await approvedTargets(repo)
  if (!approved?.version) return null
  const plans = (await repo.db.meal_plans.toArray()).filter((p) => p.weekStart >= mondayOf(today) && p.targetsVersion < approved.version!)
  if (!plans.length) return null
  const ids = new Set(plans.map((p) => p.id))
  const meals = (await repo.db.planned_meals.where('date').aboveOrEqual(today).toArray()).filter((m) => ids.has(m.mealPlanId))
  return meals.length ? { version: approved.version, meals: meals.length } : null
}

export interface Reportion { changes: Array<{ id: string; date: string; slot: string; recipe: string; from: number; to: number }>; apply: () => Promise<() => Promise<void>> }

/** New portion sizes for upcoming meals under the approved targets (recipes unchanged). */
export async function reportion(repo: Repo, today: string): Promise<Reportion> {
  const approved = await current(repo)
  const [meals, nutrition, recipes, plans] = await Promise.all([
    repo.db.planned_meals.where('date').aboveOrEqual(today).toArray(),
    loadRecipeNutrition(repo),
    repo.db.recipes.toArray(),
    repo.db.meal_plans.toArray(),
  ])
  const dates = [...new Set(meals.map((m) => m.date))]
  const days = new Map((await dayChoices(repo, dates)).map((c) => [c.date, targetsForDate(approved.targetSet, c)]))
  const name = new Map(recipes.map((r) => [r.id, r.name]))
  const changes: Reportion['changes'] = []
  for (const m of meals) {
    if (m.slot === 'breakfast') continue
    const n = nutrition.get(m.recipeId)
    const day = days.get(m.date)
    if (!n || !day) continue
    const [lo, hi] = day.slots[m.slot].proteinG
    const to = portionForProtein(n.perServing.proteinG, (lo + hi) / 2)
    if (to !== m.portionScale) changes.push({ id: m.id, date: m.date, slot: m.slot, recipe: name.get(m.recipeId) ?? 'Meal', from: m.portionScale, to })
  }
  const stalePlans = plans.filter((p) => p.weekStart >= mondayOf(today) && p.targetsVersion < approved.version!)
  return {
    changes,
    apply: async () => {
      await repo.tx(async () => {
        for (const c of changes) await repo.update('planned_meals', c.id, { portionScale: c.to })
        for (const p of stalePlans) await repo.update('meal_plans', p.id, { targetsId: approved.id, targetsVersion: approved.version! })
      })
      return async () => {
        await repo.tx(async () => {
          for (const c of changes) await repo.update('planned_meals', c.id, { portionScale: c.from })
          for (const p of stalePlans) await repo.update('meal_plans', p.id, { targetsId: p.targetsId, targetsVersion: p.targetsVersion })
        })
      }
    },
  }
}

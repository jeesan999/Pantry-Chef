/**
 * A planned meal's ingredients, with any substitutions you chose applied. Every part of the app
 * that needs a meal's ingredients (nutrition, pantry checks, eating, shopping, planning) goes
 * through here, so a swap shows up everywhere at once.
 */
import type { Repo } from '../db/repo'
import type { CookingYield, Food, Nutrients, PlannedMeal, RecipeIngredient } from '../db/types'
import { checkAvailability, type AvailabilitySummary } from '../engines/availability/engine'
import type { LotInfo, Need } from '../engines/eating/engine'
import { displayName } from './itemSearch'
import { substitutesFor } from '../data/substitutes'
import { ingredientGrams, recipeNutrition, scaleNutrients } from './nutrition'

export type Substitutions = Record<string, string> // recipe ingredient id -> food id used instead

/** Swap ingredients for their substitutes, weight for weight (an item becomes its weight in grams). */
export function applySubs(ings: RecipeIngredient[], subs: Substitutions | undefined, foods: Map<string, Food>, yields: CookingYield[]): RecipeIngredient[] {
  if (!subs || !Object.keys(subs).length) return ings
  return ings.map((i) => {
    const to = subs[i.id]
    if (!to || to === i.foodId) return i
    const from = i.foodId ? foods.get(i.foodId) : undefined
    let grams: number | null = null
    try {
      grams = from ? ingredientGrams(i, from, yields) : null
    } catch {
      grams = null
    }
    const sub = foods.get(to)
    const label = sub ? `${displayName(sub.name)} (instead of ${i.label.toLowerCase()})` : i.label
    return grams !== null
      ? { ...i, foodId: to, productId: undefined, label, quantity: grams, unit: 'g', weighed: 'raw' }
      : { ...i, foodId: to, productId: undefined, label }
  })
}

export interface MealContext { foods: Map<string, Food>; yields: CookingYield[]; ingsByRecipe: Map<string, RecipeIngredient[]>; servings: Map<string, number> }

export async function loadMealContext(repo: Repo): Promise<MealContext> {
  const [foods, yields, ings, recipes] = await Promise.all([repo.db.foods.toArray(), repo.db.cooking_yields.toArray(), repo.db.recipe_ingredients.toArray(), repo.db.recipes.toArray()])
  const ingsByRecipe = new Map<string, RecipeIngredient[]>()
  for (const i of ings) ingsByRecipe.set(i.recipeId, [...(ingsByRecipe.get(i.recipeId) ?? []), i])
  for (const list of ingsByRecipe.values()) list.sort((a, b) => a.sort - b.sort)
  return { foods: new Map(foods.map((f) => [f.id, f])), yields, ingsByRecipe, servings: new Map(recipes.map((r) => [r.id, r.servings])) }
}

/** Ingredients of a meal with its swaps applied. */
export const mealIngredients = (ctx: MealContext, meal: Pick<PlannedMeal, 'recipeId'> & { substitutions?: Substitutions }) =>
  applySubs(ctx.ingsByRecipe.get(meal.recipeId) ?? [], meal.substitutions, ctx.foods, ctx.yields)

/** Nutrition of a meal at its portion, swaps included (the same calculation as the rest of the app). */
export function mealNutrition(ctx: MealContext, meal: Pick<PlannedMeal, 'recipeId' | 'portionScale'> & { substitutions?: Substitutions }): { n: Nutrients; approximate: boolean } {
  const r = recipeNutrition(mealIngredients(ctx, meal), ctx.foods, ctx.servings.get(meal.recipeId) ?? 1, ctx.yields)
  return { n: scaleNutrients(r.perServing, meal.portionScale), approximate: r.approximate }
}

/** Each non-optional ingredient as a pantry need at the portion cooked. */
export function mealNeeds(ctx: MealContext, meal: Pick<PlannedMeal, 'recipeId' | 'portionScale'> & { substitutions?: Substitutions }, productFood: Map<string, string | undefined>): Need[] {
  const k = meal.portionScale / Math.max(ctx.servings.get(meal.recipeId) ?? 1, 1)
  return mealIngredients(ctx, meal)
    .filter((i) => !i.optional)
    .map((i) => {
      const foodId = i.foodId ?? (i.productId ? productFood.get(i.productId) : undefined)
      const food = foodId ? ctx.foods.get(foodId) : undefined
      let grams: number | null = null
      try {
        grams = food ? ingredientGrams(i, food, ctx.yields) * k : null
      } catch {
        grams = null
      }
      return { label: i.label, foodId, productId: i.productId, grams, qty: i.quantity * k, unit: i.unit, ingredientId: i.id }
    })
}

/** Pantry stock as lot infos (food weights per unit included) for the eating and availability engines. */
export async function loadLots(repo: Repo): Promise<{ lots: LotInfo[]; productFood: Map<string, string | undefined> }> {
  const [lots, products, foods] = await Promise.all([repo.db.inventory_lots.toArray(), repo.db.products.toArray(), repo.db.foods.toArray()])
  const productFood = new Map(products.map((p) => [p.id, p.foodId]))
  const fm = new Map(foods.map((f) => [f.id, f]))
  return {
    productFood,
    lots: lots
      .filter((l) => l.remaining > 1e-9)
      .map((l) => {
        const f = productFood.get(l.productId) ? fm.get(productFood.get(l.productId)!) : undefined
        return { id: l.id, productId: l.productId, foodId: f?.id, unit: l.unit, remaining: l.remaining, unitCostCents: l.unitCostCents, expiryDate: l.expiryDate, expiryKind: l.expiryKind, gramsPerUnit: f?.gramsPerUnit, densityGPerMl: f?.densityGPerMl }
      }),
  }
}

/** Is everything for this meal in the pantry? Reads only. */
export async function mealAvailability(repo: Repo, meal: Pick<PlannedMeal, 'recipeId' | 'portionScale' | 'date'> & { substitutions?: Substitutions }): Promise<AvailabilitySummary> {
  const [ctx, { lots, productFood }] = await Promise.all([loadMealContext(repo), loadLots(repo)])
  return checkAvailability(mealNeeds(ctx, meal, productFood), lots, meal.date)
}

/** Pantry foods that could replace a missing ingredient: same group, and enough of it in stock. */
export function substituteOptions(foodId: string | undefined, gramsNeeded: number, lots: LotInfo[], foods: Map<string, Food>, date: string): Array<{ foodId: string; label: string; haveG: number }> {
  if (!foodId) return []
  const haveG = new Map<string, number>()
  for (const l of lots) {
    if (!l.foodId || (l.expiryDate && l.expiryKind !== 'best_before' && l.expiryDate < date)) continue
    const g = l.unit === 'g' ? l.remaining : l.unit === 'ml' ? l.remaining * (l.densityGPerMl ?? 1) : l.gramsPerUnit ? l.remaining * l.gramsPerUnit : 0
    haveG.set(l.foodId, (haveG.get(l.foodId) ?? 0) + g)
  }
  return substitutesFor(foodId)
    .filter((s) => (haveG.get(s.foodId) ?? 0) >= gramsNeeded * 0.8)
    .map((s) => ({ foodId: s.foodId, label: foods.get(s.foodId) ? displayName(foods.get(s.foodId)!.name) : s.foodId, haveG: haveG.get(s.foodId)! }))
    .sort((a, b) => b.haveG - a.haveG)
    .slice(0, 4)
}

/** Save (or clear) a swap on a planned meal. */
export async function setSubstitution(repo: Repo, plannedMealId: string, ingredientId: string, foodId: string | null): Promise<void> {
  const pm = await repo.get('planned_meals', plannedMealId)
  if (!pm) return
  const subs = { ...(pm.substitutions ?? {}) }
  if (foodId) subs[ingredientId] = foodId
  else delete subs[ingredientId]
  await repo.update('planned_meals', plannedMealId, { substitutions: subs })
}

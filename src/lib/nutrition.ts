import type { CookingYield, Food, Nutrients, RecipeIngredient } from '../db/types'

export const NUTRIENT_KEYS = [
  'energyKj', 'energyKcal', 'proteinG', 'fatG', 'satFatG', 'carbsG', 'sugarsG', 'addedSugarG', 'fibreG', 'sodiumMg',
] as const satisfies readonly (keyof Nutrients)[]

export const emptyNutrients = (): Nutrients => ({
  energyKj: 0, energyKcal: 0, proteinG: 0, fatG: 0, satFatG: 0, carbsG: 0, sugarsG: 0, addedSugarG: 0, fibreG: 0, sodiumMg: 0,
})

export function addNutrients(a: Nutrients, b: Nutrients, scale = 1): Nutrients {
  const out = { ...a }
  for (const k of NUTRIENT_KEYS) out[k] = a[k] + b[k] * scale
  return out
}

export function scaleNutrients(n: Nutrients, scale: number): Nutrients {
  return addNutrients(emptyNutrients(), n, scale)
}

export class NutritionError extends Error {}

/** Grams of edible food the ingredient line represents, as the food is described (raw or cooked). */
export function ingredientGrams(
  ing: Pick<RecipeIngredient, 'quantity' | 'unit' | 'weighed' | 'label'>,
  food: Food,
  yields: CookingYield[] = [],
): number {
  let g: number
  if (ing.unit === 'g') g = ing.quantity
  else if (ing.unit === 'ml') g = ing.quantity * (food.densityGPerMl ?? 1)
  else {
    if (!food.gramsPerUnit) throw new NutritionError(`${ing.label}: no weight per unit recorded for ${food.name}`)
    g = ing.quantity * food.gramsPerUnit
  }
  // A line weighed cooked against a raw food is converted back to raw weight with its yield.
  if (ing.weighed === 'cooked' && food.state === 'raw') {
    const y = yields.find((y) => y.rawFoodId === food.id)
    if (!y) throw new NutritionError(`${ing.label}: weighed cooked but no cooking yield for ${food.name}`)
    g = g / y.factor
  }
  return g
}

export interface RecipeNutrition {
  total: Nutrients
  perServing: Nutrients
  approximate: boolean // true while any ingredient still uses interim values
  missing: string[] // optional lines skipped, or lines that could not be calculated
}

export function recipeNutrition(
  ingredients: RecipeIngredient[],
  foodsById: Map<string, Food>,
  servings: number,
  yields: CookingYield[] = [],
  opts: { includeOptional?: boolean } = {},
): RecipeNutrition {
  let total = emptyNutrients()
  let approximate = false
  const missing: string[] = []
  for (const ing of ingredients) {
    if (ing.optional && !opts.includeOptional) continue
    const food = ing.foodId ? foodsById.get(ing.foodId) : undefined
    if (!food) {
      missing.push(ing.label)
      continue
    }
    try {
      const g = ingredientGrams(ing, food, yields)
      total = addNutrients(total, food.per100g, g / 100)
      if (food.source === 'interim') approximate = true
    } catch (e) {
      missing.push((e as Error).message)
    }
  }
  return { total, perServing: scaleNutrients(total, 1 / servings), approximate, missing }
}

/** Portion scale that lands protein at the target (never below 0.5 or above 2.5 servings). */
export function portionForProtein(perServingProteinG: number, targetG: number): number {
  if (perServingProteinG <= 0) return 1
  return Math.min(2.5, Math.max(0.5, Math.round((targetG / perServingProteinG) * 20) / 20))
}

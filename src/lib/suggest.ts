/**
 * "What can I cook from what I bought?" Ranks recipes by how much of each (by weight) is in
 * the pantry, with a bonus for using food that is close to its date. Pure function: the
 * caller loads the data. Food past its use-by date is never counted.
 */
import type { CookingYield, Food, InventoryLot, Product, Recipe, RecipeIngredient } from '../db/types'
import { ingredientGrams } from './nutrition'

export interface PantrySuggestion {
  recipe: Recipe
  coverage: number // 0..1 of the recipe's main ingredients by weight
  have: string[]
  missing: string[]
  usesSoon: string[] // ingredients from lots dated within 3 days
  score: number
}

const MINOR_G = 12 // spices, garlic, sauces: never decide a suggestion

export function suggestFromPantry(args: {
  recipes: Recipe[]
  ingredients: RecipeIngredient[]
  foods: Map<string, Food>
  yields: CookingYield[]
  products: Product[]
  lots: InventoryLot[]
  today: string
  limit?: number
}): PantrySuggestion[] {
  const { today } = args
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10)
  const productFood = new Map(args.products.map((p) => [p.id, p.foodId]))

  // grams in stock per food, and whether any of it is dated soon
  const stockG = new Map<string, number>()
  const soonFood = new Set<string>()
  for (const l of args.lots) {
    if (l.remaining <= 0) continue
    if (l.expiryDate && l.expiryDate < today && l.expiryKind !== 'best_before') continue // past use-by: never suggested
    const foodId = productFood.get(l.productId)
    if (!foodId) continue
    const f = args.foods.get(foodId)
    const g = l.unit === 'g' ? l.remaining : l.unit === 'ml' ? l.remaining * (f?.densityGPerMl ?? 1) : l.remaining * (f?.gramsPerUnit ?? 100)
    stockG.set(foodId, (stockG.get(foodId) ?? 0) + g)
    if (l.expiryDate && l.expiryDate <= soon) soonFood.add(foodId)
  }

  const byRecipe = new Map<string, RecipeIngredient[]>()
  for (const i of args.ingredients) {
    const list = byRecipe.get(i.recipeId) ?? []
    list.push(i)
    byRecipe.set(i.recipeId, list)
  }

  const out: PantrySuggestion[] = []
  for (const recipe of args.recipes) {
    if (recipe.fixedSlot) continue
    let total = 0
    let covered = 0
    const have: string[] = []
    const missing: string[] = []
    const usesSoon: string[] = []
    for (const ing of byRecipe.get(recipe.id) ?? []) {
      if (ing.optional || !ing.foodId) continue
      const food = args.foods.get(ing.foodId)
      if (!food) continue
      let g: number
      try {
        g = ingredientGrams({ ...ing, weighed: 'raw' }, food, args.yields)
      } catch {
        continue
      }
      if (g < MINOR_G) continue
      total += g
      const inStock = stockG.get(ing.foodId) ?? 0
      if (inStock >= g * 0.5) {
        covered += Math.min(g, inStock)
        have.push(ing.label)
        if (soonFood.has(ing.foodId)) usesSoon.push(ing.label)
      } else missing.push(ing.label)
    }
    if (total === 0 || have.length === 0) continue
    const coverage = covered / total
    out.push({ recipe, coverage, have, missing, usesSoon, score: coverage + (usesSoon.length ? 0.25 : 0) })
  }
  return out.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length).slice(0, args.limit ?? 10)
}

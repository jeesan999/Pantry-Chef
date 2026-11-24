import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/instance'
import { PROFILE_ID, SETTINGS_ID } from '../db/seed'
import type { Food, Recipe } from '../db/types'
import { recipeNutrition, type RecipeNutrition } from './nutrition'

export const useProfile = () => useLiveQuery(() => db.profile.get(PROFILE_ID))
export const useSettings = () => useLiveQuery(() => db.settings.get(SETTINGS_ID))
export const useApprovedTargets = () =>
  useLiveQuery(async () => (await db.nutrition_targets.where('status').equals('approved').toArray())[0] ?? null)
export const useProposedTargets = () =>
  useLiveQuery(async () => (await db.nutrition_targets.where('status').equals('proposed').toArray())[0] ?? null)

/** Per-serving nutrition for every recipe, recalculated whenever foods or ingredients change. */
export function useAllRecipeNutrition(): Map<string, RecipeNutrition> | undefined {
  return useLiveQuery(async () => {
    const [recipes, ings, foods, yields] = await Promise.all([
      db.recipes.toArray(),
      db.recipe_ingredients.toArray(),
      db.foods.toArray(),
      db.cooking_yields.toArray(),
    ])
    const foodMap = new Map<string, Food>(foods.map((f) => [f.id, f]))
    const byRecipe = new Map<string, typeof ings>()
    for (const i of ings) {
      const list = byRecipe.get(i.recipeId) ?? []
      list.push(i)
      byRecipe.set(i.recipeId, list)
    }
    return new Map(recipes.map((r: Recipe) => [r.id, recipeNutrition(byRecipe.get(r.id) ?? [], foodMap, r.servings, yields)]))
  })
}

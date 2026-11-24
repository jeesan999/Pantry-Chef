import { useLiveQuery } from 'dexie-react-hooks'
import { db, repo, today } from '../db/instance'
import { suggestFromPantry } from './suggest'
import { CONTRACT_VERSION } from '../engines/contract'
import { dayChoices } from './schedule'
import { PROFILE_ID, SETTINGS_ID } from '../db/seed'
import type { Food, Recipe } from '../db/types'
import { recipeNutrition, type RecipeNutrition } from './nutrition'

export const useProfile = () => useLiveQuery(() => db.profile.get(PROFILE_ID))
export const useSettings = () => useLiveQuery(() => db.settings.get(SETTINGS_ID))
// Records made under an older contract version are ignored, so a fresh proposal is asked for.
const current = <T extends { targetSet: { contractVersion: number } }>(r?: T) => (r && r.targetSet.contractVersion === CONTRACT_VERSION ? r : null)
export const useApprovedTargets = () =>
  useLiveQuery(async () => current((await db.nutrition_targets.where('status').equals('approved').toArray())[0]))
export const useProposedTargets = () =>
  useLiveQuery(async () => current((await db.nutrition_targets.where('status').equals('proposed').toArray())[0]))
export const useDayChoices = (dates: string[]) => useLiveQuery(() => dayChoices(repo, dates), [dates.join()])

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

/** Recipes ranked by how much of each is in the pantry (see lib/suggest.ts). */
export function usePantrySuggestions(limit = 64) {
  return useLiveQuery(async () => {
    const [recipes, ingredients, foods, yields, products, lots] = await Promise.all([
      db.recipes.toArray(),
      db.recipe_ingredients.toArray(),
      db.foods.toArray(),
      db.cooking_yields.toArray(),
      db.products.toArray(),
      db.inventory_lots.toArray(),
    ])
    return suggestFromPantry({ recipes, ingredients, foods: new Map(foods.map((f) => [f.id, f])), yields, products, lots, today: today(), limit })
  }, [limit])
}

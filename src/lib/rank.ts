/** Recipe ranking for a meal slot, shared by Today's picker and Chef. */
import type { Repo } from '../db/repo'
import type { Food, Recipe, RecipeRating } from '../db/types'
import type { SlotName } from '../engines/contract'
import { SLOT_TAGS } from './day'
import { portionForProtein, recipeNutrition, type RecipeNutrition } from './nutrition'
import { suggestFromPantry, type PantrySuggestion } from './suggest'

/** Per-serving nutrition for every recipe. */
export async function loadRecipeNutrition(repo: Repo): Promise<Map<string, RecipeNutrition>> {
  const [recipes, ings, foods, yields] = await Promise.all([
    repo.db.recipes.toArray(),
    repo.db.recipe_ingredients.toArray(),
    repo.db.foods.toArray(),
    repo.db.cooking_yields.toArray(),
  ])
  const foodMap = new Map<string, Food>(foods.map((f) => [f.id, f]))
  const byRecipe = new Map<string, typeof ings>()
  for (const i of ings) byRecipe.set(i.recipeId, [...(byRecipe.get(i.recipeId) ?? []), i])
  return new Map(recipes.map((r: Recipe) => [r.id, recipeNutrition(byRecipe.get(r.id) ?? [], foodMap, r.servings, yields)]))
}

/** Recipes ranked by how much of each is in the pantry (see suggest.ts). */
export async function loadPantrySuggestions(repo: Repo, today: string, limit = 64): Promise<PantrySuggestion[]> {
  const [recipes, ingredients, foods, yields, products, lots] = await Promise.all([
    repo.db.recipes.toArray(),
    repo.db.recipe_ingredients.toArray(),
    repo.db.foods.toArray(),
    repo.db.cooking_yields.toArray(),
    repo.db.products.toArray(),
    repo.db.inventory_lots.toArray(),
  ])
  return suggestFromPantry({ recipes, ingredients, foods: new Map(foods.map((f) => [f.id, f])), yields, products, lots, today, limit })
}

export interface SlotOption {
  r: Recipe
  n?: RecipeNutrition
  scale: number // portion that lands protein on the slot target
  kcal: number
  protein: number
  pantry: number // 0..1 of the recipe in the pantry
  soon: boolean // uses food dated soon
}

/** Recipes tagged for a slot, portioned to its protein target; what's in the pantry first, then the least scaling. */
export function rankForSlot(args: {
  slot: SlotName
  recipes: Recipe[]
  nutrition?: Map<string, RecipeNutrition>
  pantry?: PantrySuggestion[]
  targetProtein: number
  ratings?: Map<string, RecipeRating>
}): SlotOption[] {
  const tags = new Set(SLOT_TAGS[args.slot])
  const cover = new Map((args.pantry ?? []).map((p) => [p.recipe.id, p]))
  const liked = (id: string) => {
    const r = args.ratings?.get(id)
    if (!r) return 0
    return (r.flags.includes('favourite') ? 0.3 : 0) + (r.flags.includes('cook_again') ? 0.2 : 0) + (r.stars ? (r.stars - 3) * 0.1 : 0) -
      (r.flags.includes('too_expensive') || r.flags.includes('too_slow') ? 0.15 : 0) - (r.flags.includes('too_repetitive') ? 0.25 : 0)
  }
  const score = (o: SlotOption) => o.pantry + (o.soon ? 0.25 : 0) - Math.abs(o.scale - 1) + liked(o.r.id)
  return args.recipes
    .filter((r) => !r.fixedSlot && r.slotTags.some((t) => tags.has(t)) && !args.ratings?.get(r.id)?.flags.includes('do_not_recommend'))
    .map((r) => {
      const n = args.nutrition?.get(r.id)
      const scale = n ? portionForProtein(n.perServing.proteinG, args.targetProtein) : 1
      const pc = cover.get(r.id)
      return { r, n, scale, kcal: n ? n.perServing.energyKcal * scale : 0, protein: n ? n.perServing.proteinG * scale : 0, pantry: pc?.coverage ?? 0, soon: !!pc?.usesSoon.length }
    })
    .sort((a, b) => score(b) - score(a))
}

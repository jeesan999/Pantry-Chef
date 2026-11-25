/** Every starter recipe: the original 64 (data/recipes.ts) plus the expanded library (library/balanced.ts). */
import { STARTER_RECIPES, type StarterRecipe } from '../recipes'
import { LIBRARY_RECIPES } from './balanced'

export const ALL_RECIPES: StarterRecipe[] = [...STARTER_RECIPES, ...LIBRARY_RECIPES]
export { LIBRARY_RECIPES }
/** Bumped when starter recipes are added, so existing installs receive them once. */
export const RECIPE_LIBRARY_VERSION = 2

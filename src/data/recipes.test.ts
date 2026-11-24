import { describe, expect, it } from 'vitest'
import { INTERIM_FOODS, INTERIM_FOOD_ID, INTERIM_YIELDS } from './interimFoods'
import { STARTER_RECIPES } from './recipes'
import { recipeNutrition } from '../lib/nutrition'
import type { RecipeIngredient } from '../db/types'

const foods = new Map(INTERIM_FOODS.map((f) => [f.id, f]))
const yields = INTERIM_YIELDS.map((y) => ({ id: y.key, rawFoodId: INTERIM_FOOD_ID(y.key), method: y.method, factor: y.factor }))

function calc(r: (typeof STARTER_RECIPES)[number]) {
  const ings: RecipeIngredient[] = r.ingredients.map(([food, quantity, unit, label, flags], i) => ({
    id: String(i), recipeId: r.key, foodId: INTERIM_FOOD_ID(food), label, quantity, unit,
    weighed: flags?.includes('cooked') ? 'cooked' : 'raw', optional: !!flags?.includes('optional'), sort: i,
  }))
  return recipeNutrition(ings, foods, r.servings, yields)
}

describe('starter recipe library', () => {
  it('has 64 recipes across 8 cuisines with unique keys', () => {
    expect(STARTER_RECIPES).toHaveLength(64)
    expect(new Set(STARTER_RECIPES.map((r) => r.cuisine)).size).toBe(8)
    expect(new Set(STARTER_RECIPES.map((r) => r.key)).size).toBe(64)
  })

  it('every ingredient resolves to a food and calculates', () => {
    for (const r of STARTER_RECIPES) expect(calc(r).missing, r.key).toEqual([])
  })

  // Per serving at 1x. The planner scales portions 0.5–2.5x to hit protein, so the checks
  // are on shape: protein in a sensible band, and carbs/fat suited to the slot.
  it('smoko: 22–42 g protein, carbs ≥ 35 g, fat ≤ 20 g', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('smoko'))) {
      const n = calc(r).perServing
      expect(n.proteinG, r.key).toBeGreaterThanOrEqual(22)
      expect(n.proteinG, r.key).toBeLessThanOrEqual(42)
      expect(n.carbsG, r.key).toBeGreaterThanOrEqual(35)
      expect(n.fatG, r.key).toBeLessThanOrEqual(20)
    }
  })
  it('post-workout lunch: 35–62 g protein, carbs ≥ 85 g', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('post-workout'))) {
      const n = calc(r).perServing
      expect(n.proteinG, r.key).toBeGreaterThanOrEqual(35)
      expect(n.proteinG, r.key).toBeLessThanOrEqual(62)
      expect(n.carbsG, r.key).toBeGreaterThanOrEqual(85)
    }
  })
  it('low-carb dinner: 32–60 g protein, carbs ≤ 45 g, sat fat ≤ 8 g', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('low-carb-dinner'))) {
      const n = calc(r).perServing
      expect(n.proteinG, r.key).toBeGreaterThanOrEqual(32)
      expect(n.proteinG, r.key).toBeLessThanOrEqual(60)
      expect(n.carbsG, r.key).toBeLessThanOrEqual(45)
      expect(n.satFatG, r.key).toBeLessThanOrEqual(8)
    }
  })
})

if (process.env.RECIPE_REPORT) {
  console.log(STARTER_RECIPES.map((r) => {
    const n = calc(r).perServing
    return `${r.slotTags[0].padEnd(6)} ${r.key.padEnd(28)} P ${n.proteinG.toFixed(0).padStart(3)} C ${n.carbsG.toFixed(0).padStart(4)} F ${n.fatG.toFixed(0).padStart(3)} SF ${n.satFatG.toFixed(1).padStart(4)} kcal ${n.energyKcal.toFixed(0)}`
  }).join('\n'))
}

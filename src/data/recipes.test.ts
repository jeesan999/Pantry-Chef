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

  it('no vegetable or seed oils: cooking fat is ghee or coconut oil only', () => {
    const banned = ['olive_oil', 'sesame_oil', 'coconut_milk_light']
    for (const r of STARTER_RECIPES) {
      for (const [food] of r.ingredients) expect(banned, `${r.key} uses ${food}`).not.toContain(food)
      expect(r.method.join(' '), r.key).not.toMatch(/olive oil|sesame oil|vegetable oil|canola|sunflower/i)
    }
  })

  // Portions are scaled to each meal's protein target, so what matters is carbs and fat
  // relative to protein. Agreed pattern: ~150 g carbs/day over 3 meals, fat fills the rest.
  const ratios = (r: (typeof STARTER_RECIPES)[number]) => {
    const n = calc(r).perServing
    return { c: n.carbsG / n.proteinG, f: n.fatG / n.proteinG, p: n.proteinG }
  }
  it('smoko: 25–45 g protein; carbs 1.1–1.7x protein; fat at least 0.75x protein', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('smoko'))) {
      const x = ratios(r)
      expect(x.p, r.key).toBeGreaterThanOrEqual(25)
      expect(x.p, r.key).toBeLessThanOrEqual(45)
      expect(x.c, r.key).toBeGreaterThanOrEqual(1.1)
      expect(x.c, r.key).toBeLessThanOrEqual(1.7)
      expect(x.f, r.key).toBeGreaterThanOrEqual(0.75)
    }
  })
  it('post-workout lunch: 35–62 g protein; carbs 1.8–2.7x protein (the day\'s biggest); fat at least 0.55x', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('post-workout'))) {
      const x = ratios(r)
      expect(x.p, r.key).toBeGreaterThanOrEqual(35)
      expect(x.p, r.key).toBeLessThanOrEqual(62)
      expect(x.c, r.key).toBeGreaterThanOrEqual(1.8)
      expect(x.c, r.key).toBeLessThanOrEqual(2.7)
      expect(x.f, r.key).toBeGreaterThanOrEqual(0.55)
    }
  })
  it('low-carb dinner: 32–60 g protein; carbs at most 0.8x protein; fat at least 0.75x', () => {
    for (const r of STARTER_RECIPES.filter((r) => r.slotTags.includes('low-carb-dinner'))) {
      const x = ratios(r)
      expect(x.p, r.key).toBeGreaterThanOrEqual(32)
      expect(x.p, r.key).toBeLessThanOrEqual(60)
      expect(x.c, r.key).toBeLessThanOrEqual(0.8)
      expect(x.f, r.key).toBeGreaterThanOrEqual(0.75)
    }
  })
})

if (process.env.RECIPE_REPORT) {
  console.log(STARTER_RECIPES.map((r) => {
    const n = calc(r).perServing
    return `${r.slotTags[0].padEnd(6)} ${r.key.padEnd(28)} P ${n.proteinG.toFixed(0).padStart(3)} C ${n.carbsG.toFixed(0).padStart(4)} F ${n.fatG.toFixed(0).padStart(3)} SF ${n.satFatG.toFixed(1).padStart(4)} kcal ${n.energyKcal.toFixed(0)}`
  }).join('\n'))
}

import { describe, expect, it } from 'vitest'
import { INTERIM_FOODS, INTERIM_FOOD_ID, INTERIM_YIELDS } from '../data/interimFoods'
import type { Food, InventoryLot, Product, Recipe, RecipeIngredient } from '../db/types'
import { bestFoodMatch } from './foodMatch'
import { suggestFromPantry } from './suggest'

const foods: Food[] = INTERIM_FOODS.map(({ key: _k, afcdSearch: _a, ...f }) => f)

describe('receipt names link to foods', () => {
  it.each([
    ['Chicken Breast Fillets 1kg', 'chicken_breast'],
    ['Cobram Extra Virgin Olive Oil 750ml', 'olive_oil'],
    ['Macro Ghee 400g', 'ghee'],
    ['Eggs 12pk Free Range', 'egg'],
    ['Avocado Hass each', 'avocado'],
    ['Bananas Cavendish per kg', 'banana'],
    ['Beef Mince Regular 500g', 'beef_mince_regular'],
    ['Coconut Oil 300ml', 'coconut_oil'],
    ['Baby Spinach 120g', 'spinach'],
    ['Sweet Potato Gold', 'sweet_potato'],
    ['Jasmine Rice 2kg', 'rice_white'],
    ['SunRice Brown Rice 1kg', 'rice_brown'],
  ])('%s -> %s', (name, key) => {
    expect(bestFoodMatch(name, foods)?.food.id).toBe(INTERIM_FOOD_ID(key))
  })

  it.each(['Chicken Twisties 270g', 'Dishwashing Liquid 1L', 'Paper Towel 4pk'])('%s is not forced onto a food', (name) => {
    expect(bestFoodMatch(name, foods)).toBeNull()
  })
})

describe('suggestions from the pantry', () => {
  const recipe = (id: string): Recipe => ({ id, name: id, cuisine: 'Test', method: [], prepMin: 1, cookMin: 1, servings: 1, slotTags: ['lunch'], starter: true, createdAt: '', updatedAt: '' })
  const ing = (recipeId: string, food: string, quantity: number, label = food): RecipeIngredient => ({ id: `${recipeId}:${food}`, recipeId, foodId: INTERIM_FOOD_ID(food), label, quantity, unit: 'g', weighed: 'raw', optional: false, sort: 0 })
  const product = (food: string): Product => ({ id: `p:${food}`, foodId: INTERIM_FOOD_ID(food), name: food, category: 'x', storage: 'fridge', createdAt: '' })
  const lot = (food: string, g: number, expiryDate?: string, expiryKind: 'use_by' | 'best_before' = 'use_by'): InventoryLot => ({
    id: `l:${food}:${expiryDate}`, productId: `p:${food}`, quantity: g, remaining: g, unit: 'g', unitCostCents: 1, purchaseDate: '2026-11-20', expiryDate, expiryKind, location: 'fridge', createdAt: '',
  })
  const base = {
    foods: new Map(foods.map((f) => [f.id, f])),
    yields: INTERIM_YIELDS.map((y) => ({ id: y.key, rawFoodId: INTERIM_FOOD_ID(y.key), method: y.method, factor: y.factor })),
    today: '2026-11-24',
  }
  // A: chicken 150 + rice 100 + broccoli 100 + garlic 4 (minor) ; B: beef 150 + pasta 100
  const recipes = [recipe('A'), recipe('B')]
  const ingredients = [ing('A', 'chicken_breast', 150), ing('A', 'rice_white', 100), ing('A', 'broccoli', 100), ing('A', 'garlic', 4), ing('B', 'beef_rump', 150), ing('B', 'pasta', 100)]
  const products = ['chicken_breast', 'rice_white', 'beef_rump', 'broccoli'].map(product)

  it('ranks by share of weight in stock; garlic (4 g) does not count', () => {
    const s = suggestFromPantry({ ...base, recipes, ingredients, products, lots: [lot('chicken_breast', 500), lot('rice_white', 1000), lot('beef_rump', 300)] })
    expect(s.map((x) => x.recipe.id)).toEqual(['A', 'B'])
    expect(s[0].coverage).toBeCloseTo(250 / 350, 6) // chicken + rice of 350 g
    expect(s[0].missing).toEqual(['broccoli'])
    expect(s[1].coverage).toBeCloseTo(150 / 250, 6)
  })

  it('food dated within 3 days earns a bonus and is listed', () => {
    const s = suggestFromPantry({ ...base, recipes, ingredients, products, lots: [lot('chicken_breast', 500), lot('beef_rump', 300, '2026-11-26'), lot('pasta', 0)] })
    expect(s[0].recipe.id).toBe('B') // 0.6 + 0.25 beats A's 150/350 = 0.43
    expect(s[0].usesSoon).toEqual(['beef_rump'])
  })

  it('never counts food past its use-by date (best-before is still fine)', () => {
    const s = suggestFromPantry({ ...base, recipes, ingredients, products, lots: [lot('beef_rump', 300, '2026-11-23', 'use_by')] })
    expect(s.find((x) => x.recipe.id === 'B')).toBeUndefined()
    const t = suggestFromPantry({ ...base, recipes, ingredients, products, lots: [lot('beef_rump', 300, '2026-11-23', 'best_before')] })
    expect(t.find((x) => x.recipe.id === 'B')).toBeDefined()
  })

  it('less than half the needed amount does not count as having it', () => {
    const s = suggestFromPantry({ ...base, recipes, ingredients, products, lots: [lot('chicken_breast', 70)] })
    expect(s).toEqual([])
  })
})

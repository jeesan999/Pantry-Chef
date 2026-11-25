import { describe, expect, it } from 'vitest'
import type { Food, InventoryLot, Product, Recipe, RecipeIngredient } from '../../db/types'
import { buildPriceIndex } from '../cost/engine'
import { buildShoppingNeeds, convert, formatQty, roundUpToBuy, type ShoppingInput } from './engine'

const N = { energyKj: 0, energyKcal: 0, proteinG: 0, fatG: 0, satFatG: 0, carbsG: 0, sugarsG: 0, addedSugarG: 0, fibreG: 0, sodiumMg: 0 }
const food = (key: string, name: string, extra: Partial<Food> = {}): Food => ({ id: `food:${key}`, name, source: 'interim', state: 'raw', ediblePortion: 1, per100g: N, updatedAt: '', ...extra })
const recipe = (id: string, servings = 1): Recipe => ({ id, name: id, cuisine: 'x', method: [], prepMin: 0, cookMin: 0, servings, slotTags: ['dinner'], starter: true, createdAt: '', updatedAt: '' })
let n = 0
const ing = (recipeId: string, foodKey: string, quantity: number, unit: RecipeIngredient['unit'] = 'g', extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
  id: `i${n++}`, recipeId, foodId: `food:${foodKey}`, label: foodKey, quantity, unit, weighed: 'raw', optional: false, sort: 0, ...extra,
})
const lot = (productId: string, remaining: number, unit: InventoryLot['unit'] = 'g', extra: Partial<InventoryLot> = {}): InventoryLot => ({
  id: `l${n++}`, productId, quantity: remaining, remaining, unit, unitCostCents: 0, purchaseDate: '2026-11-20', location: 'fridge', createdAt: '', ...extra,
})

const foods = new Map([
  ['food:chicken', food('chicken', 'Chicken, breast, lean flesh, raw')],
  ['food:rice', food('rice', 'Rice, white, uncooked')],
  ['food:egg', food('egg', 'Egg, chicken, whole, raw', { gramsPerUnit: 50 })],
  ['food:oil', food('oil', 'Oil, olive')],
  ['food:herb', food('herb', 'Parsley, raw')],
])
const chickenProduct: Product = { id: 'p-chicken', foodId: 'food:chicken', name: 'Chicken Breast Fillets 1kg', category: 'Meat & seafood', storage: 'fridge', createdAt: '' }

function input(over: Partial<ShoppingInput> = {}): ShoppingInput {
  const recipes = new Map([['dinner', recipe('dinner')], ['bowl', recipe('bowl', 2)]])
  const products = over.products ?? [chickenProduct]
  return {
    meals: [{ date: '2026-11-26', recipeId: 'dinner', portionScale: 1 }, { date: '2026-11-27', recipeId: 'dinner', portionScale: 1.5 }],
    recipes,
    ingredients: [ing('dinner', 'chicken', 200), ing('dinner', 'rice', 100), ing('dinner', 'herb', 5, 'g', { optional: true }), ing('bowl', 'egg', 4, 'unit'), ing('bowl', 'chicken', 300)],
    foods,
    yields: [],
    products,
    lots: [],
    prices: buildPriceIndex([{ productId: 'p-chicken', date: '2026-11-20', store: 'W', cents: 1000, unit: 'g' }], new Map(products.map((p) => [p.id, p]))),
    ...over,
  }
}
const line = (needs: ReturnType<typeof buildShoppingNeeds>, label: RegExp) => needs.find((x) => label.test(x.label))!

describe('rounding and units', () => {
  it('rounds up to whole items, 10 g below 50, 50 g above', () => {
    expect(roundUpToBuy(2.1, 'unit')).toBe(3)
    expect(roundUpToBuy(2, 'unit')).toBe(2)
    expect(roundUpToBuy(12, 'g')).toBe(20)
    expect(roundUpToBuy(501, 'g')).toBe(550)
    expect(roundUpToBuy(0, 'g')).toBe(0)
  })
  it('converts items to grams through grams per item', () => {
    expect(convert(3, 'unit', 'g', foods.get('food:egg'))).toBe(150)
    expect(convert(100, 'g', 'unit', foods.get('food:egg'))).toBe(2)
    expect(convert(1, 'unit', 'g', foods.get('food:rice'))).toBeNull()
    expect(formatQty(1250, 'g')).toBe('1.25 kg')
    expect(formatQty(600, 'ml')).toBe('600 ml')
    expect(formatQty(3, 'unit')).toBe('3')
  })
})

describe('building the list', () => {
  it('sums every planned use with portion scale; optional ingredients left out', () => {
    const needs = buildShoppingNeeds(input())
    expect(line(needs, /^Chicken/).neededQty).toBe(500) // 200 + 300
    expect(line(needs, /rice/i).neededQty).toBe(250)
    expect(needs.find((x) => /parsley/i.test(x.label))).toBeUndefined()
  })

  it('divides by recipe servings', () => {
    const needs = buildShoppingNeeds(input({ meals: [{ date: '2026-11-26', recipeId: 'bowl', portionScale: 1 }] }))
    expect(line(needs, /^Chicken/).neededQty).toBe(150)
    expect(line(needs, /egg/i)).toMatchObject({ label: 'Eggs', category: 'Dairy & eggs', neededQty: 2, unit: 'unit', buyQty: 2 })
  })

  it('names lines after a product you have bought, else a readable food name; prices only where known', () => {
    const needs = buildShoppingNeeds(input())
    expect(line(needs, /^Chicken/)).toMatchObject({ label: 'Chicken Breast Fillets 1kg', productId: 'p-chicken', category: 'Meat & seafood', buyQty: 500, costCents: 500 })
    expect(line(needs, /rice/i)).toMatchObject({ label: 'White rice', productId: undefined, costCents: null, category: 'Grains & bread' })
  })

  it('takes pantry stock off, including part cover', () => {
    const needs = buildShoppingNeeds(input({ lots: [lot('p-chicken', 320)] }))
    expect(line(needs, /^Chicken/)).toMatchObject({ haveQty: 320, buyQty: 200, costCents: 200 }) // 180 short, rounded to 200
  })

  it('fully covered lines buy nothing and cost nothing', () => {
    const needs = buildShoppingNeeds(input({ lots: [lot('p-chicken', 1000)] }))
    expect(line(needs, /^Chicken/)).toMatchObject({ haveQty: 500, buyQty: 0, costCents: 0 })
  })

  it('stock of another product for the same food counts', () => {
    const other: Product = { id: 'p-other', foodId: 'food:chicken', name: 'Free range breast', category: 'Meat & seafood', storage: 'fridge', createdAt: '' }
    const needs = buildShoppingNeeds(input({ products: [chickenProduct, other], lots: [lot('p-other', 500)] }))
    expect(line(needs, /^Chicken/).buyQty).toBe(0)
  })

  it('stock past its use-by on the day of the meal does not count; best-before still does', () => {
    // 26th: 200 g, 27th: 300 g. Lot of 600 g with use-by on the 26th covers only the first meal.
    const useBy = buildShoppingNeeds(input({ lots: [lot('p-chicken', 600, 'g', { expiryDate: '2026-11-26', expiryKind: 'use_by' })] }))
    expect(line(useBy, /^Chicken/)).toMatchObject({ haveQty: 200, buyQty: 300 })
    const bestBefore = buildShoppingNeeds(input({ lots: [lot('p-chicken', 600, 'g', { expiryDate: '2026-11-20', expiryKind: 'best_before' })] }))
    expect(line(bestBefore, /^Chicken/).buyQty).toBe(0)
  })

  it('uses the soonest-dated stock first', () => {
    const needs = buildShoppingNeeds(input({
      lots: [lot('p-chicken', 300, 'g', { expiryDate: '2026-12-30' }), lot('p-chicken', 200, 'g', { expiryDate: '2026-11-26', expiryKind: 'use_by' })],
    }))
    // the short-dated 200 g covers the 26th, the long-dated 300 g the 27th
    expect(line(needs, /^Chicken/).buyQty).toBe(0)
  })

  it('mixed units for one food become grams when they convert', () => {
    const needs = buildShoppingNeeds(input({
      meals: [{ date: '2026-11-26', recipeId: 'dinner', portionScale: 1 }],
      ingredients: [ing('dinner', 'egg', 2, 'unit'), ing('dinner', 'egg', 30, 'g')],
      lots: [],
    }))
    expect(line(needs, /egg/i)).toMatchObject({ unit: 'g', neededQty: 130, buyQty: 150 })
  })

  it('pantry stock in items counts against a need in grams', () => {
    const eggProduct: Product = { id: 'p-egg', foodId: 'food:egg', name: 'Eggs 12pk', category: 'Dairy & eggs', storage: 'fridge', createdAt: '' }
    const needs = buildShoppingNeeds(input({
      meals: [{ date: '2026-11-26', recipeId: 'dinner', portionScale: 1 }],
      ingredients: [ing('dinner', 'egg', 100, 'g')],
      products: [chickenProduct, eggProduct],
      lots: [lot('p-egg', 1, 'unit')],
    }))
    expect(line(needs, /egg/i)).toMatchObject({ haveQty: 50, buyQty: 50 })
  })

  it('cooked weights are bought as raw weight through the cooking yield', () => {
    const needs = buildShoppingNeeds(input({
      meals: [{ date: '2026-11-26', recipeId: 'dinner', portionScale: 1 }],
      ingredients: [ing('dinner', 'rice', 300, 'g', { weighed: 'cooked' })],
      yields: [{ id: 'y', rawFoodId: 'food:rice', method: 'boiled', factor: 3 }],
    }))
    expect(line(needs, /rice/i).neededQty).toBe(100)
  })
})

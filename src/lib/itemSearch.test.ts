import { describe, expect, it } from 'vitest'
import { INTERIM_FOODS } from '../data/interimFoods'
import type { Food, Product } from '../db/types'
import { displayName, guessCategory, guessStorage, searchItems } from './itemSearch'

const foods: Food[] = INTERIM_FOODS.map(({ key: _k, afcdSearch: _a, ...f }) => f)
const top = (q: string, products: Product[] = []) => searchItems(q, products, foods).map((h) => h.label)

describe('readable names', () => {
  it.each([
    ['Chicken, breast, lean flesh, raw', 'Chicken breast'],
    ['Sauce, soy, reduced salt', 'Soy sauce, reduced salt'],
    ['Oil, olive', 'Olive oil'],
    ['Cheese, cheddar, natural', 'Cheddar cheese'],
    ['Egg, chicken, whole, raw', 'Eggs'],
    ['Capsicum, red, raw', 'Red capsicum'],
    ['Avocado, raw', 'Avocado'],
    ['Sauce, tomato', 'Tomato sauce'],
    ['Sauce, salsa, tomato based', 'Salsa'],
    ['Rice, white, raw', 'White rice'],
  ])('%s -> %s', (name, want) => expect(displayName(name)).toBe(want))
})

describe('type-ahead', () => {
  it('"soy" offers soy sauce first', () => expect(top('soy')[0]).toBe('Soy sauce, reduced salt'))
  it('"chick" offers chicken cuts and chickpeas', () => {
    const t = top('chick')
    expect(t.slice(0, 4).some((l) => l.startsWith('Chicken'))).toBe(true)
    expect(t).toContain('Chickpea')
  })
  it('everyday names work: ketchup, mayo, snags, evoo', () => {
    expect(top('ketchup')[0]).toBe('Tomato sauce')
    expect(top('mayo')[0]).toBe('Mayonnaise')
    expect(top('snags')[0]).toMatch(/^Sausage/)
    expect(top('evoo')[0]).toBe('Olive oil')
  })
  it('sauces are covered: oyster, hoisin, sweet chilli, BBQ, worcestershire', () => {
    expect(top('oyster')[0]).toBe('Oyster sauce')
    expect(top('hoisin')[0]).toBe('Hoisin sauce')
    expect(top('sweet chil')[0]).toBe('Sweet chilli sauce')
    expect(top('bbq')[0]).toBe('Barbecue sauce')
    expect(top('worces')[0]).toBe('Worcestershire sauce')
  })
  it('"egg" offers Eggs; "white ri" offers White rice', () => {
    expect(top('egg')[0]).toBe('Eggs')
    expect(top('white ri')[0]).toBe('White rice')
  })
  it('your own products come before the food list', () => {
    const mine: Product = { id: 'p1', name: 'Kikkoman Soy Sauce 250ml', foodId: 'food:soy_sauce', category: 'Oils & sauces', storage: 'pantry', createdAt: '' }
    const hits = searchItems('soy', [mine], foods)
    expect(hits[0]).toMatchObject({ kind: 'product', label: 'Kikkoman Soy Sauce 250ml' })
    // the linked food is not offered a second time
    expect(hits.filter((h) => h.kind === 'food' && h.food.id === 'food:soy_sauce')).toHaveLength(0)
  })
  it('nothing typed, nothing shown; nonsense finds nothing', () => {
    expect(top('')).toEqual([])
    expect(top('zzqx')).toEqual([])
  })
})

describe('category and storage guesses', () => {
  it.each([
    ['Chicken breast', 'Meat & seafood', 'fridge'],
    ['Soy sauce', 'Oils & sauces', 'pantry'],
    ['Baby spinach', 'Fruit & veg', 'fridge'],
    ['Mixed vegetables, frozen', 'Frozen', 'freezer'],
    ['Jasmine rice', 'Grains & bread', 'pantry'],
    ['Greek yoghurt', 'Dairy & eggs', 'fridge'],
    ['Fish sauce', 'Oils & sauces', 'pantry'],
    ['Coconut cream, canned', 'Tins & jars', 'pantry'],
    ['Chicken stock', 'Oils & sauces', 'pantry'],
    ['Eggs', 'Dairy & eggs', 'fridge'],
  ])('%s -> %s, %s', (name, cat, store) => {
    expect(guessCategory(name)).toBe(cat)
    expect(guessStorage(guessCategory(name), name)).toBe(store)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, STORES } from './schema'
import { IntegrityError, newId, nowIso, Repo } from './repo'
import { Pantry } from './pantry'
import type { Food, Product, Recipe } from './types'

let repo: Repo
let pantry: Pantry

const zero = { energyKj: 0, energyKcal: 0, proteinG: 0, fatG: 0, satFatG: 0, carbsG: 0, sugarsG: 0, addedSugarG: 0, fibreG: 0, sodiumMg: 0 }

function food(name = 'Rice, white, raw'): Food {
  return { id: newId(), name, source: 'manual', state: 'raw', ediblePortion: 1, per100g: zero, updatedAt: nowIso() }
}
function product(foodId?: string): Product {
  return { id: newId(), foodId, name: 'Rice 1 kg', category: 'Grains', storage: 'pantry', createdAt: nowIso() }
}
function recipe(): Recipe {
  return { id: newId(), name: 'Test', cuisine: 'Test', method: [], prepMin: 1, cookMin: 1, servings: 1, slotTags: ['lunch'], starter: false, createdAt: nowIso(), updatedAt: nowIso() }
}

beforeEach(async () => {
  const db = openDb(`test-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
})

describe('schema', () => {
  it('has exactly 30 tables', () => {
    expect(Object.keys(STORES)).toHaveLength(30)
    expect(repo.db.tables).toHaveLength(30)
  })
})

describe('repository integrity', () => {
  it('rejects a record that points at a missing parent', async () => {
    await expect(repo.insert('products', product('no-such-food'))).rejects.toThrow(/missing foods/)
  })

  it('rejects an invalid record (validation)', async () => {
    const f = food()
    f.ediblePortion = 0
    await expect(repo.insert('foods', f)).rejects.toBeInstanceOf(IntegrityError)
  })

  it('rejects an ingredient with neither food nor product', async () => {
    const r = await repo.insert('recipes', recipe())
    await expect(
      repo.insert('recipe_ingredients', { id: newId(), recipeId: r.id, label: 'x', quantity: 10, unit: 'g', weighed: 'raw', optional: false, sort: 0 }),
    ).rejects.toThrow(/food or a product/)
  })

  it('restricts deleting a food used by a product', async () => {
    const f = await repo.insert('foods', food())
    await repo.insert('products', product(f.id))
    await expect(repo.remove('foods', f.id)).rejects.toThrow(/cannot delete foods/)
    expect(await repo.get('foods', f.id)).toBeDefined()
  })

  it('cascades deleting a recipe to its ingredients and ratings', async () => {
    const f = await repo.insert('foods', food())
    const r = await repo.insert('recipes', recipe())
    await repo.insert('recipe_ingredients', { id: newId(), recipeId: r.id, foodId: f.id, label: 'rice', quantity: 80, unit: 'g', weighed: 'raw', optional: false, sort: 0 })
    await repo.insert('recipe_ratings', { id: newId(), recipeId: r.id, stars: 4, flags: ['favourite'], at: nowIso() })
    await repo.remove('recipes', r.id)
    expect(await repo.db.recipe_ingredients.count()).toBe(0)
    expect(await repo.db.recipe_ratings.count()).toBe(0)
    expect(await repo.db.foods.count()).toBe(1)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('a failed cascade leaves nothing deleted (transaction rolls back)', async () => {
    const f = await repo.insert('foods', food())
    const p = await repo.insert('products', product(f.id))
    const r = await repo.insert('recipes', recipe())
    await repo.insert('recipe_ingredients', { id: newId(), recipeId: r.id, productId: p.id, label: 'rice', quantity: 80, unit: 'g', weighed: 'raw', optional: false, sort: 0 })
    await pantry.addLot({ productId: p.id, quantity: 1000, unit: 'g', totalCostCents: 300, purchaseDate: '2026-11-24', location: 'pantry' })
    // Deleting the product is blocked by the lot even though the ingredient would also block.
    await expect(repo.remove('products', p.id)).rejects.toThrow()
    expect(await repo.db.products.count()).toBe(1)
    expect(await repo.db.recipe_ingredients.count()).toBe(1)
  })

  it('refuses to edit or delete the append-only ledger', async () => {
    const p = await repo.insert('products', product())
    await pantry.addLot({ productId: p.id, quantity: 10, unit: 'unit', totalCostCents: 500, purchaseDate: '2026-11-24', location: 'fridge' })
    const txn = (await repo.db.inventory_transactions.toArray())[0]
    await expect(repo.update('inventory_transactions', txn.id, { qtyDelta: 99 })).rejects.toThrow(/append-only/)
    await expect(repo.remove('inventory_transactions', txn.id)).rejects.toThrow(/append-only/)
  })
})

describe('pantry ledger', () => {
  it('adds a lot with a purchase transaction and unit cost', async () => {
    const p = await repo.insert('products', product())
    // 12 eggs for $7.20 -> 60 cents each
    const lot = await pantry.addLot({ productId: p.id, quantity: 12, unit: 'unit', totalCostCents: 720, purchaseDate: '2026-11-24', location: 'fridge' })
    expect(lot.unitCostCents).toBe(60)
    expect((await repo.get('inventory_lots', lot.id))!.remaining).toBe(12)
    const txns = await repo.db.inventory_transactions.toArray()
    expect(txns.map((t) => [t.type, t.qtyDelta])).toEqual([['purchase', 12]])
  })

  it('consume, discard (with waste cost) and undo keep the lot balance right', async () => {
    const p = await repo.insert('products', product())
    const lot = await pantry.addLot({ productId: p.id, quantity: 12, unit: 'unit', totalCostCents: 720, purchaseDate: '2026-11-24', location: 'fridge' })
    const c = await pantry.consume(lot.id, 4) // 12 - 4 = 8
    const waste = await pantry.discard(lot.id, 2, 'expired') // 8 - 2 = 6, waste 2 x 60 = 120 c
    expect(waste.costCents).toBe(120)
    expect((await repo.get('inventory_lots', lot.id))!.remaining).toBe(6)
    await pantry.undo(c.id) // 6 + 4 = 10
    expect((await repo.get('inventory_lots', lot.id))!.remaining).toBe(10)
    await expect(pantry.undo(c.id)).rejects.toThrow(/already been undone/)
    const types = (await repo.db.inventory_transactions.toArray()).map((t) => t.type)
    expect(types.sort()).toEqual(['consume', 'discard', 'purchase', 'undo'])
  })

  it('refuses to consume more than is left, and changes nothing', async () => {
    const p = await repo.insert('products', product())
    const lot = await pantry.addLot({ productId: p.id, quantity: 500, unit: 'g', totalCostCents: 1000, purchaseDate: '2026-11-24', location: 'fridge' })
    await expect(pantry.consume(lot.id, 501)).rejects.toThrow(/only 500 g left/)
    expect((await repo.get('inventory_lots', lot.id))!.remaining).toBe(500)
    expect(await repo.db.inventory_transactions.count()).toBe(1)
  })

  it('weighted average cost = cents of stock remaining / quantity remaining', async () => {
    const p = await repo.insert('products', product())
    // Lot A: 1000 g for $10.00 (1.0 c/g); Lot B: 500 g for $7.50 (1.5 c/g)
    const a = await pantry.addLot({ productId: p.id, quantity: 1000, unit: 'g', totalCostCents: 1000, purchaseDate: '2026-11-01', location: 'freezer' })
    await pantry.addLot({ productId: p.id, quantity: 500, unit: 'g', totalCostCents: 750, purchaseDate: '2026-11-20', location: 'freezer' })
    // (1000 x 1.0 + 500 x 1.5) / 1500 = 1750 / 1500 = 1.1667 c/g
    expect(await pantry.weightedAverageCost(p.id)).toBeCloseTo(1750 / 1500, 10)
    await pantry.consume(a.id, 600) // A left 400: (400 + 750) / 900 = 1.2778 c/g
    expect(await pantry.weightedAverageCost(p.id)).toBeCloseTo(1150 / 900, 10)
  })

  it('consumes a product earliest-expiry first across lots', async () => {
    const p = await repo.insert('products', product())
    const late = await pantry.addLot({ productId: p.id, quantity: 300, unit: 'g', totalCostCents: 300, purchaseDate: '2026-11-20', expiryDate: '2026-12-10', location: 'fridge' })
    const soon = await pantry.addLot({ productId: p.id, quantity: 200, unit: 'g', totalCostCents: 200, purchaseDate: '2026-11-18', expiryDate: '2026-11-26', location: 'fridge' })
    await pantry.consumeProduct(p.id, 250)
    expect((await repo.get('inventory_lots', soon.id))!.remaining).toBe(0)
    expect((await repo.get('inventory_lots', late.id))!.remaining).toBe(250)
  })

  it('undoing a purchase that has been partly eaten is refused', async () => {
    const p = await repo.insert('products', product())
    const lot = await pantry.addLot({ productId: p.id, quantity: 10, unit: 'unit', totalCostCents: 100, purchaseDate: '2026-11-24', location: 'pantry' })
    await pantry.consume(lot.id, 3)
    const purchase = (await repo.db.inventory_transactions.where('type').equals('purchase').toArray())[0]
    await expect(pantry.undo(purchase.id)).rejects.toThrow(/only 7 unit left/)
  })
})

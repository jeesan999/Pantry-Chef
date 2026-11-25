import { readFileSync } from 'node:fs'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, STORES_V1 } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { approveTargets, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { assignMeal, clearMeal } from './day'
import { eatMeal, eatQuick, ensureBreakfast, loadDay, previewEat, skipMeal, undoEaten } from './eating'

const TODAY = '2026-11-26'
const BOWL = 'recipe:au-chicken-rice-bowl' // chicken 150 g, rice 150 g, broccoli, peas, olive oil, lemon, garlic
let repo: Repo
let pantry: Pantry
let lunchId: string

beforeEach(async () => {
  const db = openDb(`eat-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-20')
  const { record } = await proposeTargets(repo, TODAY)
  const t = await approveTargets(repo, record.id)
  await assignMeal(repo, { date: TODAY, slot: 'lunch', time: '14:00', recipeId: BOWL, portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
  lunchId = (await repo.db.planned_meals.toArray())[0].id
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  await saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines, imageHash: 'h' })
})

const lotOf = async (re: RegExp) => {
  const p = (await repo.db.products.toArray()).find((x) => re.test(x.name))!
  return (await repo.db.inventory_lots.where('productId').equals(p.id).first())!
}

describe('eating a planned meal', () => {
  it('preview: what leaves the pantry, what isn’t there', async () => {
    const pre = await previewEat(repo, lunchId, 1)
    expect(pre.lines.find((l) => l.label === 'Chicken breast')).toMatchObject({ taken: '150 g', missing: null })
    expect(pre.lines.find((l) => l.label === 'Broccoli')).toMatchObject({ taken: '', missing: '100 g' })
    expect(pre.nutrition.proteinG).toBeGreaterThan(30)
    expect(pre.costCents).toBeGreaterThan(0)
  })

  it('half eaten: the whole portion leaves the pantry, half as leftover waste; undo restores everything', async () => {
    const chickenBefore = (await lotOf(/^Chicken/)).remaining
    const full = await previewEat(repo, lunchId, 1)
    const c = await eatMeal(repo, pantry, lunchId, 0.5, TODAY)
    expect(c.nutrition.proteinG).toBeCloseTo(full.nutrition.proteinG / 2, 6)
    expect((await lotOf(/^Chicken/)).remaining).toBeCloseTo(chickenBefore - 150, 6)
    const waste = await repo.db.waste_records.toArray()
    expect(waste.length).toBeGreaterThan(0)
    expect(waste.every((w) => w.reason === 'leftover')).toBe(true)
    const day = await loadDay(repo, TODAY)
    expect(day.totals.proteinG).toBeCloseTo(c.nutrition.proteinG, 6)
    expect((await repo.db.nutritional_records.where('date').equals(TODAY).first())!.totals.proteinG).toBeCloseTo(c.nutrition.proteinG, 6)
    await expect(eatMeal(repo, pantry, lunchId, 1, TODAY)).rejects.toThrow(/already logged/)
    await expect(assignMeal(repo, { date: TODAY, slot: 'lunch', time: '14:00', recipeId: BOWL, portionScale: 2, targetsId: 'x', targetsVersion: 1 })).rejects.toThrow(/already marked eaten/)

    await undoEaten(repo, pantry, c.id)
    expect((await lotOf(/^Chicken/)).remaining).toBeCloseTo(chickenBefore, 6)
    expect((await loadDay(repo, TODAY)).totals.proteinG).toBe(0)
    expect(await repo.db.nutritional_records.count()).toBe(0)
    // after undo it can be eaten again, or cleared
    await clearMeal(repo, TODAY, 'lunch')
    expect(await repo.db.planned_meals.count()).toBe(0)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('skipped: nothing leaves the pantry; breakfast gets a planned row when logged; complete day', async () => {
    const before = (await lotOf(/^Chicken/)).remaining
    await skipMeal(repo, pantry, lunchId, TODAY)
    expect((await lotOf(/^Chicken/)).remaining).toBe(before)
    expect((await loadDay(repo, TODAY)).complete).toBe(false) // breakfast not logged yet
    const b = await ensureBreakfast(repo, TODAY)
    await eatMeal(repo, pantry, b.id, 1, TODAY)
    const day = await loadDay(repo, TODAY)
    expect(day.complete).toBe(true)
    expect(day.totals.energyKcal).toBeGreaterThan(400)
  })

  it('refuses future dates and more than a week back', async () => {
    await expect(eatMeal(repo, pantry, lunchId, 1, '2026-11-25')).rejects.toThrow(/today or earlier/)
    await expect(eatMeal(repo, pantry, lunchId, 1, '2026-12-10')).rejects.toThrow(/7 days back/)
  })
})

describe('quick foods', () => {
  it('a banana from the pantry: nutrition, stock and cost; undo', async () => {
    const banana = (await repo.db.products.toArray()).find((p) => /banana/i.test(p.name))!
    const before = (await lotOf(/banana/i)).remaining
    const c = await eatQuick(repo, pantry, { choice: { kind: 'product', product: banana }, quantity: 120, unit: 'g', date: TODAY, fromPantry: true }, TODAY)
    expect(c.quick).toMatchObject({ label: banana.name, grams: 120 })
    expect(c.nutrition.energyKcal).toBeGreaterThan(80)
    expect((await lotOf(/banana/i)).remaining).toBeCloseTo(before - 120, 6)
    expect(c.costCents).toBeGreaterThan(0)
    expect((await loadDay(repo, TODAY)).quick).toHaveLength(1)
    await undoEaten(repo, pantry, c.id)
    expect((await lotOf(/banana/i)).remaining).toBeCloseTo(before, 6)
  })

  it('a food not from the pantry; items need a weight', async () => {
    const eggFood = (await repo.db.foods.toArray()).find((f) => f.id === 'food:egg')!
    const c = await eatQuick(repo, pantry, { choice: { kind: 'food', food: eggFood, label: 'Eggs' }, quantity: 2, unit: 'unit', date: TODAY, fromPantry: false }, TODAY)
    expect(c.quick!.grams).toBe(2 * eggFood.gramsPerUnit!)
    const noWeight = { ...eggFood, gramsPerUnit: undefined }
    await expect(eatQuick(repo, pantry, { choice: { kind: 'food', food: noWeight, label: 'Egg' }, quantity: 1, unit: 'unit', date: TODAY, fromPantry: false }, TODAY)).rejects.toThrow(/grams instead/)
    expect(await repo.checkIntegrity()).toEqual([])
  })
})

describe('schema upgrade', () => {
  it('version 1 databases open as version 2 with dates filled in', async () => {
    const name = `v1-${newId()}`
    const old = new Dexie(name)
    old.version(1).stores(STORES_V1)
    await old.open()
    await old.table('planned_meals').put({ id: 'pm', mealPlanId: 'x', date: '2026-11-20', slot: 'lunch', time: '13:00', recipeId: 'r', portionScale: 1 })
    await old.table('meal_consumption').put({ id: 'c', plannedMealId: 'pm', fractionEaten: 1, nutrition: {}, costCents: 0, at: '2026-11-20T03:00:00.000Z', undone: false })
    old.close()
    const db = openDb(name)
    await db.open()
    expect(db.verno).toBe(2)
    expect(await db.meal_consumption.where('date').equals('2026-11-20').first()).toMatchObject({ id: 'c', time: '13:00', slot: 'lunch' })
  })
})

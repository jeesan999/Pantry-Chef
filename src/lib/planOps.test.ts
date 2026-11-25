import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { approveTargets, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { eatMeal } from './eating'
import { saveBudget } from './expenses'
import { loadMealContext, mealNutrition } from './meals'
import { bulkPrep, copyMeal, daySummaries, planCosts, regenerateMeal, setMealRecipe } from './planOps'
import { generateList, packsFor, removeItem, setItemQuantity } from './shopping'

const D = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'] // Thu..Sun
const BOWL = 'recipe:au-chicken-rice-bowl'
let repo: Repo
let pantry: Pantry

beforeEach(async () => {
  const db = openDb(`ops-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-20')
  const { record } = await proposeTargets(repo, D[0])
  await approveTargets(repo, record.id)
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  await saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines: await toCheckedLines(repo, p, await repo.db.foods.toArray()), imageHash: 'h' })
})
const at = (date: string, slot: 'lunch' | 'dinner' = 'lunch') => repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first()

describe('choosing, copying and regenerating meals', () => {
  it('choose a recipe for one meal, copy it to the other days with its swap, skip a logged day, undo', async () => {
    await setMealRecipe(repo, D[0], 'lunch', BOWL)
    const first = (await at(D[0]))!
    await repo.update('planned_meals', first.id, { substitutions: { [`${BOWL}:2`]: 'food:green_beans' } })
    // Saturday's lunch is something else and already eaten
    await setMealRecipe(repo, D[2], 'lunch', 'recipe:kr-bibimbap')
    await eatMeal(repo, pantry, (await at(D[2]))!.id, 1, D[3])
    const r = await copyMeal(repo, (await at(D[0]))!, D)
    expect(r.copied).toBe(2)
    expect(r.skipped).toEqual([D[2]])
    for (const d of [D[1], D[3]]) expect(await at(d)).toMatchObject({ recipeId: BOWL, substitutions: { [`${BOWL}:2`]: 'food:green_beans' } })
    expect((await at(D[2]))!.recipeId).toBe('recipe:kr-bibimbap')
    await r.undo()
    expect(await at(D[1])).toBeUndefined()
    expect(await at(D[3])).toBeUndefined()
  })

  it('regenerate one meal: a different recipe, nothing else changes, undo restores', async () => {
    await setMealRecipe(repo, D[0], 'lunch', BOWL)
    await setMealRecipe(repo, D[0], 'dinner', 'recipe:kr-kimchi-stew')
    const r = await regenerateMeal(repo, D[0], 'lunch', D[0], '08:00')
    expect(r).not.toBeNull()
    expect((await at(D[0]))!.recipeId).not.toBe(BOWL)
    expect((await at(D[0], 'dinner'))!.recipeId).toBe('recipe:kr-kimchi-stew')
    await r!.undo()
    expect((await at(D[0]))!.recipeId).toBe(BOWL)
  })
})

describe('day summaries', () => {
  it('totals include breakfast and planned meals with swaps, using the shared calculation', async () => {
    await setMealRecipe(repo, D[0], 'lunch', BOWL)
    const [day] = await daySummaries(repo, [D[0]])
    const ctx = await loadMealContext(repo)
    const lunch = (await at(D[0]))!
    const expected = mealNutrition(ctx, lunch).n.energyKcal + mealNutrition(ctx, { recipeId: 'recipe:fixed-breakfast', portionScale: 1 }).n.energyKcal
    expect(day.totals.energyKcal).toBeCloseTo(expected, 6)
    expect(day.meals.find((m) => m.slot === 'lunch')!.toBuy).toBeGreaterThan(0) // broccoli etc. not in stock
    expect(day.meals.find((m) => m.slot === 'dinner')!.recipe).toBeUndefined()
  })
})

describe('bulk preparation', () => {
  it('four chicken lunches: one recipe group, chicken combined into one line, cook sessions within the fridge window', async () => {
    await setMealRecipe(repo, D[0], 'lunch', BOWL)
    await copyMeal(repo, (await at(D[0]))!, D)
    const ids = (await repo.db.planned_meals.where('date').anyOf(D).toArray()).map((m) => m.id)
    const b = await bulkPrep(repo, ids)
    expect(b.groups).toHaveLength(1)
    expect(b.groups[0].meals).toHaveLength(4)
    const chicken = b.needs.filter((n) => /chicken/i.test(n.label))
    expect(chicken).toHaveLength(1)
    expect(chicken[0].neededQty).toBeCloseTo(b.groups[0].portions * 150, 0)
    expect(chicken[0].haveQty).toBeGreaterThan(0) // the receipt's 1 kg
    // chicken keeps 3 days: Thu-Sat in one session, Sunday separately (or frozen from Thursday)
    expect(b.sessions.map((s) => [s.date, s.forDates.length, s.freeze])).toEqual([[D[0], 3, 1], [D[3], 1, 0]])
  })
})

describe('shopping list edits', () => {
  it('a changed amount and a removed item survive updating the list; packs from known pack sizes', async () => {
    await setMealRecipe(repo, D[0], 'lunch', BOWL)
    const { listId } = await generateList(repo, { from: D[0], to: D[0] })
    const items = await repo.db.shopping_list_items.where('listId').equals(listId).toArray()
    const broc = items.find((i) => /broccoli/i.test(i.label ?? ''))!
    const peas = items.find((i) => /pea/i.test(i.label ?? ''))!
    await setItemQuantity(repo, broc.id, 500)
    await removeItem(repo, peas.id)
    await generateList(repo, { from: D[0], to: D[0] }, listId)
    const after = await repo.db.shopping_list_items.where('listId').equals(listId).toArray()
    expect(after.find((i) => i.id === broc.id)).toMatchObject({ quantity: 500, quantityEdited: true })
    expect(after.some((i) => /pea/i.test(i.label ?? ''))).toBe(false)
    expect(packsFor(1200, 'g', { packSize: 600, packUnit: 'g' })).toEqual({ packs: 2, size: 600 })
    expect(packsFor(1200, 'g', { packSize: 1, packUnit: 'unit' })).toBeNull()
  })
})

describe('plan costs', () => {
  it('cost per week, day and meal; pantry contribution; extra spending against the weekly budget', async () => {
    for (const d of D) await setMealRecipe(repo, d, 'lunch', BOWL)
    await saveBudget(repo, 'week', 2000, 80)
    const c = await planCosts(repo, { from: D[0], to: D[3] })
    expect(c.days).toBe(4)
    expect(c.meals).toBe(8) // 4 breakfasts + 4 lunches
    expect(c.pantryCents).toBeGreaterThan(0)
    expect(c.budget).toMatchObject({ limitCents: 2000 })
    expect(c.budget!.status.spentCents).toBe(c.toBuyCents)
  })
})

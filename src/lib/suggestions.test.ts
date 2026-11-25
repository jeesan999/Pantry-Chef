import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { approveTargets, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { assignMeal } from './day'
import { eatMeal, ensureBreakfast, previewEat } from './eating'
import { loadLots, loadMealContext, mealAvailability, mealNutrition, setSubstitution, substituteOptions } from './meals'
import { addMissingToList, generateList, mealsInRange } from './shopping'
import { cookableNow, nextMealSlot, suggestForSlot } from './suggestions'

const TODAY = '2026-11-26'
const BOWL = 'recipe:au-chicken-rice-bowl' // chicken, rice, broccoli, peas, olive oil, lemon juice, garlic
let repo: Repo
let pantry: Pantry
let targets: { id: string; version: number }

beforeEach(async () => {
  const db = openDb(`sug-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-20')
  const { record } = await proposeTargets(repo, TODAY)
  const t = await approveTargets(repo, record.id)
  targets = { id: t.id, version: t.version! }
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  await saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines: await toCheckedLines(repo, p, await repo.db.foods.toArray()), imageHash: 'h' })
})
const plan = async (slot: 'lunch' | 'dinner', recipeId = BOWL, date = TODAY) => {
  await assignMeal(repo, { date, slot, time: slot === 'lunch' ? '14:00' : '18:00', recipeId, portionScale: 1, targetsId: targets.id, targetsVersion: targets.version })
  return (await repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first())!
}
const stockSnapshot = async () => JSON.stringify((await repo.db.inventory_lots.toArray()).map((l) => [l.id, l.remaining]))

describe('pantry check for a meal', () => {
  it('chicken and rice available, broccoli missing; reading changes nothing', async () => {
    const before = await stockSnapshot()
    const a = await mealAvailability(repo, { recipeId: BOWL, portionScale: 1, date: TODAY })
    const by = (re: RegExp) => a.lines.find((l) => re.test(l.label))!
    expect(by(/^Chicken/).status).toBe('available')
    expect(by(/rice/i).status).toBe('available')
    expect(by(/Broccoli/).status).toBe('missing')
    expect(a.allAvailable).toBe(false)
    expect(await stockSnapshot()).toBe(before)
  })

  it('a swap from the pantry changes availability, nutrition, the shopping list and what eating takes', async () => {
    const pm = await plan('lunch')
    const ctx = await loadMealContext(repo)
    const before = mealNutrition(ctx, pm).n
    const { lots } = await loadLots(repo)
    const broccoli = (await mealAvailability(repo, pm)).lines.find((l) => /Broccoli/.test(l.label))!
    // the Woolworths receipt has no greens, so no pantry substitute is offered; the swap is set directly to prove the plumbing
    expect(substituteOptions(broccoli.foodId, 100, lots, ctx.foods, TODAY)).toEqual([]) // nothing green in stock
    await setSubstitution(repo, pm.id, broccoli.ingredientId!, 'food:green_beans')
    const swapped = (await repo.get('planned_meals', pm.id))!
    const after = mealNutrition(await loadMealContext(repo), swapped).n
    expect(after.energyKcal).not.toBeCloseTo(before.energyKcal, 3)
    const a = await mealAvailability(repo, swapped)
    expect(a.lines.find((l) => l.foodId === 'food:green_beans')!.label).toMatch(/instead of broccoli/)
    const { listId } = await generateList(repo, { from: TODAY, to: TODAY })
    const items = await repo.db.shopping_list_items.where('listId').equals(listId).toArray()
    expect(items.some((i) => /green bean/i.test(i.label ?? ''))).toBe(true)
    expect(items.some((i) => /broccoli/i.test(i.label ?? ''))).toBe(false)
    const pre = await previewEat(repo, pm.id, 1)
    expect(pre.nutrition.energyKcal).toBeCloseTo(after.energyKcal, 3)
    await setSubstitution(repo, pm.id, broccoli.ingredientId!, null)
    expect((await repo.get('planned_meals', pm.id))!.substitutions).toEqual({})
  })

  it('add missing to the shopping list: what the recipe is short of, nothing it has', async () => {
    const a = await mealAvailability(repo, { recipeId: BOWL, portionScale: 1, date: TODAY })
    const short = a.lines.filter((l) => l.status !== 'available')
    const n = await addMissingToList(repo, TODAY, short)
    expect(n).toBe(short.length)
    const extras = (await repo.db.shopping_list_items.toArray()).filter((i) => i.source === 'extra')
    expect(extras.map((i) => i.label).join()).toMatch(/Broccoli/)
    expect(extras.some((i) => /Chicken/.test(i.label ?? ''))).toBe(false)
  })
})

describe('suggestions', () => {
  it('suggest lunch: ranked recipes tagged for lunch, each with its pantry check and what it adds', async () => {
    const s = await suggestForSlot(repo, { date: TODAY, slot: 'lunch', today: TODAY, now: '10:00' })
    expect(s.suggestions.length).toBe(3)
    for (const x of s.suggestions) {
      expect(x.recipe.slotTags.some((t) => t === 'lunch' || t === 'post-workout')).toBe(true)
      expect(x.nutrition.proteinG).toBeGreaterThan(20)
      expect(x.availability.lines.length).toBeGreaterThan(0)
    }
    expect(s.remaining.proteinG).toBeGreaterThan(0)
    expect(await repo.db.planned_meals.count()).toBe(0) // nothing planned by suggesting
  })

  it('what has been eaten lowers what is still needed', async () => {
    const before = await suggestForSlot(repo, { date: TODAY, slot: 'dinner', today: TODAY, now: '15:00' })
    const lunch = await plan('lunch')
    await eatMeal(repo, pantry, lunch.id, 1, TODAY)
    const b = await ensureBreakfast(repo, TODAY)
    await eatMeal(repo, pantry, b.id, 1, TODAY)
    const after = await suggestForSlot(repo, { date: TODAY, slot: 'dinner', today: TODAY, now: '15:00' })
    expect(after.remaining.proteinG).toBeLessThan(before.remaining.proteinG)
  })

  it('the next meal to suggest, and recipes cookable now', async () => {
    expect(await nextMealSlot(repo, TODAY, '09:00')).toEqual({ date: TODAY, slot: 'smoko' })
    expect(await nextMealSlot(repo, TODAY, '13:30')).toEqual({ date: TODAY, slot: 'lunch' })
    expect(await nextMealSlot(repo, TODAY, '22:00')).toEqual({ date: '2026-11-27', slot: 'smoko' })
    const all = await cookableNow(repo, TODAY)
    expect(all.size).toBeGreaterThan(60)
    expect(all.get(BOWL)!.allAvailable).toBe(false)
  })
})

describe('shopping fix', () => {
  it('a logged breakfast is not counted twice in the shopping list', async () => {
    const b = await ensureBreakfast(repo, TODAY)
    await eatMeal(repo, pantry, b.id, 1, TODAY)
    const meals = await mealsInRange(repo, { from: TODAY, to: TODAY })
    expect(meals.filter((m) => m.recipeId === 'recipe:fixed-breakfast')).toHaveLength(1)
  })
})

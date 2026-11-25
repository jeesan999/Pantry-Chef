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
import { addExtra, clearTicked, currentList, deleteList, generateList, nextWeekRange, setTicked, thisWeekRange, tickFromReceipt } from './shopping'

let repo: Repo
let pantry: Pantry
const BOWL = 'recipe:au-chicken-rice-bowl'
const R = { from: '2026-11-26', to: '2026-11-27' }

beforeEach(async () => {
  const db = openDb(`shop-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-25')
  const { record } = await proposeTargets(repo, '2026-11-25')
  const t = await approveTargets(repo, record.id)
  for (const date of ['2026-11-26', '2026-11-27']) {
    await assignMeal(repo, { date, slot: 'dinner', time: '18:00', recipeId: BOWL, portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
  }
})

async function scanWoolworths() {
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  return saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines, imageHash: 'h' })
}
const items = async (listId: string) => repo.db.shopping_list_items.where('listId').equals(listId).toArray()
const find = async (listId: string, re: RegExp) => (await items(listId)).find((i) => re.test(i.label ?? ''))

describe('ranges', () => {
  it('this week runs from today to Sunday; next week Monday to Sunday', () => {
    expect(thisWeekRange('2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-11-29' })
    expect(nextWeekRange('2026-11-26')).toEqual({ from: '2026-11-30', to: '2026-12-06' })
  })
})

describe('shopping list from the meal plan', () => {
  it('lists every ingredient for the planned meals and fixed breakfast, with products for new foods', async () => {
    const res = await generateList(repo, R)
    expect(res.plannedMeals).toBe(2)
    expect(res.meals).toBe(4) // + breakfast each day
    const chicken = await find(res.listId, /chicken/i)
    expect(chicken).toMatchObject({ quantity: 300, unit: 'g', source: 'plan', ticked: false, recipes: ['Lemon chicken, rice and greens bowl'] })
    expect(chicken!.estCostCents).toBeUndefined() // no price yet
    expect(await find(res.listId, /broccoli/i)).toMatchObject({ quantity: 200 })
    expect((await repo.db.products.get(chicken!.productId))!.foodId).toBe('food:chicken_breast')
    expect((await currentList(repo))!.id).toBe(res.listId)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('a scanned receipt ticks what it bought; rebuilding drops what the pantry now covers and prices the rest', async () => {
    const { listId } = await generateList(repo, R)
    const extra = await addExtra(repo, listId, { kind: 'text', name: 'Dish liquid' })
    const { receiptId } = await scanWoolworths()
    const ticked = await tickFromReceipt(repo, receiptId)
    expect(ticked).toBeGreaterThanOrEqual(2)
    expect((await find(listId, /chicken/i))!.ticked).toBe(true)
    expect((await find(listId, /rice/i))!.ticked).toBe(true)

    const again = await generateList(repo, R, listId)
    expect(again.listId).toBe(listId)
    expect(await find(listId, /chicken/i)).toBeUndefined() // 1 kg in the pantry covers 300 g
    expect(again.covered.some((c) => /chicken/i.test(c))).toBe(true)
    expect((await repo.db.shopping_lists.get(listId))!.coveredLabels).toEqual(again.covered)
    expect((await repo.db.shopping_list_items.get(extra.id))).toMatchObject({ label: 'Dish liquid', source: 'extra' }) // extras kept
    expect(await find(listId, /broccoli/i)).toBeTruthy()
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('rebuilding keeps ticks on lines still needed and updates amounts', async () => {
    const { listId } = await generateList(repo, R)
    const broc = (await find(listId, /broccoli/i))!
    await setTicked(repo, broc.id, true)
    await generateList(repo, { from: '2026-11-26', to: '2026-11-26' }, listId)
    expect(await find(listId, /broccoli/i)).toMatchObject({ id: broc.id, ticked: true, quantity: 100 })
  })

  it('extras: picked products, typed names (matched to an existing product), clear ticked, delete list', async () => {
    const { listId } = await generateList(repo, R)
    const a = await addExtra(repo, listId, { kind: 'text', name: 'Paper towel' }, 2)
    const b = await addExtra(repo, listId, { kind: 'text', name: 'paper towel' })
    expect(b.productId).toBe(a.productId)
    await expect(addExtra(repo, listId, { kind: 'text', name: '  ' })).rejects.toThrow(/Type/)
    await setTicked(repo, a.id, true)
    expect(await clearTicked(repo, listId)).toBe(1)
    await deleteList(repo, listId)
    expect(await repo.db.shopping_list_items.count()).toBe(0)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('refuses a backwards or too-long range', async () => {
    await expect(generateList(repo, { from: '2026-11-27', to: '2026-11-26' })).rejects.toThrow(/on or after/)
    await expect(generateList(repo, { from: '2026-11-01', to: '2026-12-31' })).rejects.toThrow(/31 days/)
  })
})

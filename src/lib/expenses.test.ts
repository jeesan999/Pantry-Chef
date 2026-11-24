import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { periodRange, spendByCategory, spendByPeriod, total } from '../engines/cost/engine'
import { addManualExpense, budgetStatuses, deleteManualExpense, getBudgets, loadCostContext, parseDollars, recipeServingCosts, saveBudget } from './expenses'

let repo: Repo
let pantry: Pantry
let shopDate: string
beforeEach(async () => {
  const db = openDb(`exp-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-25')
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  shopDate = p.date!
  await saveReceipt(repo, pantry, { store: p.store!, date: shopDate, totalCents: p.totalCents!, lines, imageHash: 'h' })
})

describe('expenses from a saved receipt', () => {
  it('the week holds the whole receipt, split into groceries and household', async () => {
    const r = periodRange('week', shopDate)
    const week = await repo.db.expenses.where('date').between(r.start, r.end, true, true).toArray()
    expect(total(week)).toBe(4988)
    expect(spendByPeriod(week, 'week', shopDate).reduce((s, b) => s + b.cents, 0)).toBe(4988)
    expect(spendByCategory(week).find((c) => c.name === 'Household')!.cents).toBe(650)
  })

  it('budgets: set, alert when over, change, remove', async () => {
    await saveBudget(repo, 'week', 4000, 80)
    let s = await budgetStatuses(repo, shopDate)
    expect(s).toHaveLength(1)
    expect(s[0].status.level).toBe('over')
    await saveBudget(repo, 'week', 6000, 80)
    expect((await budgetStatuses(repo, shopDate))[0].status.level).toBe('warn') // 83%
    await saveBudget(repo, 'month', 50000, 90)
    s = await budgetStatuses(repo, shopDate)
    expect(s.map((x) => [x.period, x.status.level])).toEqual([['week', 'warn'], ['month', 'ok']])
    await saveBudget(repo, 'week', null, 80)
    expect(Object.keys(await getBudgets(repo))).toEqual(['month'])
    await expect(saveBudget(repo, 'month', 5000, 120)).rejects.toThrow(/alertPct/)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('manual expenses add to spending and can be deleted; receipt expenses cannot', async () => {
    await addManualExpense(repo, { store: 'Cafe', date: shopDate, amountCents: 1250, category: 'Eating out' })
    await expect(addManualExpense(repo, { store: 'Cafe', date: shopDate, amountCents: 0, category: 'Other' })).rejects.toThrow(/above/)
    await expect(addManualExpense(repo, { store: ' ', date: shopDate, amountCents: 100, category: 'Other' })).rejects.toThrow(/where/)
    const all = await repo.db.expenses.toArray()
    expect(total(all)).toBe(4988 + 1250)
    const manual = all.find((e) => !e.receiptId)!
    await deleteManualExpense(repo, manual.id)
    await expect(deleteManualExpense(repo, all.find((e) => e.receiptId)!.id)).rejects.toThrow(/receipt/)
    expect(total(await repo.db.expenses.toArray())).toBe(4988)
  })

  it('prices carry the purchase unit; recipes using bought foods get a cost', async () => {
    const ctx = await loadCostContext(repo)
    const chicken = [...ctx.products.values()].find((p) => p.name.startsWith('Chicken Breast'))!
    expect(ctx.prices.byProduct.get(chicken.id)).toMatchObject({ cents: 1040, unit: 'g' })
    expect(ctx.prices.byFood.get('food:chicken_breast')!.cents).toBe(1040)
    const costs = await recipeServingCosts(repo, ctx)
    const recipes = await repo.db.recipe_ingredients.where('foodId').equals('food:chicken_breast').toArray()
    expect(recipes.length).toBeGreaterThan(0)
    const c = costs.get(recipes[0].recipeId)!
    expect(c.cents).toBeGreaterThan(0)
    expect(c.coveredPct).toBeGreaterThan(0)
  })
})

describe('parseDollars', () => {
  it('reads dollars to cents', () => {
    expect(parseDollars('12.5')).toBe(1250)
    expect(parseDollars('$1,200')).toBe(120000)
    expect(parseDollars('0.07')).toBe(7)
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('1.234')).toBeNull()
    expect(parseDollars('')).toBeNull()
  })
})

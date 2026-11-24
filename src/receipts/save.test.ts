import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { parseReceipt } from './parse'
import { aliasKey, findDuplicate, saveReceipt, toCheckedLines, type CheckedReceipt } from './save'

let repo: Repo
let pantry: Pantry
beforeEach(async () => {
  const db = openDb(`rcpt-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-25')
})

const parsed = (name: string) => parseReceipt(readFileSync(`src/receipts/fixtures/${name}.txt`, 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
async function checked(name: string, extra: Partial<CheckedReceipt> = {}): Promise<CheckedReceipt> {
  const p = parsed(name)
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  return { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines, imageHash: `hash-${name}`, ...extra }
}

describe('check-screen lines from a parsed receipt', () => {
  it('amounts: weighed in g, pack size in g/ml, counts as items; non-food unticked; foods matched by name', async () => {
    const c = await checked('woolworths')
    const by = (n: string) => c.lines.find((l) => l.name.startsWith(n))!
    expect([by('Bananas').quantity, by('Bananas').unit]).toEqual([854, 'g'])
    expect([by('WW Full Cream Milk').quantity, by('WW Full Cream Milk').unit]).toEqual([3000, 'ml'])
    expect([by('Avocado').quantity, by('Avocado').unit]).toEqual([2, 'unit'])
    expect(by('Fairy').include).toBe(false)
    expect(by('Chicken Breast').foodId).toBe('food:chicken_breast')
    expect(by('Chicken Breast').matchedBy).toBe('name')
    expect(by('Cobram').foodId).toBe('food:olive_oil')
    expect(by('Chicken Breast').storage).toBe('fridge')
    expect(by('Jasmine').storage).toBe('pantry')
  })
})

describe('saving a receipt', () => {
  it('writes everything in one go: 6 pantry lots, 1 household line, expenses = receipt total', async () => {
    const res = await saveReceipt(repo, pantry, await checked('woolworths'))
    expect(res.pantryLines).toBe(6)
    expect(res.newProducts).toBe(6)
    expect(res.householdCents).toBe(650) // dish liquid
    expect(res.groceriesCents).toBe(4988 - 650)
    const exp = await repo.db.expenses.toArray()
    expect(exp.reduce((s, e) => s + e.amountCents, 0)).toBe(4988)
    expect(await repo.db.receipt_items.count()).toBe(7)
    expect(await repo.db.grocery_purchases.count()).toBe(6)
    expect(await repo.db.price_history.count()).toBe(6)
    expect(await repo.db.inventory_lots.count()).toBe(6)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('pantry cost is the price after discount; price history per kg / litre / item', async () => {
    await saveReceipt(repo, pantry, await checked('woolworths'))
    const chicken = (await repo.db.products.toArray()).find((p) => p.name.startsWith('Chicken Breast'))!
    const lot = await repo.db.inventory_lots.where('productId').equals(chicken.id).first()
    expect(lot!.quantity).toBe(1000) // 1kg pack
    expect(lot!.unitCostCents).toBeCloseTo((1300 - 260) / 1000, 10) // $10.40 for 1000 g
    const ph = await repo.db.price_history.where('productId').equals(chicken.id).first()
    expect(ph!.centsPerKgOrUnit).toBeCloseTo(1040, 6) // $10.40/kg
    const avo = (await repo.db.products.toArray()).find((p) => p.name.startsWith('Avocado'))!
    expect((await repo.db.price_history.where('productId').equals(avo.id).first())!.centsPerKgOrUnit).toBe(250) // $2.50 each
  })

  it('remembers receipt lines: the next receipt from the same store maps them to the same products', async () => {
    const first = await checked('woolworths')
    // the user corrects the chicken line's name on the check screen
    first.lines.find((l) => l.name.startsWith('Chicken'))!.name = 'Chicken breast fillets'
    await saveReceipt(repo, pantry, first)
    const again = await checked('woolworths', { imageHash: 'another-photo', date: '2026-12-02' })
    const chicken = again.lines.find((l) => l.rawText.startsWith('Chicken'))!
    expect(chicken.matchedBy).toBe('remembered')
    expect(chicken.name).toBe('Chicken breast fillets')
    const res = await saveReceipt(repo, pantry, again)
    expect(res.newProducts).toBe(0)
    expect(await repo.db.products.count()).toBe(6)
    expect(await repo.db.product_aliases.count()).toBe(6)
  })

  it('blocks the same photo twice, always', async () => {
    const c = await checked('coles')
    await saveReceipt(repo, pantry, c)
    await expect(saveReceipt(repo, pantry, { ...(await checked('coles')), allowSameTotal: true })).rejects.toThrow(/photo has already been added/)
  })

  it('blocks a different photo of the same shop (store + date + total) unless confirmed', async () => {
    await saveReceipt(repo, pantry, await checked('aldi'))
    const second = await checked('aldi', { imageHash: 'second-photo' })
    expect(await findDuplicate(repo, second)).toMatchObject({ kind: 'same-shop' })
    await expect(saveReceipt(repo, pantry, second)).rejects.toThrow(/already saved/)
    expect(await repo.db.receipts.count()).toBe(1) // nothing half-written
    expect(await repo.db.inventory_lots.count()).toBe(5)
    await saveReceipt(repo, pantry, { ...second, allowSameTotal: true })
    expect(await repo.db.receipts.count()).toBe(2)
  })

  it('a bad line stops the whole save (nothing written)', async () => {
    const c = await checked('spudshed')
    c.lines[3].quantity = 0
    await expect(saveReceipt(repo, pantry, c)).rejects.toThrow(/enter how much/)
    expect(await repo.db.receipts.count()).toBe(0)
    expect(await repo.db.products.count()).toBe(0)
  })

  it('saved groceries show up as recipe suggestions (via their food links)', async () => {
    await saveReceipt(repo, pantry, await checked('woolworths'))
    const lots = await repo.db.inventory_lots.toArray()
    const products = await repo.db.products.toArray()
    const linked = products.filter((p) => p.foodId).map((p) => p.foodId)
    expect(linked).toEqual(expect.arrayContaining(['food:chicken_breast', 'food:rice_white', 'food:olive_oil', 'food:avocado', 'food:banana']))
    expect(lots.every((l) => l.remaining === l.quantity)).toBe(true)
  })

  it('alias key ignores markers, case and spacing', () => {
    expect(aliasKey('^WW  Full Cream   Milk 3L')).toBe('ww full cream milk 3l')
  })
})

/**
 * From a parsed receipt to checked lines (with remembered and suggested products), and from
 * checked lines to the database in ONE transaction: receipt, receipt lines, products, the
 * "this receipt line = this product" memory, purchases, pantry lots, price history and
 * expenses. Duplicates are refused.
 */
import { IntegrityError, newId, nowIso, type Repo } from '../db/repo'
import type { Pantry } from '../db/pantry'
import type { Food, InventoryLot, Product, QtyUnit } from '../db/types'
import { bestFoodMatch } from '../lib/foodMatch'
import { guessCategory, guessStorage } from '../lib/itemSearch'
import type { ParsedItem, ParsedReceipt } from './parse'

export interface CheckedLine {
  key: string
  include: boolean // false = not food: still counted in expenses, not added to the pantry
  rawText: string // the receipt's own words, used to remember this product next time
  name: string
  priceCents: number
  discountCents: number
  quantity: number
  unit: QtyUnit
  confidence: number
  notes: string[]
  productId?: string // an existing product (remembered or picked)
  foodId?: string // nutrition link for a new product
  matchedBy: 'remembered' | 'name' | 'picked' | 'none'
  category: string
  storage: InventoryLot['location']
  expiryDate?: string
  expiryKind?: 'use_by' | 'best_before'
}

export interface CheckedReceipt {
  store: string
  date: string
  totalCents: number
  imageHash?: string
  image?: Blob
  lines: CheckedLine[]
  allowSameTotal?: boolean // the user confirmed it really is a second, identical-looking shop
}

/** How the receipt line is remembered: lower case, no markers, single spaces. */
export const aliasKey = (raw: string) => raw.toLowerCase().replace(/^[#*^~+\s]+/, '').replace(/\s+/g, ' ').trim()

/** Amount bought: weight if weighed, else pack size x count, else a count. */
export function defaultAmount(it: ParsedItem): { quantity: number; unit: QtyUnit } {
  if (it.weightKg) return { quantity: Math.round(it.weightKg * 1000), unit: 'g' }
  if (it.pack) return { quantity: it.pack.amount * (it.quantity ?? 1), unit: it.pack.unit }
  return { quantity: it.quantity ?? 1, unit: 'unit' }
}

/** Build the check screen's lines: remembered product first, else a food matched by name. */
export async function toCheckedLines(repo: Repo, parsed: ParsedReceipt, foods: Food[]): Promise<CheckedLine[]> {
  const store = parsed.store ?? ''
  const products = new Map((await repo.db.products.toArray()).map((p) => [p.id, p]))
  const lines: CheckedLine[] = []
  for (const it of parsed.items) {
    const rawText = it.raw[0] ?? it.name
    const alias = store ? await repo.db.product_aliases.where('[store+receiptText]').equals([store, aliasKey(rawText)]).first() : undefined
    const remembered = alias ? products.get(alias.productId) : undefined
    const food = remembered ? undefined : bestFoodMatch(it.name, foods)?.food
    const category = remembered?.category ?? guessCategory(food?.name ?? it.name)
    const storage = remembered?.storage ?? guessStorage(category, food?.name ?? it.name)
    const amount = defaultAmount(it)
    lines.push({
      key: newId(),
      include: !it.nonFood,
      rawText,
      name: remembered?.name ?? it.name,
      priceCents: it.priceCents,
      discountCents: it.discountCents,
      ...amount,
      confidence: it.confidence,
      notes: it.notes,
      productId: remembered?.id,
      foodId: food?.id,
      matchedBy: remembered ? 'remembered' : food ? 'name' : 'none',
      category,
      storage,
    })
  }
  return lines
}

export type Duplicate = { kind: 'same-photo' | 'same-shop'; receiptId: string; store: string; date: string; totalCents: number }

export async function findDuplicate(repo: Repo, r: Pick<CheckedReceipt, 'imageHash' | 'store' | 'date' | 'totalCents'>): Promise<Duplicate | null> {
  if (r.imageHash) {
    const same = await repo.db.receipts.where('imageHash').equals(r.imageHash).first()
    if (same) return { kind: 'same-photo', receiptId: same.id, store: same.store, date: same.purchasedAt, totalCents: same.totalCents }
  }
  const sameDay = await repo.db.receipts.where('purchasedAt').equals(r.date).toArray()
  const s = sameDay.find((x) => x.store.toLowerCase() === r.store.toLowerCase() && x.totalCents === r.totalCents)
  return s ? { kind: 'same-shop', receiptId: s.id, store: s.store, date: s.purchasedAt, totalCents: s.totalCents } : null
}

export interface SaveResult {
  receiptId: string
  pantryLines: number
  newProducts: number
  groceriesCents: number
  householdCents: number
}

const net = (l: CheckedLine) => l.priceCents - l.discountCents

export async function saveReceipt(repo: Repo, pantry: Pantry, r: CheckedReceipt): Promise<SaveResult> {
  if (!r.store.trim()) throw new IntegrityError('Add the store name.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new IntegrityError('Add the date of the shop.')
  for (const l of r.lines) {
    if (l.include && !(l.quantity > 0)) throw new IntegrityError(`“${l.name}”: enter how much was bought.`)
    if (!l.name.trim()) throw new IntegrityError('Every line needs a name.')
  }
  return repo.tx(async () => {
    const dup = await findDuplicate(repo, r)
    if (dup?.kind === 'same-photo') throw new IntegrityError('This receipt photo has already been added.')
    if (dup?.kind === 'same-shop' && !r.allowSameTotal) {
      throw new IntegrityError(`A ${dup.store} receipt for $${(dup.totalCents / 100).toFixed(2)} on this date is already saved.`)
    }

    const receiptId = newId()
    await repo.insert('receipts', {
      id: receiptId,
      store: r.store.trim(),
      purchasedAt: r.date,
      totalCents: r.totalCents,
      discountCents: r.lines.reduce((s, l) => s + l.discountCents, 0),
      imageHash: r.imageHash,
      image: r.image,
      createdAt: nowIso(),
    })

    const madeHere = new Map<string, string>() // same new item twice on one receipt -> one product
    let pantryLines = 0
    let newProducts = 0
    let groceries = 0
    let household = 0
    for (const l of r.lines) {
      const itemId = newId()
      let productId: string | undefined
      if (l.include) {
        const pid = l.productId ?? madeHere.get(aliasKey(l.rawText))
        let product: Product | undefined = pid ? await repo.get('products', pid) : undefined
        if (!product) {
          product = { id: newId(), name: l.name.trim(), foodId: l.foodId, category: l.category, storage: l.storage, createdAt: nowIso() }
          await repo.insert('products', product)
          madeHere.set(aliasKey(l.rawText), product.id)
          newProducts++
        }
        productId = product.id
        // remember this receipt line for next time (and learn from corrections)
        const key = aliasKey(l.rawText)
        const alias = await repo.db.product_aliases.where('[store+receiptText]').equals([r.store.trim(), key]).first()
        if (!alias) await repo.insert('product_aliases', { id: newId(), productId, store: r.store.trim(), receiptText: key, createdAt: nowIso() })
        else if (alias.productId !== productId) await repo.update('product_aliases', alias.id, { productId })
      }
      await repo.insert('receipt_items', {
        id: itemId,
        receiptId,
        productId,
        rawText: l.rawText,
        parsedName: l.name,
        quantity: l.unit === 'unit' ? l.quantity : undefined,
        weightG: l.unit === 'g' ? l.quantity : undefined,
        priceCents: l.priceCents,
        discountCents: l.discountCents,
        confidence: l.confidence,
      })
      if (!l.include) {
        household += net(l)
        continue
      }
      const purchaseId = newId()
      await repo.insert('grocery_purchases', {
        id: purchaseId,
        receiptItemId: itemId,
        productId: productId!,
        store: r.store.trim(),
        date: r.date,
        quantity: l.quantity,
        unit: l.unit,
        priceCents: l.priceCents,
        discountCents: l.discountCents,
      })
      await pantry.addLot({
        productId: productId!,
        purchaseId,
        quantity: l.quantity,
        unit: l.unit,
        totalCostCents: Math.max(0, net(l)),
        purchaseDate: r.date,
        expiryDate: l.expiryDate,
        expiryKind: l.expiryDate ? l.expiryKind ?? 'use_by' : undefined,
        location: l.storage,
      })
      await repo.insert('price_history', {
        id: newId(),
        productId: productId!,
        purchaseId,
        date: r.date,
        store: r.store.trim(),
        // cents per kg, per litre, or per item
        centsPerKgOrUnit: l.unit === 'unit' ? net(l) / l.quantity : (net(l) / l.quantity) * 1000,
      })
      groceries += net(l)
      pantryLines++
    }

    // Expenses add up to the receipt total; any leftover (rounding, a whole-receipt discount) goes to groceries.
    const adjust = r.totalCents - groceries - household
    const groceriesCents = groceries + adjust
    if (groceriesCents !== 0) await repo.insert('expenses', { id: newId(), receiptId, store: r.store.trim(), date: r.date, amountCents: groceriesCents, category: 'Groceries' })
    if (household !== 0) await repo.insert('expenses', { id: newId(), receiptId, store: r.store.trim(), date: r.date, amountCents: household, category: 'Household' })
    return { receiptId, pantryLines, newProducts, groceriesCents, householdCents: household }
  })
}

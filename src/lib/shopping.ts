/** Database side of the shopping list: builds it from planned meals, keeps ticks and extras, ticks off what a receipt bought. */
import { IntegrityError, newId, nowIso, type Repo } from '../db/repo'
import { FIXED_BREAKFAST_ID } from '../db/seed'
import type { Product, QtyUnit, Recipe, RecipeIngredient, ShoppingList, ShoppingListItem } from '../db/types'
import { costOf } from '../engines/cost/engine'
import { addDays, mondayOf } from '../engines/nutrition/engine'
import { buildShoppingNeeds, type MealToShopFor, type ShoppingNeed } from '../engines/shopping/engine'
import { loadCostContext, type CostContext } from './expenses'
import { loadMealContext, mealIngredients, type MealContext } from './meals'
import { guessCategory, guessStorage } from './itemSearch'

export interface ListRange { from: string; to: string }

/** "This week": today to Sunday. "Next week": Monday to Sunday. */
export function thisWeekRange(today: string): ListRange {
  return { from: today, to: addDays(mondayOf(today), 6) }
}
export function nextWeekRange(today: string): ListRange {
  const mon = addDays(mondayOf(today), 7)
  return { from: mon, to: addDays(mon, 6) }
}

export function datesBetween(r: ListRange): string[] {
  const out: string[] = []
  for (let d = r.from; d <= r.to && out.length < 62; d = addDays(d, 1)) out.push(d)
  return out
}

/** Planned meals in the range, plus the fixed breakfast every day. */
export async function mealsInRange(repo: Repo, r: ListRange): Promise<Array<MealToShopFor & { substitutions?: Record<string, string>; mealId?: string }>> {
  const planned = await repo.db.planned_meals.where('date').between(r.from, r.to, true, true).toArray()
  const hasBreakfast = !!(await repo.db.recipes.get(FIXED_BREAKFAST_ID))
  // a day whose breakfast was logged already has a breakfast row: don't count it twice
  const breakfastRow = new Set(planned.filter((p) => p.slot === 'breakfast').map((p) => p.date))
  return [
    ...(hasBreakfast ? datesBetween(r).filter((date) => !breakfastRow.has(date)).map((date) => ({ date, recipeId: FIXED_BREAKFAST_ID, portionScale: 1 })) : []),
    ...planned.map((p) => ({ date: p.date, recipeId: p.recipeId, portionScale: p.portionScale, substitutions: p.substitutions, mealId: p.id })),
  ]
}

/** Meals with swaps become their own recipe (same name, swapped ingredients) so the list buys the substitute. */
export function withSubstitutions<M extends MealToShopFor & { substitutions?: Record<string, string> }>(
  meals: M[], recipes: Recipe[], ingredients: RecipeIngredient[], ctx: MealContext,
): { meals: MealToShopFor[]; recipes: Recipe[]; ingredients: RecipeIngredient[] } {
  const outRecipes = [...recipes]
  const outIngs = [...ingredients]
  const byId = new Map(recipes.map((x) => [x.id, x]))
  const outMeals = meals.map((m, i) => {
    if (!m.substitutions || !Object.keys(m.substitutions).length) return { date: m.date, recipeId: m.recipeId, portionScale: m.portionScale }
    const id = `${m.recipeId}~swap${i}`
    const base = byId.get(m.recipeId)
    if (!base) return { date: m.date, recipeId: m.recipeId, portionScale: m.portionScale }
    outRecipes.push({ ...base, id })
    for (const ing of mealIngredients(ctx, m)) outIngs.push({ ...ing, recipeId: id })
    return { date: m.date, recipeId: id, portionScale: m.portionScale }
  })
  return { meals: outMeals, recipes: outRecipes, ingredients: outIngs }
}

/** The list in use: the most recently updated one. */
export async function currentList(repo: Repo): Promise<ShoppingList | undefined> {
  const lists = await repo.db.shopping_lists.toArray()
  return lists.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0]
}

export interface GenerateResult { listId: string; toBuy: number; covered: string[]; meals: number; plannedMeals: number }

/**
 * Build (or update) the list for a range. Plan lines are recalculated; their ticks survive when the
 * same item is still needed. Extras are never touched. Foods never bought get a product so the list
 * can name them, as Pantry's manual add does.
 */
/**
 * Everything the meals in a range need, combined across recipes and days, minus pantry stock usable on
 * each meal's day, priced from your own prices. Shared by the shopping list, bulk prep and plan costs.
 */
export async function shoppingNeedsFor(repo: Repo, r: ListRange, mealIds?: string[], pre?: CostContext): Promise<{ needs: ShoppingNeed[]; meals: MealToShopFor[] }> {
  const ctx = pre ?? (await loadCostContext(repo))
  const [planMeals, allRecipes, allIngredients, yields, lots, mctx] = await Promise.all([
    mealsInRange(repo, r),
    repo.db.recipes.toArray(),
    repo.db.recipe_ingredients.toArray(),
    repo.db.cooking_yields.toArray(),
    repo.db.inventory_lots.toArray(),
    loadMealContext(repo),
  ])
  // bulk prep: only the chosen meals (breakfast included only when chosen)
  const chosen = mealIds ? new Set(mealIds) : null
  const inScope = chosen ? planMeals.filter((m) => m.mealId && chosen.has(m.mealId)) : planMeals
  const { meals, recipes, ingredients } = withSubstitutions(inScope, allRecipes, allIngredients, mctx)
  const needs = buildShoppingNeeds({
    meals,
    recipes: new Map(recipes.map((x) => [x.id, x])),
    ingredients,
    foods: ctx.foods,
    yields,
    products: [...ctx.products.values()],
    lots,
    prices: ctx.prices,
  })
  return { needs, meals }
}

export async function generateList(repo: Repo, r: ListRange, listId?: string, opts: { mealIds?: string[] } = {}): Promise<GenerateResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) throw new IntegrityError('Choose the first and last day.')
  if (r.from > r.to) throw new IntegrityError('The last day must be on or after the first day.')
  if (datesBetween(r).length > 31) throw new IntegrityError('Choose up to 31 days.')
  const pre = await loadCostContext(repo)
  return repo.tx(async () => {
    const { needs, meals } = await shoppingNeedsFor(repo, r, opts.mealIds, pre)

    const now = nowIso()
    const plan = await repo.db.meal_plans.where('weekStart').equals(mondayOf(r.from)).first()
    const mealPlanId = plan && r.to <= addDays(plan.weekStart, 6) ? plan.id : undefined
    const name = `Meals ${r.from} to ${r.to}`
    let list = listId ? await repo.get('shopping_lists', listId) : undefined
    if (list) list = await repo.update('shopping_lists', list.id, { from: r.from, to: r.to, name, mealPlanId, updatedAt: now })
    else {
      list = { id: newId(), name, from: r.from, to: r.to, mealPlanId, createdAt: now, updatedAt: now }
      await repo.insert('shopping_lists', list)
    }

    const existing = (await repo.db.shopping_list_items.where('listId').equals(list.id).toArray()).filter((i) => i.source !== 'extra')
    const byKey = new Map(existing.map((i) => [`${i.productId}|${i.unit}`, i]))
    const keep = new Set<string>()
    let toBuy = 0
    const removed = new Set(list.removedKeys ?? [])
    for (const n of needs) {
      if (n.buyQty <= 0) continue
      let productId = n.productId
      if (!productId) {
        const category = n.category
        const p: Product = { id: newId(), name: n.label, foodId: n.foodId, category, storage: guessStorage(category, n.label), createdAt: now }
        await repo.insert('products', p)
        productId = p.id
      }
      const fields = {
        quantity: n.buyQty,
        unit: n.unit,
        estCostCents: n.costCents ?? undefined,
        label: n.label,
        foodId: n.foodId,
        neededQty: n.neededQty,
        haveQty: n.haveQty,
        recipes: n.recipes,
        source: 'plan' as const,
      }
      if (removed.has(`${productId}|${n.unit}`)) continue
      const prev = byKey.get(`${productId}|${n.unit}`)
      if (prev?.quantityEdited) {
        // keep the amount you set; scale the estimate to it
        const est = n.costCents !== null && n.buyQty > 0 ? Math.round((n.costCents * prev.quantity) / n.buyQty) : undefined
        await repo.update('shopping_list_items', prev.id, { ...fields, quantity: prev.quantity, estCostCents: est })
        keep.add(prev.id)
      } else if (prev) {
        await repo.update('shopping_list_items', prev.id, fields)
        keep.add(prev.id)
      } else {
        await repo.insert('shopping_list_items', { id: newId(), listId: list.id, productId, ticked: false, ...fields })
      }
      toBuy++
    }
    for (const i of existing) if (!keep.has(i.id)) await repo.remove('shopping_list_items', i.id)
    const covered = needs.filter((n) => n.buyQty <= 0).map((n) => n.label)
    await repo.update('shopping_lists', list.id, { coveredLabels: covered })
    return { listId: list.id, toBuy, covered, meals: meals.length, plannedMeals: meals.filter((m) => m.recipeId !== FIXED_BREAKFAST_ID).length }
  })
}

export type ExtraChoice = { kind: 'product'; product: Product } | { kind: 'food'; foodId: string; label: string } | { kind: 'text'; name: string }

/** Add something not in the meal plan (dish liquid, snacks). Matched to a product when one is picked or already exists. */
export async function addExtra(repo: Repo, listId: string, choice: ExtraChoice, quantity = 1, unit: QtyUnit = 'unit'): Promise<ShoppingListItem> {
  if (!(quantity > 0)) throw new IntegrityError('Enter how many or how much.')
  const ctx = await loadCostContext(repo)
  return repo.tx(async () => {
    let product: Product | undefined
    if (choice.kind === 'product') product = choice.product
    else {
      const name = choice.kind === 'text' ? choice.name.trim() : choice.label
      if (!name) throw new IntegrityError('Type what you need.')
      const foodId = choice.kind === 'food' ? choice.foodId : undefined
      product = (await repo.db.products.toArray()).find((p) => (foodId && p.foodId === foodId) || p.name.toLowerCase() === name.toLowerCase())
      if (!product) {
        const category = guessCategory(name)
        product = { id: newId(), name, foodId, category, storage: guessStorage(category, name), createdAt: nowIso() }
        await repo.insert('products', product)
      }
    }
    const price = ctx.prices.byProduct.get(product.id) ?? (product.foodId ? ctx.prices.byFood.get(product.foodId) : undefined)
    const food = product.foodId ? ctx.foods.get(product.foodId) : undefined
    const cost = price ? costOf(quantity, unit, price, food) : null
    const item: ShoppingListItem = {
      id: newId(), listId, productId: product.id, quantity, unit, ticked: false, source: 'extra', label: product.name, foodId: product.foodId,
      estCostCents: cost === null ? undefined : Math.round(cost),
    }
    await repo.insert('shopping_list_items', item)
    await repo.update('shopping_lists', listId, { updatedAt: nowIso() })
    return item
  })
}

export async function setTicked(repo: Repo, itemId: string, ticked: boolean): Promise<void> {
  await repo.update('shopping_list_items', itemId, { ticked })
}

export async function clearTicked(repo: Repo, listId: string): Promise<number> {
  return repo.tx(async () => {
    const ticked = (await repo.db.shopping_list_items.where('listId').equals(listId).toArray()).filter((i) => i.ticked)
    for (const i of ticked) await repo.remove('shopping_list_items', i.id)
    return ticked.length
  })
}

/** Remove an item; a plan item is remembered as removed so updating the list doesn't add it back. */
export async function removeItem(repo: Repo, itemId: string): Promise<void> {
  await repo.tx(async () => {
    const it = await repo.get('shopping_list_items', itemId)
    if (!it) return
    if (it.source !== 'extra') {
      const list = await repo.get('shopping_lists', it.listId)
      if (list) await repo.update('shopping_lists', list.id, { removedKeys: [...new Set([...(list.removedKeys ?? []), `${it.productId}|${it.unit}`])] })
    }
    await repo.remove('shopping_list_items', itemId)
  })
}

/** Change how much to buy; the estimate follows and updating the list keeps your amount. */
export async function setItemQuantity(repo: Repo, itemId: string, quantity: number): Promise<void> {
  if (!(quantity > 0)) throw new IntegrityError('Enter an amount above zero.')
  const it = await repo.get('shopping_list_items', itemId)
  if (!it) return
  const est = it.estCostCents !== undefined && it.quantity > 0 ? Math.round((it.estCostCents * quantity) / it.quantity) : undefined
  await repo.update('shopping_list_items', itemId, { quantity, estCostCents: est, quantityEdited: true })
}

/** Bring back plan items you removed (on the next update). */
export async function restoreRemoved(repo: Repo, listId: string): Promise<void> {
  await repo.update('shopping_lists', listId, { removedKeys: [] })
}

/** Packs to buy when the product's pack size is known: "need 1.2 kg -> 2 x 600 g". */
export function packsFor(quantity: number, unit: QtyUnit, product?: Pick<Product, 'packSize' | 'packUnit'>): { packs: number; size: number } | null {
  if (!product?.packSize || !(product.packSize > 0) || (product.packUnit && product.packUnit !== unit)) return null
  return { packs: Math.max(1, Math.ceil(quantity / product.packSize - 1e-9)), size: product.packSize }
}
export const deleteList = (repo: Repo, listId: string) => repo.remove('shopping_lists', listId)

/** After a receipt is saved: tick the open items it bought (same product, or a product of the same food). Returns how many. */
export async function tickFromReceipt(repo: Repo, receiptId: string): Promise<number> {
  return repo.tx(async () => {
    const lines = await repo.db.receipt_items.where('receiptId').equals(receiptId).toArray()
    const productIds = new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))
    if (!productIds.size) return 0
    const products = await repo.db.products.bulkGet([...productIds])
    const foodIds = new Set(products.map((p) => p?.foodId).filter((x): x is string => !!x))
    const open = (await repo.db.shopping_list_items.toArray()).filter((i) => !i.ticked)
    let n = 0
    for (const i of open) {
      if (productIds.has(i.productId) || (i.foodId && foodIds.has(i.foodId))) {
        await repo.update('shopping_list_items', i.id, { ticked: true })
        n++
      }
    }
    return n
  })
}

/** Add what a recipe is short of to the current list (starting this week's list if there is none). Returns how many were added. */
export async function addMissingToList(repo: Repo, today: string, lines: Array<{ foodId?: string; productId?: string; label: string; short: { amount: number; unit: QtyUnit } }>): Promise<number> {
  const todo = lines.filter((l) => l.short.amount > 1e-6 && (l.foodId || l.productId))
  if (!todo.length) return 0
  let list = await currentList(repo)
  if (!list) list = await repo.get('shopping_lists', (await generateList(repo, thisWeekRange(today))).listId)
  const products = await repo.db.products.toArray()
  for (const l of todo) {
    const product = l.productId ? products.find((p) => p.id === l.productId) : undefined
    const choice: ExtraChoice = product ? { kind: 'product', product } : { kind: 'food', foodId: l.foodId!, label: l.label.replace(/\s*\(.*\)$/, '') }
    const qty = l.short.unit === 'unit' ? Math.ceil(l.short.amount) : Math.ceil(l.short.amount / 10) * 10
    await addExtra(repo, list!.id, choice, qty, l.short.unit)
  }
  return todo.length
}

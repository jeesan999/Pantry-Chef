/**
 * Engine D (Shopping): what to buy for a set of planned meals, minus what is in the pantry.
 * Pure: the caller loads the data. Amounts are g, ml or units; money is whole cents.
 */
import type { CookingYield, Food, InventoryLot, Product, QtyUnit, Recipe, RecipeIngredient } from '../../db/types'
import { costOf, type PriceIndex } from '../cost/engine'
import { ingredientGrams } from '../../lib/nutrition'
import { displayName, guessCategory } from '../../lib/itemSearch'

export interface MealToShopFor { date: string; recipeId: string; portionScale: number }

export interface ShoppingNeed {
  key: string // `${productId ?? foodId}|${unit}`
  productId?: string // set when a product is known (named by the recipe, or bought before for this food)
  foodId?: string
  label: string
  category: string
  unit: QtyUnit
  neededQty: number
  haveQty: number // usable pantry stock counted against the need
  buyQty: number // rounded up to a sensible amount; 0 when the pantry covers it
  costCents: number | null // estimate for buyQty at the latest price; null when there is no price
  recipes: string[]
}

export interface ShoppingInput {
  meals: MealToShopFor[]
  recipes: Map<string, Recipe>
  ingredients: RecipeIngredient[]
  foods: Map<string, Food>
  yields: CookingYield[]
  products: Product[]
  lots: InventoryLot[]
  prices: PriceIndex
}

/** Round an amount to buy up: whole items; grams/ml to 10 below 50, else to 50. */
export function roundUpToBuy(qty: number, unit: QtyUnit): number {
  if (qty <= 1e-9) return 0
  if (unit === 'unit') return Math.ceil(qty - 1e-9)
  const step = qty < 50 ? 10 : 50
  return Math.ceil(qty / step - 1e-9) * step
}

/** Convert an amount between units for one food; null when it can't be done. g↔ml assume density 1 unless recorded. */
export function convert(qty: number, from: QtyUnit, to: QtyUnit, food?: Pick<Food, 'gramsPerUnit' | 'densityGPerMl'>): number | null {
  if (from === to) return qty
  const d = food?.densityGPerMl ?? 1
  const toG = from === 'g' ? qty : from === 'ml' ? qty * d : food?.gramsPerUnit ? qty * food.gramsPerUnit : null
  if (toG === null) return null
  if (to === 'g') return toG
  if (to === 'ml') return toG / d
  return food?.gramsPerUnit ? toG / food.gramsPerUnit : null
}

interface Use { date: string; qty: number; unit: QtyUnit; recipe: string }

/** A lot counts for a meal on `date` unless it is past its use-by by then. Best-before food still counts. */
const usableOn = (lot: InventoryLot, date: string) => !lot.expiryDate || lot.expiryKind === 'best_before' || lot.expiryDate >= date

export function buildShoppingNeeds(inp: ShoppingInput): ShoppingNeed[] {
  const byRecipe = new Map<string, RecipeIngredient[]>()
  for (const i of inp.ingredients) byRecipe.set(i.recipeId, [...(byRecipe.get(i.recipeId) ?? []), i])
  const productById = new Map(inp.products.map((p) => [p.id, p]))

  // 1. every use of every ingredient, scaled to the portion eaten; cooked weights back to raw
  const uses = new Map<string, { productId?: string; foodId?: string; label: string; uses: Use[] }>()
  for (const m of inp.meals) {
    const recipe = inp.recipes.get(m.recipeId)
    if (!recipe) continue
    const factor = m.portionScale / Math.max(recipe.servings, 1)
    for (const ing of byRecipe.get(recipe.id) ?? []) {
      if (ing.optional) continue
      const food = ing.foodId ? inp.foods.get(ing.foodId) : undefined
      let qty = ing.quantity * factor
      let unit = ing.unit
      if (ing.weighed === 'cooked' && food?.state === 'raw') {
        try {
          qty = ingredientGrams(ing, food, inp.yields) * factor
          unit = 'g'
        } catch {
          // no yield recorded: buy the stated amount
        }
      }
      const id = ing.productId ?? ing.foodId!
      const entry = uses.get(id) ?? { productId: ing.productId, foodId: ing.foodId ?? productById.get(ing.productId ?? '')?.foodId, label: ing.label, uses: [] }
      entry.uses.push({ date: m.date, qty, unit, recipe: recipe.name })
      uses.set(id, entry)
    }
  }

  // products bought before, per food: the one with the latest price wins, else the first
  const productForFood = new Map<string, Product>()
  for (const p of inp.products) {
    if (!p.foodId) continue
    const cur = productForFood.get(p.foodId)
    const priced = (x?: Product) => (x ? inp.prices.byProduct.get(x.id)?.date ?? '' : '')
    if (!cur || priced(p) > priced(cur)) productForFood.set(p.foodId, p)
  }

  const out: ShoppingNeed[] = []
  for (const e of uses.values()) {
    const food = e.foodId ? inp.foods.get(e.foodId) : undefined
    // 2. one unit per line: the shared unit, else grams when every use converts, else one line per unit
    const units = [...new Set(e.uses.map((u) => u.unit))]
    let groups: Array<{ unit: QtyUnit; uses: Use[] }>
    if (units.length === 1) groups = [{ unit: units[0], uses: e.uses }]
    else {
      const asG = e.uses.map((u) => ({ ...u, qty: convert(u.qty, u.unit, 'g', food), unit: 'g' as QtyUnit }))
      groups = asG.every((u) => u.qty !== null)
        ? [{ unit: 'g', uses: asG as Use[] }]
        : units.map((unit) => ({ unit, uses: e.uses.filter((u) => u.unit === unit) }))
    }

    const product = e.productId ? productById.get(e.productId) : e.foodId ? productForFood.get(e.foodId) : undefined
    // 3. pantry stock for this product, or any product of this food
    const lots = inp.lots
      .filter((l) => l.remaining > 1e-9 && (l.productId === e.productId || (!!e.foodId && productById.get(l.productId)?.foodId === e.foodId)))
      .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))

    for (const g of groups) {
      // remaining stock per lot in this line's unit (null: can't be compared)
      const left = new Map(lots.map((l) => [l.id, convert(l.remaining, l.unit, g.unit, food)]))
      let needed = 0
      let have = 0
      for (const u of [...g.uses].sort((a, b) => a.date.localeCompare(b.date))) {
        needed += u.qty
        let want = u.qty
        for (const l of lots) {
          if (want <= 1e-9) break
          const avail = left.get(l.id)
          if (!avail || !usableOn(l, u.date)) continue // soonest-dated stock is used first
          const take = Math.min(avail, want)
          left.set(l.id, avail - take)
          want -= take
          have += take
        }
      }
      const buyQty = roundUpToBuy(needed - have, g.unit)
      const price = (product && inp.prices.byProduct.get(product.id)) || (e.foodId && inp.prices.byFood.get(e.foodId)) || undefined
      const cost = buyQty > 0 && price ? costOf(buyQty, g.unit, price, food) : buyQty > 0 ? null : 0
      const label = product?.name ?? (food ? displayName(food.name) : e.label)
      // the readable name guesses better ("Eggs", not "Egg, chicken, whole")
      const guessed = guessCategory(label)
      out.push({
        key: `${product?.id ?? e.productId ?? e.foodId}|${g.unit}`,
        productId: product?.id,
        foodId: e.foodId,
        label,
        category: product?.category ?? (guessed !== 'Other' ? guessed : guessCategory(food?.name ?? e.label)),
        unit: g.unit,
        neededQty: needed,
        haveQty: have,
        buyQty,
        costCents: cost === null ? null : Math.round(cost),
        recipes: [...new Set(g.uses.map((u) => u.recipe))],
      })
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
}

/** "600 g", "1.5 L", "3", "2 kg" — the way an amount reads on a list. */
export function formatQty(qty: number, unit: QtyUnit): string {
  if (unit === 'unit') return `${+qty.toFixed(1)}`
  const big = unit === 'g' ? 'kg' : 'L'
  if (qty >= 1000) return `${+(qty / 1000).toFixed(2)} ${big}`
  return `${Math.round(qty)} ${unit}`
}

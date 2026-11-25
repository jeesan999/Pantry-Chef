/**
 * Logging what was eaten: planned meals (all or part, or skipped) and quick foods. Each log takes
 * food out of the pantry (the uneaten part of a cooked meal is recorded as leftover waste), freezes
 * nutrition and cost, keeps the day's nutritional record, and can be undone.
 */
import type { Pantry } from '../db/pantry'
import { IntegrityError, newId, nowIso, type Repo } from '../db/repo'
import { FIXED_BREAKFAST_ID } from '../db/seed'
import type { Food, MealConsumption, Nutrients, PlannedMeal, Product, QtyUnit } from '../db/types'
import type { SlotName } from '../engines/contract'
import { costOf } from '../engines/cost/engine'
import { dayIntake, planEating, quickGrams, quickNutrition, type EatPlan, type LotInfo, type Need } from '../engines/eating/engine'
import { addDays } from '../engines/nutrition/engine'
import { approvedTargets } from '../engines/nutrition/service'
import { formatQty } from '../engines/shopping/engine'
import { searchItems } from './itemSearch'
import { assignMeal, targetsForDate } from './day'
import { loadLots, loadMealContext, mealNeeds, mealNutrition } from './meals'
import { loadCostContext } from './expenses'
import { emptyNutrients, scaleNutrients } from './nutrition'
import { dayChoice } from './schedule'

export const MAX_DAYS_BACK = 7
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function checkDate(date: string, today: string) {
  if (date > today) throw new IntegrityError('You can only log meals for today or earlier.')
  if (date < addDays(today, -MAX_DAYS_BACK)) throw new IntegrityError(`You can log up to ${MAX_DAYS_BACK} days back.`)
}

async function lotInfos(repo: Repo): Promise<LotInfo[]> {
  const [lots, products, foods] = await Promise.all([repo.db.inventory_lots.toArray(), repo.db.products.toArray(), repo.db.foods.toArray()])
  const pf = new Map(products.map((p) => [p.id, p.foodId]))
  const fm = new Map(foods.map((f) => [f.id, f]))
  return lots
    .filter((l) => l.remaining > 1e-9)
    .map((l) => {
      const f = pf.get(l.productId) ? fm.get(pf.get(l.productId)!) : undefined
      return { id: l.id, productId: l.productId, foodId: f?.id, unit: l.unit, remaining: l.remaining, unitCostCents: l.unitCostCents, expiryDate: l.expiryDate, expiryKind: l.expiryKind, gramsPerUnit: f?.gramsPerUnit, densityGPerMl: f?.densityGPerMl }
    })
}

/** The live (not undone) log for a planned meal, if any. */
export async function eatenFor(repo: Repo, plannedMealId: string): Promise<MealConsumption | undefined> {
  return repo.db.meal_consumption.where('plannedMealId').equals(plannedMealId).filter((c) => !c.undone).first()
}

/** Today's fixed breakfast has no planned row until it is logged; this makes one. */
export async function ensureBreakfast(repo: Repo, date: string): Promise<PlannedMeal> {
  const existing = await repo.db.planned_meals.where('[date+slot]').equals([date, 'breakfast']).first()
  if (existing) return existing
  const t = await approvedTargets(repo)
  if (!t?.version) throw new IntegrityError('Approve your targets first.')
  const day = targetsForDate(t.targetSet, await dayChoice(repo, date))
  await assignMeal(repo, { date, slot: 'breakfast', time: day.slots.breakfast.time, recipeId: FIXED_BREAKFAST_ID, portionScale: 1, targetsId: t.id, targetsVersion: t.version })
  return (await repo.db.planned_meals.where('[date+slot]').equals([date, 'breakfast']).first())!
}

export interface EatPreview {
  plan: EatPlan
  nutrition: Nutrients
  costCents: number // what was eaten: pantry cost plus your latest price for anything not in the pantry
  lines: Array<{ label: string; taken: string; missing: string | null }>
  wasteCents: number
}

async function prepare(repo: Repo, pm: PlannedMeal, fraction: number): Promise<EatPreview> {
  const [recipe, mctx, { lots, productFood }, ctx] = await Promise.all([repo.get('recipes', pm.recipeId), loadMealContext(repo), loadLots(repo), loadCostContext(repo)])
  if (!recipe) throw new IntegrityError('That recipe no longer exists.')
  const fm = mctx.foods
  const needs: Need[] = mealNeeds(mctx, pm, productFood) // swaps applied
  const plan = planEating(needs, lots, fraction, pm.date)
  const lotUnit = new Map(lots.map((l) => [l.id, l.unit]))
  // shortfall of the eaten share, priced from your latest prices where known
  let shortCents = 0
  plan.lines.forEach((l, idx) => {
    if (!l.missing || fraction <= 0) return
    const n = needs[idx]
    const price = (n.productId && ctx.prices.byProduct.get(n.productId)) || (n.foodId && ctx.prices.byFood.get(n.foodId)) || undefined
    const c = price ? costOf(l.missing.amount * fraction, l.missing.unit, price, n.foodId ? fm.get(n.foodId) : undefined) : null
    if (c) shortCents += c
  })
  const nutrition = scaleNutrients(mealNutrition(mctx, pm).n, fraction)
  return {
    plan,
    nutrition,
    costCents: Math.round(plan.eatenCostCents + shortCents),
    wasteCents: plan.wasteCostCents,
    lines: plan.lines.map((l) => {
      const takenBy = new Map<QtyUnit, number>()
      for (const t of [...l.consume, ...l.discard]) takenBy.set(lotUnit.get(t.lotId)!, (takenBy.get(lotUnit.get(t.lotId)!) ?? 0) + t.qty)
      return {
        label: l.label,
        taken: [...takenBy].map(([u, q]) => formatQty(q, u)).join(' + '),
        missing: l.missing ? formatQty(l.missing.amount, l.missing.unit) : null,
      }
    }),
  }
}

/** What marking a meal eaten would do, without doing it. */
export async function previewEat(repo: Repo, plannedMealId: string, fraction: number): Promise<EatPreview> {
  const pm = await repo.get('planned_meals', plannedMealId)
  if (!pm) throw new IntegrityError('That meal is no longer planned.')
  return prepare(repo, pm, fraction)
}

/** The same, for a meal not saved yet (today's fixed breakfast before it is logged). */
export const previewMeal = (repo: Repo, meal: Pick<PlannedMeal, 'date' | 'recipeId' | 'portionScale'>, fraction: number) =>
  prepare(repo, { id: '', mealPlanId: '', slot: 'breakfast', time: '', ...meal }, fraction)

/** Mark a planned meal eaten (fraction 0..1; 0 = skipped, nothing leaves the pantry). */
export async function eatMeal(repo: Repo, pantry: Pantry, plannedMealId: string, fraction: number, today: string): Promise<MealConsumption> {
  if (!(fraction >= 0 && fraction <= 1)) throw new IntegrityError('Choose how much you ate.')
  const pm = await repo.get('planned_meals', plannedMealId)
  if (!pm) throw new IntegrityError('That meal is no longer planned.')
  checkDate(pm.date, today)
  const pre = fraction > 0 ? await prepare(repo, pm, fraction) : null
  const c: MealConsumption = {
    id: newId(),
    plannedMealId,
    date: pm.date,
    time: pm.date === today ? hhmm() : pm.time,
    slot: pm.slot,
    fractionEaten: fraction,
    nutrition: pre?.nutrition ?? emptyNutrients(),
    costCents: pre?.costCents ?? 0,
    at: nowIso(),
    undone: false,
  }
  await repo.tx(async () => {
    if (await eatenFor(repo, plannedMealId)) throw new IntegrityError('This meal is already logged. Undo it first.')
    await repo.insert('meal_consumption', c)
    for (const line of pre?.plan.lines ?? []) {
      for (const t of line.consume) await pantry.consume(t.lotId, t.qty, c.id)
      for (const t of line.discard) await pantry.discard(t.lotId, t.qty, 'leftover', c.id)
    }
    await syncDay(repo, pm.date)
  })
  return c
}

export const skipMeal = (repo: Repo, pantry: Pantry, plannedMealId: string, today: string) => eatMeal(repo, pantry, plannedMealId, 0, today)

export type QuickChoice = { kind: 'product'; product: Product } | { kind: 'food'; food: Food; label: string }
export interface QuickInput { choice: QuickChoice; quantity: number; unit: QtyUnit; date: string; slot?: SlotName | 'snack'; fromPantry: boolean; grams?: number }

/** The food that best matches a product name: tries runs of its plain words, longest first ("WW Full Cream Milk 3L" -> milk). */
export function closestFood(name: string, foods: Food[]): Food | undefined {
  const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3)
  for (let len = words.length; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const hit = searchItems(words.slice(i, i + len).join(' '), [], foods, 1)[0]
      if (hit?.kind === 'food') return hit.food
    }
  }
  return undefined
}

/** Quick food: grams, nutrition, and what would leave the pantry. */
export async function previewQuick(repo: Repo, q: QuickInput): Promise<{ grams: number; nutrition: Nutrients; costCents: number; taken: string | null; missing: string | null; plan: EatPlan | null }> {
  if (!(q.quantity > 0)) throw new IntegrityError('Enter how much.')
  const product = q.choice.kind === 'product' ? q.choice.product : undefined
  let food = q.choice.kind === 'food' ? q.choice.food : product?.foodId ? await repo.get('foods', product.foodId) : undefined
  // a product bought without a food link (and no label values): use the closest food for its nutrition
  if (product && !food && !product.labelNutrients) food = closestFood(product.name, await repo.db.foods.toArray())
  const foodId = food?.id
  const grams = q.grams ?? quickGrams(q.quantity, q.unit, food)
  if (grams === null) throw new IntegrityError('How much does one weigh? Enter the amount in grams instead.')
  const per100 = product?.labelNutrients ?? food?.per100g
  if (!per100) throw new IntegrityError('There’s no nutrition for this item yet. Pick it from the food list instead.')
  const nutrition = quickNutrition(per100, grams)
  const ctx = await loadCostContext(repo)
  let plan: EatPlan | null = null
  let costCents = 0
  let taken: string | null = null
  let missing: string | null = null
  const need: Need = { label: product?.name ?? (q.choice.kind === 'food' ? q.choice.label : ''), foodId, productId: product?.id, grams: q.unit === 'unit' && !food?.gramsPerUnit ? null : grams, qty: q.quantity, unit: q.unit }
  if (q.fromPantry) {
    plan = planEating([need], await lotInfos(repo), 1, q.date)
    const l = plan.lines[0]
    costCents = plan.eatenCostCents
    const lots = new Map((await repo.db.inventory_lots.toArray()).map((x) => [x.id, x.unit]))
    if (l.consume.length) taken = l.consume.map((t) => formatQty(t.qty, lots.get(t.lotId)!)).join(' + ')
    if (l.missing) missing = formatQty(l.missing.amount, l.missing.unit)
  }
  if (!q.fromPantry || missing) {
    const price = (product && ctx.prices.byProduct.get(product.id)) || (foodId && ctx.prices.byFood.get(foodId)) || undefined
    const share = q.fromPantry && plan ? 1 - plan.lines[0].coveredFrac : 1
    const c = price ? costOf(grams * share, 'g', price, food) : null
    if (c) costCents += c
  }
  return { grams, nutrition, costCents: Math.round(costCents), taken, missing, plan }
}

export async function eatQuick(repo: Repo, pantry: Pantry, q: QuickInput, today: string): Promise<MealConsumption> {
  checkDate(q.date, today)
  const pre = await previewQuick(repo, q)
  const label = q.choice.kind === 'product' ? q.choice.product.name : q.choice.label
  const c: MealConsumption = {
    id: newId(),
    quick: { foodId: q.choice.kind === 'food' ? q.choice.food.id : q.choice.product.foodId, productId: q.choice.kind === 'product' ? q.choice.product.id : undefined, label, quantity: q.quantity, unit: q.unit, grams: pre.grams },
    date: q.date,
    time: q.date === today ? hhmm() : '12:00',
    slot: q.slot ?? 'snack',
    fractionEaten: 1,
    nutrition: pre.nutrition,
    costCents: pre.costCents,
    at: nowIso(),
    undone: false,
  }
  await repo.tx(async () => {
    await repo.insert('meal_consumption', c)
    for (const t of pre.plan?.lines[0].consume ?? []) await pantry.consume(t.lotId, t.qty, c.id)
    await syncDay(repo, q.date)
  })
  return c
}

/** Undo a log: the pantry gets back what it gave (and the leftover waste is cancelled). */
export async function undoEaten(repo: Repo, pantry: Pantry, consumptionId: string): Promise<void> {
  await repo.tx(async () => {
    const c = await repo.get('meal_consumption', consumptionId)
    if (!c || c.undone) return
    await repo.update('meal_consumption', c.id, { undone: true })
    const txns = await repo.db.inventory_transactions.where('consumptionId').equals(c.id).toArray()
    for (const t of txns) {
      if (t.type === 'undo') continue
      const already = await repo.db.inventory_transactions.where('reversesId').equals(t.id).count()
      if (!already) await pantry.undo(t.id)
    }
    await syncDay(repo, c.date)
  })
}

export interface DayLogView { date: string; totals: Nutrients; complete: boolean; logged: Map<string, MealConsumption>; quick: MealConsumption[] }

/** A day's log: totals eaten, completeness, and the log per planned meal. */
export async function loadDay(repo: Repo, date: string): Promise<DayLogView> {
  const [planned, eaten] = await Promise.all([repo.db.planned_meals.where('date').equals(date).toArray(), repo.db.meal_consumption.where('date').equals(date).toArray()])
  const live = eaten.filter((e) => !e.undone)
  const slots: Array<{ slot: string; plannedMealId?: string }> = planned.map((p) => ({ slot: p.slot, plannedMealId: p.id }))
  if (!planned.some((p) => p.slot === 'breakfast')) slots.push({ slot: 'breakfast' })
  const d = dayIntake({ slots, eaten })
  return {
    date,
    totals: d.totals,
    complete: d.complete,
    logged: new Map(live.filter((e) => e.plannedMealId).map((e) => [e.plannedMealId!, e])),
    quick: live.filter((e) => e.quick).sort((a, b) => a.time.localeCompare(b.time)),
  }
}

/** Keep the day's nutritional record in step with its log (removed when nothing is logged). */
export async function syncDay(repo: Repo, date: string): Promise<void> {
  const day = await loadDay(repo, date)
  const existing = await repo.db.nutritional_records.where('date').equals(date).first()
  const anything = day.logged.size + day.quick.length > 0
  if (!anything) {
    if (existing) await repo.remove('nutritional_records', existing.id)
    return
  }
  const t = await approvedTargets(repo)
  if (!t) return
  const choice = await dayChoice(repo, date)
  const workout = choice.dayType === 'training' ? await repo.db.workouts.where('date').equals(date).first() : undefined
  const rec = { date, targetsId: t.id, workoutId: workout?.id, dayType: choice.dayType, totals: day.totals }
  if (existing) await repo.update('nutritional_records', existing.id, rec)
  else await repo.insert('nutritional_records', { id: newId(), ...rec })
}

/** Complete logged days in a range, with what was eaten: used to calibrate maintenance from real intake. */
export async function loggedDays(repo: Repo, from: string, to: string): Promise<Array<{ date: string; kcal: number }>> {
  const recs = await repo.db.nutritional_records.where('date').between(from, to, true, true).toArray()
  const out: Array<{ date: string; kcal: number }> = []
  for (const r of recs) {
    const d = await loadDay(repo, r.date)
    if (d.complete) out.push({ date: r.date, kcal: d.totals.energyKcal })
  }
  return out
}

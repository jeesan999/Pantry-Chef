/**
 * Engine B (Meal planning): fills open smoko, lunch and dinner slots for a run of days.
 * Pure and deterministic: the caller loads the data; the same input (and seed) gives the same plan.
 * Greedy pass day by day with simulated pantry stock, then passes that swap single meals while
 * the whole plan's score improves (slot fit, day totals, pantry use, variety, ratings, a little cost).
 */
import type { Nutrients, RatingFlag, SlotTag } from '../../db/types'
import { addNutrients, emptyNutrients, portionForProtein, scaleNutrients } from '../../lib/nutrition'
import type { DayTargets, SlotName } from '../contract'
import { addDays } from '../nutrition/engine'

export type PlanSlot = Exclude<SlotName, 'breakfast'>
export const PLAN_SLOTS: PlanSlot[] = ['smoko', 'lunch', 'dinner']

export interface PlannerIngredient { foodId: string; grams: number } // raw grams per serving
export interface PlannerRecipe {
  id: string
  name: string
  cuisine: string
  slotTags: SlotTag[]
  perServing: Nutrients
  ingredients: PlannerIngredient[] // non-optional lines with a food and a known weight
  costPerServing: number | null // cents, from your own prices; null when not fully priced
  totalMin?: number // preparation + cooking time
}
export interface StockLot { foodId: string; grams: number; expiryDate?: string; expiryKind?: 'use_by' | 'best_before' }
export interface Rating { stars?: number; flags: RatingFlag[] }
export interface Meal { date: string; slot: PlanSlot; recipeId: string; portionScale: number }

export interface PlanInput {
  dates: string[]
  days: Record<string, DayTargets>
  recipes: PlannerRecipe[]
  breakfast: { perDay: Nutrients; ingredients: PlannerIngredient[] } | null
  stock: StockLot[]
  ratings: Map<string, Rating>
  locked: Meal[] // kept as they are
  fill: Array<{ date: string; slot: PlanSlot }> // slots the planner chooses for
  recent?: Array<{ date: string; recipeId: string }> // meals just before the range, for variety
  foodNames?: Map<string, string>
  seed?: number
  exclude?: Record<string, string[]> // `${date}|${slot}` -> recipes you swapped away from there
  extra?: Record<string, Nutrients> // per day: eaten beyond the plan (quick foods, part portions), added to day totals
}

export interface PlannedMealChoice extends Meal { reasons: string[]; alternatives: string[] }
export interface DayCheck {
  date: string
  totals: Nutrients
  target: { energyKcal: number; proteinG: number; carbsG: number; fatG: number }
  issues: string[]
}
export interface PlanResult {
  meals: PlannedMealChoice[]
  days: DayCheck[]
  week: { costCents: number; unpricedMeals: number; usesSoon: string[]; unusedSoon: string[] }
  unfilled: Array<{ date: string; slot: PlanSlot }>
}

// ---------- weights (tuned so slot and day fit lead; cost only breaks near-ties) ----------
const W = {
  slotFit: 3,
  tag: 0.5,
  pantry: 1,
  soon: 0.8,
  soonCap: 1.6,
  repeat: 1,
  sameCuisine: 0.3,
  recent: 0.6,
  centsPenalty: 0.0004, // $5 a serving costs 0.2: cost nudges, never decides
  favourite: 0.6,
  cookAgain: 0.4,
  star: 0.2,
  flagged: 0.3,
  tooRepetitive: 0.5,
  day: 1,
  jitter: 0.15,
  allInPantry: 0.5, // everything in stock: no shopping needed
  slowPerMin: 0.004, // beyond 30 minutes of preparation and cooking
}
const SOON_DAYS = 2
const SLOT_ORDER: Record<PlanSlot, number> = { smoko: 0, lunch: 1, dinner: 2 }
const key = (m: { date: string; slot: PlanSlot }) => `${m.date}|${m.slot}`
const mid = ([a, b]: [number, number]) => (a + b) / 2

/** Distance outside a range, relative to its size (0 inside). */
function outside(v: number, [lo, hi]: [number, number]): number {
  const scale = Math.max(10, (lo + hi) / 2)
  return v < lo ? (lo - v) / scale : v > hi ? (v - hi) / scale : 0
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

interface StockState { lots: Array<StockLot & { left: number }> }

const usable = (l: StockLot, date: string) => !l.expiryDate || l.expiryKind === 'best_before' || l.expiryDate >= date
const isSoon = (l: StockLot, date: string) => !!l.expiryDate && l.expiryDate >= date && l.expiryDate <= addDays(date, SOON_DAYS)

/** Take grams of a food from usable lots, soonest-dated first. Returns grams covered and whether dated-soon stock was used. */
function take(stock: StockState, foodId: string, grams: number, date: string, dryRun: boolean): { covered: number; soon: boolean } {
  let want = grams
  let covered = 0
  let soon = false
  for (const l of stock.lots) {
    if (want <= 1e-9) break
    if (l.foodId !== foodId || l.left <= 1e-9 || !usable(l, date)) continue
    const t = Math.min(l.left, want)
    if (!dryRun) l.left -= t
    want -= t
    covered += t
    if (isSoon(l, date)) soon = true
  }
  return { covered, soon }
}

interface Ctx {
  inp: PlanInput
  byId: Map<string, PlannerRecipe>
  bySlot: Map<PlanSlot, PlannerRecipe[]>
}

const SLOT_TAGS: Record<PlanSlot, SlotTag[]> = { smoko: ['smoko', 'pre-workout'], lunch: ['lunch', 'post-workout'], dinner: ['dinner', 'low-carb-dinner'] }

function makeCtx(inp: PlanInput): Ctx {
  const ok = inp.recipes.filter((r) => !inp.ratings.get(r.id)?.flags.includes('do_not_recommend'))
  const bySlot = new Map<PlanSlot, PlannerRecipe[]>(PLAN_SLOTS.map((s) => [s, ok.filter((r) => r.slotTags.some((t) => SLOT_TAGS[s].includes(t))).sort((a, b) => a.id.localeCompare(b.id))]))
  return { inp, byId: new Map(inp.recipes.map((r) => [r.id, r])), bySlot }
}

export function portionFor(r: PlannerRecipe, day: DayTargets, slot: PlanSlot): number {
  return portionForProtein(r.perServing.proteinG, mid(day.slots[slot].proteinG))
}

/** Everything about one meal that doesn't depend on the rest of the plan. */
function standalone(ctx: Ctx, r: PlannerRecipe, date: string, slot: PlanSlot, scale: number): { score: number; reasons: string[] } {
  const day = ctx.inp.days[date]
  const st = day.slots[slot]
  const n = scaleNutrients(r.perServing, scale)
  const reasons: string[] = []
  let score = -W.slotFit * (outside(n.carbsG, st.carbsG) + outside(n.fatG, st.fatG) + outside(n.proteinG, st.proteinG))
  const tags = new Set(r.slotTags)
  if (day.dayType === 'training' && slot === 'lunch' && tags.has('post-workout')) {
    score += W.tag
    reasons.push('post-workout')
  }
  if (slot === 'smoko' && st.digestibility === 'high' && tags.has('pre-workout')) {
    score += W.tag
    reasons.push('easy before training')
  }
  if (slot === 'dinner' && (st.carbLevel === 'low' || st.carbLevel === 'lowest') && tags.has('low-carb-dinner')) {
    score += W.tag
    reasons.push('low-carb dinner')
  }
  const rating = ctx.inp.ratings.get(r.id)
  if (rating) {
    if (rating.flags.includes('favourite')) {
      score += W.favourite
      reasons.push('a favourite')
    }
    if (rating.flags.includes('cook_again')) score += W.cookAgain
    if (rating.stars) score += (rating.stars - 3) * W.star
    if (rating.flags.includes('too_expensive')) score -= W.flagged
    if (rating.flags.includes('too_slow')) score -= W.flagged
    if (rating.flags.includes('too_repetitive')) score -= W.tooRepetitive
  }
  if (r.costPerServing !== null) score -= r.costPerServing * scale * W.centsPenalty
  if (r.totalMin !== undefined) {
    if (r.totalMin > 30) score -= (r.totalMin - 30) * W.slowPerMin
    else if (r.totalMin <= 20) reasons.push(`ready in ${r.totalMin} min`)
  }
  if (ctx.inp.seed) score += hash(`${ctx.inp.seed}|${date}|${slot}|${r.id}`) * W.jitter
  return { score, reasons }
}

interface Evaluated { total: number; perMeal: Map<string, { score: number; reasons: string[] }>; days: DayCheck[]; usesSoon: Set<string>; stock: StockState }

/** Score a whole plan from scratch, in time order, simulating pantry stock. -Infinity if a hard rule breaks. */
function evaluate(ctx: Ctx, meals: Meal[]): Evaluated {
  const { inp } = ctx
  const stock: StockState = { lots: inp.stock.map((l) => ({ ...l, left: l.grams })).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999')) }
  const ordered = [...meals].sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
  const fillKeys = new Set(inp.fill.map(key))
  const perMeal = new Map<string, { score: number; reasons: string[] }>()
  const usesSoon = new Set<string>()
  let total = 0

  // hard variety rules: at most 2 a week, never on consecutive days (only judged for meals the planner chose)
  const datesOf = new Map<string, string[]>()
  for (const m of ordered) datesOf.set(m.recipeId, [...(datesOf.get(m.recipeId) ?? []), m.date])
  for (const m of ordered) {
    if (!fillKeys.has(key(m))) continue
    const ds = datesOf.get(m.recipeId)!
    if (ds.length > 2) return { total: -Infinity, perMeal, days: [], usesSoon, stock }
    if (ds.some((d) => d !== m.date && (d === addDays(m.date, 1) || d === addDays(m.date, -1)))) return { total: -Infinity, perMeal, days: [], usesSoon, stock }
  }

  const dayTotals = new Map<string, Nutrients>()
  let prev: { date: string; cuisine: string } | null = null
  for (const date of inp.dates) {
    let tot = inp.extra?.[date] ? addNutrients(emptyNutrients(), inp.extra[date]) : emptyNutrients()
    if (inp.breakfast) {
      tot = addNutrients(tot, inp.breakfast.perDay)
      for (const i of inp.breakfast.ingredients) take(stock, i.foodId, i.grams, date, false)
    }
    for (const m of ordered.filter((x) => x.date === date)) {
      const r = ctx.byId.get(m.recipeId)
      if (!r) continue
      tot = addNutrients(tot, r.perServing, m.portionScale)
      // pantry: how much of the meal (by weight) the stock covers, and whether it uses food dated soon
      let need = 0
      let covered = 0
      const soonFoods: string[] = []
      for (const ing of r.ingredients) {
        const g = ing.grams * m.portionScale
        const t = take(stock, ing.foodId, g, date, false)
        need += g
        covered += t.covered
        if (t.soon) soonFoods.push(ing.foodId)
      }
      if (!fillKeys.has(key(m))) {
        prev = { date, cuisine: r.cuisine }
        continue
      }
      const s = standalone(ctx, r, date, m.slot, m.portionScale)
      let score = s.score
      const reasons = [...s.reasons]
      const cover = need > 0 ? covered / need : 0
      score += W.pantry * cover
      if (need > 0 && cover >= 0.999) {
        score += W.allInPantry
        reasons.push('everything in your pantry')
      } else if (cover >= 0.5) reasons.push(`${Math.round(cover * 100)}% from your pantry`)
      if (soonFoods.length) {
        score += Math.min(W.soonCap, W.soon * soonFoods.length)
        const names = soonFoods.map((f) => inp.foodNames?.get(f) ?? 'food').slice(0, 2)
        reasons.unshift(`uses ${names.join(' and ')} dated soon`)
        soonFoods.forEach((f) => usesSoon.add(f))
      }
      const n = datesOf.get(m.recipeId)!.length
      if (n > 1) score -= W.repeat * (ctx.inp.ratings.get(m.recipeId)?.flags.includes('too_repetitive') ? 2 : 1)
      if (prev && prev.cuisine === r.cuisine && prev.date >= addDays(date, -1)) score -= W.sameCuisine
      if (inp.recent?.some((x) => x.recipeId === m.recipeId && x.date >= addDays(date, -3))) score -= W.recent
      perMeal.set(key(m), { score, reasons })
      total += score
      prev = { date, cuisine: r.cuisine }
    }
    dayTotals.set(date, tot)
  }

  const days: DayCheck[] = inp.dates.map((date) => {
    const d = inp.days[date]
    const t = dayTotals.get(date)!
    const issues: string[] = []
    let pen = Math.abs(t.energyKcal - d.energyKcal) / d.energyKcal * 10 + Math.abs(t.carbsG - d.carbsG) / Math.max(d.carbsG, 50) * 4 + Math.abs(t.fatG - d.fatG) / Math.max(d.fatG, 40) * 4
    if (t.proteinG < d.proteinG.min) {
      pen += ((d.proteinG.min - t.proteinG) / d.proteinG.min) * 10
      issues.push(`protein ${Math.round(t.proteinG)} g, under ${d.proteinG.min} g`)
    }
    if (t.fibreG < d.fibreMinG) {
      pen += ((d.fibreMinG - t.fibreG) / d.fibreMinG) * 12 // weighted so the planner reaches the minimum when the recipes allow
      if (t.fibreG < d.fibreMinG - 0.5) issues.push(`fibre ${Math.round(t.fibreG)} g, under ${d.fibreMinG} g`)
    }
    if (d.satFatMaxG !== null && t.satFatG > d.satFatMaxG) {
      pen += ((t.satFatG - d.satFatMaxG) / d.satFatMaxG) * 2
      issues.push(`saturated fat ${Math.round(t.satFatG)} g, over ${d.satFatMaxG} g`)
    }
    if (t.addedSugarG > d.addedSugarMaxG) {
      pen += ((t.addedSugarG - d.addedSugarMaxG) / Math.max(d.addedSugarMaxG, 10)) * 2
      issues.push(`added sugar ${Math.round(t.addedSugarG)} g, over ${d.addedSugarMaxG} g`)
    }
    const dev = (t.energyKcal - d.energyKcal) / d.energyKcal
    if (Math.abs(dev) > 0.1) issues.push(`energy ${Math.round(t.energyKcal)} kcal, ${dev > 0 ? 'over' : 'under'} ${d.energyKcal}`)
    // days with slots left empty on purpose are judged only on hard limits, not on totals
    const hasEmpty = PLAN_SLOTS.some((s) => !ordered.some((m) => m.date === date && m.slot === s))
    total -= W.day * (hasEmpty ? 0 : pen)
    return { date, totals: t, target: { energyKcal: d.energyKcal, proteinG: d.proteinG.preferred, carbsG: d.carbsG, fatG: d.fatG }, issues: hasEmpty ? [] : issues }
  })
  return { total, perMeal, days, usesSoon, stock }
}

function candidates(ctx: Ctx, f: { date: string; slot: PlanSlot }): PlannerRecipe[] {
  const no = ctx.inp.exclude?.[key(f)]
  const all = ctx.bySlot.get(f.slot) ?? []
  return no?.length ? all.filter((r) => !no.includes(r.id)) : all
}

export function planWeek(inp: PlanInput): PlanResult {
  const ctx = makeCtx(inp)
  const fill = [...inp.fill].sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
  const chosen = new Map<string, Meal>()
  const all = () => [...inp.locked, ...chosen.values()]

  // 1. greedy, in time order: the best meal given everything chosen so far
  for (const f of fill) {
    let best: { meal: Meal; total: number } | null = null
    for (const r of candidates(ctx, f)) {
      const meal = { ...f, recipeId: r.id, portionScale: portionFor(r, inp.days[f.date], f.slot) }
      chosen.set(key(f), meal)
      const total = evaluate(ctx, all()).total
      if (total > -Infinity && (!best || total > best.total)) best = { meal, total }
    }
    if (best) chosen.set(key(f), best.meal)
    else chosen.delete(key(f))
  }

  // 2. improve: swap single meals while the whole plan scores better
  let current = evaluate(ctx, all()).total
  for (let pass = 0; pass < 3; pass++) {
    let improved = false
    for (const f of fill) {
      const was = chosen.get(key(f))
      for (const r of candidates(ctx, f)) {
        if (was && r.id === was.recipeId) continue
        const meal = { ...f, recipeId: r.id, portionScale: portionFor(r, inp.days[f.date], f.slot) }
        const keep = chosen.get(key(f))
        chosen.set(key(f), meal)
        const total = evaluate(ctx, all()).total
        if (total > current + 1e-9) {
          current = total
          improved = true
        } else if (keep) chosen.set(key(f), keep)
        else chosen.delete(key(f))
      }
    }
    if (!improved) break
  }

  // 3. report
  const final = evaluate(ctx, all())
  const meals: PlannedMealChoice[] = fill
    .filter((f) => chosen.has(key(f)))
    .map((f) => {
      const m = chosen.get(key(f))!
      // alternatives: the next best swaps for this slot, given the rest of the plan
      const alts = candidates(ctx, f)
        .filter((r) => r.id !== m.recipeId)
        .map((r) => {
          chosen.set(key(f), { ...f, recipeId: r.id, portionScale: portionFor(r, inp.days[f.date], f.slot) })
          return { id: r.id, total: evaluate(ctx, all()).total }
        })
        .filter((x) => x.total > -Infinity)
        .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
        .slice(0, 5)
        .map((x) => x.id)
      chosen.set(key(f), m)
      return { ...m, reasons: final.perMeal.get(key(f))?.reasons ?? [], alternatives: alts }
    })

  let costCents = 0
  let unpricedMeals = 0
  for (const m of all()) {
    const r = ctx.byId.get(m.recipeId)
    if (r?.costPerServing == null) unpricedMeals++
    else costCents += r.costPerServing * m.portionScale
  }
  const lastDate = inp.dates[inp.dates.length - 1]
  const unusedSoon = [...new Set(final.stock.lots.filter((l) => l.left > 20 && l.expiryDate && l.expiryDate >= inp.dates[0] && l.expiryDate <= lastDate && l.expiryKind !== 'best_before').map((l) => l.foodId))]
  return {
    meals,
    days: final.days,
    week: {
      costCents: Math.round(costCents),
      unpricedMeals,
      usesSoon: [...final.usesSoon].map((f) => inp.foodNames?.get(f) ?? f),
      unusedSoon: unusedSoon.map((f) => inp.foodNames?.get(f) ?? f),
    },
    unfilled: fill.filter((f) => !chosen.has(key(f))),
  }
}

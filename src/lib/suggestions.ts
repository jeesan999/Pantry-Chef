/**
 * "What should I eat next?" Ranked suggestions for one meal, from the planner's own scoring (so a
 * suggestion and a plan never disagree), with each recipe's pantry check, what it contributes to
 * what's still needed today, its cost and its time. Reads only; nothing is planned until you choose.
 */
import type { Repo } from '../db/repo'
import type { Nutrients, Recipe } from '../db/types'
import type { SlotName } from '../engines/contract'
import { checkAvailability, type AvailabilitySummary } from '../engines/availability/engine'
import { portionFor, type PlanSlot } from '../engines/planner/engine'
import { SLOT_TAGS } from './day'
import { loadCostContext, recipeServingCosts } from './expenses'
import { loadLots, loadMealContext, mealNeeds } from './meals'
import { addNutrients, emptyNutrients, scaleNutrients } from './nutrition'
import { buildDraft, slotKey } from './planner'
import { loadRecipeNutrition } from './rank'

export interface Suggestion {
  recipe: Recipe
  portionScale: number
  nutrition: Nutrients // at that portion
  availability: AvailabilitySummary
  costCents: number | null // per portion, when every ingredient has a price
  totalMin: number
  reasons: string[]
  current: boolean // already planned for this meal
}
export interface SlotSuggestions {
  date: string
  slot: PlanSlot
  remaining: { energyKcal: number; proteinG: number; carbsG: number; fatG: number } // still needed before this meal
  suggestions: Suggestion[]
}

const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** The next meal worth suggesting: the first of today's smoko/lunch/dinner not yet logged and not past, else tomorrow's smoko. */
export async function nextMealSlot(repo: Repo, today: string, now = hhmm()): Promise<{ date: string; slot: PlanSlot }> {
  const [planned, logs] = await Promise.all([repo.db.planned_meals.where('date').equals(today).toArray(), repo.db.meal_consumption.where('date').equals(today).toArray()])
  const logged = new Set(logs.filter((c) => !c.undone).map((c) => c.plannedMealId))
  const profile = await repo.get('profile', 'profile:me')
  for (const s of ['smoko', 'lunch', 'dinner'] as PlanSlot[]) {
    const p = planned.find((x) => x.slot === s)
    if (p && logged.has(p.id)) continue
    const time = p?.time ?? profile?.mealTimes[s] ?? '23:59'
    // a meal stays suggestible until an hour after its time
    const [h, m] = time.split(':').map(Number)
    const until = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    if (now <= until) return { date: today, slot: s }
  }
  const t = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return { date: t, slot: 'smoko' }
}

export async function suggestForSlot(repo: Repo, args: { date: string; slot: PlanSlot; today: string; now?: string; limit?: number }): Promise<SlotSuggestions> {
  const { date, slot, today } = args
  const planned = await repo.db.planned_meals.where('date').equals(date).toArray()
  const current = planned.find((p) => p.slot === slot)
  const others = planned.filter((p) => p.slot !== 'breakfast' && p.slot !== slot)
  const draft = await buildDraft(
    repo,
    {
      from: date,
      to: date,
      mode: 'unlocked',
      seed: 0,
      locks: others.map((p) => ({ date, slot: p.slot as PlanSlot, recipeId: p.recipeId, portionScale: p.portionScale })),
      // only this meal is open: every other empty meal stays empty
      skips: (['smoko', 'lunch', 'dinner'] as PlanSlot[]).filter((s) => s !== slot && !others.some((p) => p.slot === s)).map((s) => slotKey({ date, slot: s })),
    },
    today,
    date === today ? args.now : undefined,
  )
  const [recipes, nutrition, mctx, { lots, productFood }, costCtx] = await Promise.all([repo.db.recipes.toArray(), loadRecipeNutrition(repo), loadMealContext(repo), loadLots(repo), loadCostContext(repo)])
  const costs = await recipeServingCosts(repo, costCtx)
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const day = draft.days[date]
  const chosen = draft.result.meals.find((m) => m.slot === slot)
  const ids = chosen ? [chosen.recipeId, ...chosen.alternatives] : []
  // keep what's already planned in the list, marked
  if (current && !ids.includes(current.recipeId)) ids.push(current.recipeId)

  const tags = new Set(SLOT_TAGS[slot as SlotName])
  const suggestions: Suggestion[] = ids
    .map((id) => byId.get(id))
    .filter((r): r is Recipe => !!r && r.slotTags.some((t) => tags.has(t)))
    .slice(0, (args.limit ?? 3) + (current ? 1 : 0))
    .map((recipe) => {
      const portionScale = current?.recipeId === recipe.id ? current.portionScale : chosen?.recipeId === recipe.id ? chosen.portionScale : portionFor({ ...plannerShape(recipe), perServing: nutrition.get(recipe.id)!.perServing }, day, slot)
      const availability = checkAvailability(mealNeeds(mctx, { recipeId: recipe.id, portionScale }, productFood), lots, date)
      const c = costs.get(recipe.id)
      const reasons = chosen?.recipeId === recipe.id ? chosen.reasons : []
      return {
        recipe,
        portionScale,
        nutrition: scaleNutrients(nutrition.get(recipe.id)?.perServing ?? emptyNutrients(), portionScale),
        availability,
        costCents: c && c.coveredPct === 100 ? Math.round(c.cents * portionScale) : null,
        totalMin: recipe.prepMin + recipe.cookMin,
        reasons: reasons.length ? reasons : availability.allAvailable ? ['everything in your pantry'] : availability.lines.some((l) => l.datedSoon) ? ['uses food dated soon'] : [],
        current: current?.recipeId === recipe.id,
      }
    })

  // still needed before this meal = target - (the day's totals without the suggested meal)
  const totals = draft.result.days[0]?.totals ?? emptyNutrients()
  const without = chosen ? addNutrients(totals, scaleNutrients(nutrition.get(chosen.recipeId)?.perServing ?? emptyNutrients(), chosen.portionScale), -1) : totals
  return {
    date,
    slot,
    remaining: {
      energyKcal: Math.max(0, day.energyKcal - without.energyKcal),
      proteinG: Math.max(0, day.proteinG.preferred - without.proteinG),
      carbsG: Math.max(0, day.carbsG - without.carbsG),
      fatG: Math.max(0, day.fatG - without.fatG),
    },
    suggestions,
  }
}

const plannerShape = (r: Recipe) => ({ id: r.id, name: r.name, cuisine: r.cuisine, slotTags: r.slotTags, ingredients: [], costPerServing: null })

/** Recipes you can cook right now from the pantry (one serving), best coverage first. */
export async function cookableNow(repo: Repo, date: string): Promise<Map<string, AvailabilitySummary>> {
  const [recipes, mctx, { lots, productFood }] = await Promise.all([repo.db.recipes.toArray(), loadMealContext(repo), loadLots(repo)])
  return new Map(recipes.map((r) => [r.id, checkAvailability(mealNeeds(mctx, { recipeId: r.id, portionScale: 1 }, productFood), lots, date)]))
}

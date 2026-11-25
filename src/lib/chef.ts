/**
 * Chef actions: turn an interpreted intent into an answer, a choice, or a proposal to confirm.
 * Nothing changes until a proposal is applied (or an option picked); every change returns an undo.
 */
import Fuse from 'fuse.js'
import type { Pantry } from '../db/pantry'
import { newId, type Repo } from '../db/repo'
import { FIXED_BREAKFAST_ID, PROFILE_ID } from '../db/seed'
import type { InventoryLot, PlannedMeal, Product, QtyUnit, Recipe, Workout } from '../db/types'
import { CONTRACT_VERSION, SLOTS, type DayTargets, type SlotName } from '../engines/contract'
import { periodRange, total } from '../engines/cost/engine'
import { addDays } from '../engines/nutrition/engine'
import { approvedTargets } from '../engines/nutrition/service'
import { formatQty } from '../engines/shopping/engine'
import { EXAMPLES, interpret, type Intent } from '../engines/chef/intents'
import { SLOT_LABEL, SLOT_TAGS, assignMeal, clearMeal, targetsForDate } from './day'
import { budgetStatuses } from './expenses'
import { searchItems } from './itemSearch'
import { addNutrients, emptyNutrients } from './nutrition'
import { loadPantrySuggestions, loadRecipeNutrition, rankForSlot } from './rank'
import { clearDayChoice, dayChoice, setDayType } from './schedule'
import { addExtra, currentList, generateList, nextWeekRange, removeItem, thisWeekRange, type ExtraChoice } from './shopping'

export interface Link { to: string; label: string }
export interface Done { text: string; undo?: () => Promise<string>; link?: Link }
export interface Option { label: string; detail?: string; run: () => Promise<Reply> }
export type Reply =
  | { kind: 'answer'; text: string; lines?: string[]; options?: Option[]; link?: Link }
  | { kind: 'proposal'; text: string; changes: string[]; apply: () => Promise<Done> }
  | { kind: 'done'; text: string; undo?: () => Promise<string>; link?: Link }
  | { kind: 'unknown'; text: string; examples: string[] }

export interface ChefDeps { repo: Repo; pantry: Pantry; today: string; now?: string } // now: HH:MM, to skip meals already past

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  if (date === addDays(today, -1)) return 'yesterday'
  const d = new Date(`${date}T00:00:00Z`)
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const mealLabel = (date: string, slot: SlotName, today: string) => (date === today && slot === 'dinner' ? 'tonight’s dinner' : `${dayLabel(date, today)}’s ${SLOT_LABEL[slot].toLowerCase()}`)
const answer = (text: string, more: Omit<Extract<Reply, { kind: 'answer' }>, 'kind' | 'text'> = {}): Reply => ({ kind: 'answer', text, ...more })
const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Entry point: text in, reply out. */
export async function ask(deps: ChefDeps, text: string): Promise<Reply> {
  const r = interpret(text, deps.today)
  if (r.kind === 'unknown') return { kind: 'unknown', text: 'Sorry, I didn’t understand that. Did you mean one of these?', examples: r.closest }
  return act(deps, r.intent)
}

export async function act(deps: ChefDeps, intent: Intent): Promise<Reply> {
  switch (intent.type) {
    case 'help': return answer('Here’s what I can do. Tap one to try it, or type your own.', { lines: EXAMPLES })
    case 'swap': return swap(deps, intent.date, intent.slot, intent.withFood)
    case 'set': return setMeal(deps, intent.date, intent.slot, intent.recipe)
    case 'clear': return clear(deps, intent.date, intent.slot)
    case 'dayType': return dayType(deps, intent.date, intent.dayType, intent.start)
    case 'usual': return usual(deps, intent.date)
    case 'useUp': return expiringSoon(deps)
    case 'cook': return cook(deps, intent.foods)
    case 'shopAdd': return shopAdd(deps, intent.item, intent.qty, intent.unit)
    case 'shopBuild': return shopBuild(deps, intent.week)
    case 'discard': return discard(deps, intent)
    case 'stock': return stock(deps, intent.item, intent.location)
    case 'weigh': return weigh(deps, intent.kg, intent.timeOfDay)
    case 'meals': return meals(deps, intent.date, intent.slot)
    case 'nutritionLeft': return nutritionLeft(deps, intent.date)
    case 'spent': return spent(deps, intent.period)
    case 'budget': return budget(deps)
  }
}

// ---------- shared ----------

async function targetsOn(deps: ChefDeps, date: string): Promise<{ id: string; version: number; day: DayTargets } | null> {
  const t = await approvedTargets(deps.repo)
  if (!t || t.targetSet.contractVersion !== CONTRACT_VERSION) return null
  return { id: t.id, version: t.version!, day: targetsForDate(t.targetSet, await dayChoice(deps.repo, date)) }
}
const noTargets = (): Reply => answer('Your targets need approving before I can plan meals.', { link: { to: '/goals', label: 'Review targets' } })

const plannedAt = (repo: Repo, date: string, slot: SlotName) => repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first()

/** Put a recipe in a slot, returning an undo that restores what was there. */
async function placeMeal(deps: ChefDeps, date: string, slot: SlotName, recipe: Recipe, scale: number): Promise<Done> {
  const t = await targetsOn(deps, date)
  if (!t) throw new Error('Your targets need approving first.')
  const prev: PlannedMeal | undefined = await plannedAt(deps.repo, date, slot)
  await assignMeal(deps.repo, { date, slot, time: t.day.slots[slot].time, recipeId: recipe.id, portionScale: scale, targetsId: t.id, targetsVersion: t.version })
  return {
    text: `${recipe.name} is on ${mealLabel(date, slot, deps.today)}${scale !== 1 ? ` (${scale}× serving)` : ''}.`,
    link: { to: date === deps.today ? '/' : '/plan', label: date === deps.today ? 'See Today' : 'See the plan' },
    undo: async () => {
      if (prev) {
        await assignMeal(deps.repo, { date, slot, time: prev.time, recipeId: prev.recipeId, portionScale: prev.portionScale, targetsId: t.id, targetsVersion: t.version })
        return `Put back ${(await deps.repo.get('recipes', prev.recipeId))?.name ?? 'the previous meal'}.`
      }
      await clearMeal(deps.repo, date, slot)
      return `Cleared ${mealLabel(date, slot, deps.today)} again.`
    },
  }
}

const pickSlot = (intentType: 'swap' | 'clear', date: string, today: string, run: (s: SlotName) => Promise<Reply>): Reply =>
  answer(`Which meal ${dayLabel(date, today)}?`, {
    options: (['smoko', 'lunch', 'dinner'] as SlotName[]).map((s) => ({ label: SLOT_LABEL[s], detail: intentType === 'swap' ? 'swap' : 'clear', run: () => run(s) })),
  })

const breakfastFixed = () => answer('Breakfast is your fixed breakfast. You can change its amounts in Settings.', { link: { to: '/settings', label: 'Open Settings' } })

/** Does a recipe use every one of the named foods? Matches ingredient labels and food names, singular or plural. */
async function recipesWith(repo: Repo, foods: string[]): Promise<Set<string>> {
  const [ings, foodRows] = await Promise.all([repo.db.recipe_ingredients.toArray(), repo.db.foods.toArray()])
  const foodName = new Map(foodRows.map((f) => [f.id, f.name.toLowerCase()]))
  const stem = (w: string) => w.replace(/(es|s)$/, '')
  const words = foods.map((f) => f.split(' ').map(stem).filter((w) => w.length > 1))
  const text = new Map<string, string>()
  for (const i of ings) text.set(i.recipeId, `${text.get(i.recipeId) ?? ''} ${i.label.toLowerCase()} ${i.foodId ? foodName.get(i.foodId) ?? '' : ''}`)
  const out = new Set<string>()
  for (const [rid, t] of text) if (words.every((ws) => ws.every((w) => t.includes(w)))) out.add(rid)
  return out
}

const SLOT_ORDER: SlotName[] = ['smoko', 'lunch', 'dinner']

/** The next empty slot (from now, up to a week ahead) that suits the recipe. */
async function nextFreeSlot(deps: ChefDeps, recipe: Recipe): Promise<{ date: string; slot: SlotName } | null> {
  const t = await targetsOn(deps, deps.today)
  for (let i = 0; i < 7; i++) {
    const date = addDays(deps.today, i)
    for (const slot of SLOT_ORDER) {
      if (!recipe.slotTags.some((tag) => SLOT_TAGS[slot].includes(tag))) continue
      if (i === 0 && deps.now && t && t.day.slots[slot].time <= deps.now) continue
      if (!(await plannedAt(deps.repo, date, slot))) return { date, slot }
    }
  }
  return null
}

async function planOption(deps: ChefDeps, recipe: Recipe, detail?: string): Promise<Option | null> {
  const at = await nextFreeSlot(deps, recipe)
  if (!at) return null
  return {
    label: `Put ${recipe.name} on ${mealLabel(at.date, at.slot, deps.today)}`,
    detail,
    run: async () => {
      const t = await targetsOn(deps, at.date)
      if (!t) return noTargets()
      const nutrition = await loadRecipeNutrition(deps.repo)
      const opt = rankForSlot({ slot: at.slot, recipes: [recipe], nutrition, targetProtein: mid(t.day.slots[at.slot].proteinG) })[0]
      return { kind: 'done', ...(await placeMeal(deps, at.date, at.slot, recipe, opt?.scale ?? 1)) }
    },
  }
}

const mid = ([a, b]: [number, number]) => (a + b) / 2

// ---------- meals ----------

async function swap(deps: ChefDeps, date: string, slot: SlotName | undefined, withFood?: string): Promise<Reply> {
  if (!slot) return pickSlot('swap', date, deps.today, (s) => swap(deps, date, s, withFood))
  if (slot === 'breakfast') return breakfastFixed()
  const t = await targetsOn(deps, date)
  if (!t) return noTargets()
  const [recipes, nutrition, pantry, current] = await Promise.all([
    deps.repo.db.recipes.toArray(),
    loadRecipeNutrition(deps.repo),
    loadPantrySuggestions(deps.repo, deps.today),
    plannedAt(deps.repo, date, slot),
  ])
  const allowed = withFood ? await recipesWith(deps.repo, [withFood]) : null
  const ranked = rankForSlot({ slot, recipes, nutrition, pantry, targetProtein: mid(t.day.slots[slot].proteinG) })
    .filter((o) => o.r.id !== current?.recipeId && (!allowed || allowed.has(o.r.id)))
    .slice(0, 3)
  const now = current ? (await deps.repo.get('recipes', current.recipeId))?.name : undefined
  if (!ranked.length) {
    return answer(withFood ? `I couldn’t find a ${SLOT_LABEL[slot].toLowerCase()} recipe with ${withFood}.` : `No other ${SLOT_LABEL[slot].toLowerCase()} recipes to offer.`)
  }
  return answer(`Pick one for ${mealLabel(date, slot, deps.today)}${now ? ` (now: ${now})` : ''}:`, {
    options: ranked.map((o) => ({
      label: o.r.name,
      detail: [`${Math.round(o.protein)} g protein`, `${Math.round(o.kcal)} kcal`, o.scale !== 1 ? `${o.scale}×` : '', o.pantry > 0 ? `${Math.round(o.pantry * 100)}% in pantry` : ''].filter(Boolean).join(' · '),
      run: async () => ({ kind: 'done', ...(await placeMeal(deps, date, slot, o.r, o.scale)) }),
    })),
  })
}

async function findRecipes(repo: Repo, query: string): Promise<Recipe[]> {
  const recipes = (await repo.db.recipes.toArray()).filter((r) => !r.fixedSlot)
  const fuse = new Fuse(recipes, { keys: ['name'], threshold: 0.45, ignoreLocation: true, includeScore: true })
  const hits = fuse.search(query)
  if (!hits.length) return []
  const best = hits[0].score ?? 0
  return hits.filter((h) => (h.score ?? 0) - best < 0.08).slice(0, 4).map((h) => h.item)
}

async function setMeal(deps: ChefDeps, date: string, slot: SlotName | undefined, query: string): Promise<Reply> {
  if (slot === 'breakfast') return breakfastFixed()
  const found = await findRecipes(deps.repo, query)
  if (!found.length) {
    return answer(`I couldn’t find a recipe called “${query}”.`, { link: { to: '/recipes', label: 'Browse recipes' } })
  }
  if (found.length > 1) {
    return answer(`Which one did you mean?`, { options: found.map((r) => ({ label: r.name, run: () => setMeal(deps, date, slot, r.name) })) })
  }
  const recipe = found[0]
  const s = slot ?? (['dinner', 'lunch', 'smoko'] as SlotName[]).find((x) => recipe.slotTags.some((tag) => SLOT_TAGS[x].includes(tag)))
  if (!s) return answer(`${recipe.name} isn’t tagged for a meal I can plan. Say which meal, e.g. “for dinner”.`)
  const t = await targetsOn(deps, date)
  if (!t) return noTargets()
  const nutrition = await loadRecipeNutrition(deps.repo)
  const n = nutrition.get(recipe.id)
  const opt = rankForSlot({ slot: s, recipes: [{ ...recipe, slotTags: SLOT_TAGS[s] }], nutrition, targetProtein: mid(t.day.slots[s].proteinG) })[0]
  const scale = opt?.scale ?? 1
  const current = await plannedAt(deps.repo, date, s)
  const now = current ? (await deps.repo.get('recipes', current.recipeId))?.name : undefined
  return {
    kind: 'proposal',
    text: `Put ${recipe.name} on ${mealLabel(date, s, deps.today)}?`,
    changes: [
      `${cap(mealLabel(date, s, deps.today))}: ${now ?? 'nothing'} → ${recipe.name}`,
      n ? `${scale !== 1 ? `${scale}× serving, ` : ''}about ${Math.round(n.perServing.proteinG * scale)} g protein, ${Math.round(n.perServing.energyKcal * scale)} kcal` : '',
    ].filter(Boolean),
    apply: () => placeMeal(deps, date, s, recipe, scale),
  }
}

async function clear(deps: ChefDeps, date: string, slot?: SlotName): Promise<Reply> {
  if (!slot) return pickSlot('clear', date, deps.today, (s) => clear(deps, date, s))
  if (slot === 'breakfast') return breakfastFixed()
  const current = await plannedAt(deps.repo, date, slot)
  if (!current) return answer(`Nothing is planned for ${mealLabel(date, slot, deps.today)}.`)
  const name = (await deps.repo.get('recipes', current.recipeId))?.name ?? 'the meal'
  return {
    kind: 'proposal',
    text: `Clear ${mealLabel(date, slot, deps.today)}?`,
    changes: [`${cap(mealLabel(date, slot, deps.today))}: ${name} → nothing`],
    apply: async () => {
      await clearMeal(deps.repo, date, slot)
      return {
        text: `Cleared ${mealLabel(date, slot, deps.today)}.`,
        undo: async () => {
          const t = await targetsOn(deps, date)
          if (!t) throw new Error('Your targets need approving first.')
          await assignMeal(deps.repo, { date, slot, time: current.time, recipeId: current.recipeId, portionScale: current.portionScale, targetsId: t.id, targetsVersion: t.version })
          return `Put ${name} back.`
        },
      }
    },
  }
}

async function meals(deps: ChefDeps, date: string, slot?: SlotName): Promise<Reply> {
  const planned = await deps.repo.db.planned_meals.where('date').equals(date).toArray()
  const names = new Map((await deps.repo.db.recipes.toArray()).map((r) => [r.id, r.name]))
  const line = (s: SlotName) => {
    if (s === 'breakfast') return `Breakfast: ${names.get(FIXED_BREAKFAST_ID) ?? 'fixed breakfast'}`
    const p = planned.find((x) => x.slot === s)
    return `${SLOT_LABEL[s]}: ${p ? `${names.get(p.recipeId)}${p.portionScale !== 1 ? ` (${p.portionScale}×)` : ''}` : 'nothing planned'}`
  }
  if (slot) {
    const p = planned.find((x) => x.slot === slot)
    if (slot !== 'breakfast' && !p) {
      return answer(`Nothing is planned for ${mealLabel(date, slot, deps.today)}.`, { options: [{ label: 'Suggest something', run: () => swap(deps, date, slot) }] })
    }
    return answer(`${cap(mealLabel(date, slot, deps.today))}: ${line(slot).split(': ')[1]}.`, { link: { to: date === deps.today ? '/' : '/plan', label: date === deps.today ? 'See Today' : 'See the plan' } })
  }
  return answer(`${cap(dayLabel(date, deps.today))}:`, { lines: SLOTS.map(line), link: { to: date === deps.today ? '/' : '/plan', label: date === deps.today ? 'See Today' : 'See the plan' } })
}

async function nutritionLeft(deps: ChefDeps, date: string): Promise<Reply> {
  const t = await targetsOn(deps, date)
  if (!t) return noTargets()
  const [planned, nutrition] = await Promise.all([deps.repo.db.planned_meals.where('date').equals(date).toArray(), loadRecipeNutrition(deps.repo)])
  let sum = emptyNutrients()
  const fb = nutrition.get(FIXED_BREAKFAST_ID)
  if (fb) sum = addNutrients(sum, fb.perServing)
  for (const p of planned) {
    const n = nutrition.get(p.recipeId)
    if (n) sum = addNutrients(sum, n.perServing, p.portionScale)
  }
  const d = t.day
  const row = (label: string, have: number, want: number, unit: string) => {
    const gap = Math.round(want - have)
    return `${label}: ${Math.round(have)} of ${Math.round(want)} ${unit} planned${gap > 0 ? ` · ${gap} ${unit} to go` : gap < 0 ? ` · ${-gap} ${unit} over` : ''}`
  }
  const protGap = Math.round(d.proteinG.preferred - sum.proteinG)
  return answer(
    protGap > 0 ? `${cap(dayLabel(date, deps.today))}’s meals plan ${Math.round(sum.proteinG)} g protein: ${protGap} g short of ${d.proteinG.preferred} g.` : `${cap(dayLabel(date, deps.today))}’s meals cover your protein target.`,
    {
      lines: [row('Energy', sum.energyKcal, d.energyKcal, 'kcal'), row('Protein', sum.proteinG, d.proteinG.preferred, 'g'), row('Carbs', sum.carbsG, d.carbsG, 'g'), row('Fat', sum.fatG, d.fatG, 'g'), 'Based on the meals planned; marking meals as eaten arrives later.'],
      link: { to: '/', label: 'See Today' },
    },
  )
}

// ---------- training ----------

async function dayType(deps: ChefDeps, date: string, type: 'training' | 'rest', start?: string): Promise<Reply> {
  const before = await dayChoice(deps.repo, date)
  if (before.dayType === type && (!start || before.workout?.start === start)) {
    return answer(`${cap(dayLabel(date, deps.today))} is already a ${type} day${type === 'training' && before.workout ? ` (${before.workout.start})` : ''}.`)
  }
  const prev: Workout | undefined = await deps.repo.db.workouts.where('date').equals(date).first()
  const approved = await approvedTargets(deps.repo)
  const tpl = approved?.targetSet.templates
  const describe = (k: 'training' | 'rest') => (tpl ? `${tpl[k].energyKcal.toLocaleString('en-AU')} kcal, ${tpl[k].carbsG} g carbs, ${tpl[k].fatG} g fat` : '')
  const was = before.dayType === 'training' ? `training${before.workout ? ` ${before.workout.start}` : ''}` : 'rest'
  const will = type === 'training' ? `training${start ? ` ${start}` : before.workout?.start && before.dayType === 'training' ? ` ${before.workout.start}` : ''}` : 'rest'
  return {
    kind: 'proposal',
    text: type === 'rest' ? `Make ${dayLabel(date, deps.today)} a rest day?` : `Make ${dayLabel(date, deps.today)} a training day${start ? ` at ${start}` : ''}?`,
    changes: [
      `${cap(dayLabel(date, deps.today))}: ${was} → ${will}`,
      !tpl || before.dayType === type ? '' : describe(before.dayType) === describe(type) ? 'Targets stay the same: training and rest days match in your settings' : `Targets: ${describe(before.dayType)} → ${describe(type)}`,
    ].filter(Boolean),
    apply: async () => {
      await setDayType(deps.repo, date, type, start)
      return {
        text: `${cap(dayLabel(date, deps.today))} is now a ${type} day${type === 'training' && start ? ` at ${start}` : ''}. Your targets follow it; nothing needs re-approving.`,
        link: { to: '/plan', label: 'See the plan' },
        undo: async () => {
          if (prev) await deps.repo.update('workouts', prev.id, prev)
          else await clearDayChoice(deps.repo, date)
          return `${cap(dayLabel(date, deps.today))} is back to ${was}.`
        },
      }
    },
  }
}

async function usual(deps: ChefDeps, date: string): Promise<Reply> {
  const prev = await deps.repo.db.workouts.where('date').equals(date).first()
  if (!prev) return answer(`${cap(dayLabel(date, deps.today))} already follows your usual week.`)
  if (prev.status === 'completed') return answer(`${cap(dayLabel(date, deps.today))}’s workout is marked completed, so it stays.`)
  const before = await dayChoice(deps.repo, date)
  return {
    kind: 'proposal',
    text: `Put ${dayLabel(date, deps.today)} back to your usual week?`,
    changes: [`${cap(dayLabel(date, deps.today))}: ${before.dayType} (your choice) → your usual week`],
    apply: async () => {
      await clearDayChoice(deps.repo, date)
      const after = await dayChoice(deps.repo, date)
      return {
        text: `${cap(dayLabel(date, deps.today))} follows your usual week again: a ${after.dayType} day.`,
        undo: async () => {
          await deps.repo.insert('workouts', prev)
          return `${cap(dayLabel(date, deps.today))} is back to ${before.dayType}.`
        },
      }
    },
  }
}

// ---------- pantry ----------

async function expiringSoon(deps: ChefDeps): Promise<Reply> {
  const soon = addDays(deps.today, 3)
  const [lots, products] = await Promise.all([deps.repo.db.inventory_lots.toArray(), deps.repo.db.products.toArray()])
  const pname = new Map(products.map((p) => [p.id, p.name]))
  const dated = lots.filter((l) => l.remaining > 1e-9 && l.expiryDate && l.expiryDate <= soon).sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))
  if (!dated.length) return answer('Nothing in your pantry is dated in the next 3 days.', { options: [{ label: 'What can I cook from the pantry?', run: () => cook(deps, []) }] })
  const lines = dated.map((l) => {
    const past = l.expiryDate! < deps.today
    const kind = l.expiryKind === 'best_before' ? 'best before' : 'use by'
    return `${pname.get(l.productId) ?? 'Item'}: ${formatQty(l.remaining, l.unit)}, ${kind} ${dayLabel(l.expiryDate!, deps.today)}${past && l.expiryKind !== 'best_before' ? ' (past its use-by: check it before eating)' : ''}`
  })
  const suggestions = (await loadPantrySuggestions(deps.repo, deps.today)).filter((s) => s.usesSoon.length).slice(0, 3)
  const options = (await Promise.all(suggestions.map((s) => planOption(deps, s.recipe, `uses ${s.usesSoon.join(', ')}`)))).filter((o): o is Option => !!o)
  return answer(suggestions.length ? 'Dated soon, and recipes that use it:' : 'Dated soon (no recipe uses these yet):', { lines, options, link: { to: '/pantry', label: 'Open Pantry' } })
}

async function cook(deps: ChefDeps, foods: string[]): Promise<Reply> {
  const suggestions = await loadPantrySuggestions(deps.repo, deps.today, 200)
  const cover = new Map(suggestions.map((s) => [s.recipe.id, s]))
  let candidates: Recipe[]
  if (foods.length) {
    const ok = await recipesWith(deps.repo, foods)
    candidates = (await deps.repo.db.recipes.toArray()).filter((r) => !r.fixedSlot && ok.has(r.id))
    candidates.sort((a, b) => (cover.get(b.id)?.score ?? 0) - (cover.get(a.id)?.score ?? 0))
  } else candidates = suggestions.map((s) => s.recipe)
  const top = candidates.slice(0, 4)
  if (!top.length) {
    return answer(foods.length ? `No recipes use ${foods.join(' and ')} yet.` : 'Nothing in your pantry matches a recipe yet. Scan a receipt or add food to the pantry first.', { link: { to: foods.length ? '/recipes' : '/scan', label: foods.length ? 'Browse recipes' : 'Scan a receipt' } })
  }
  const options = (await Promise.all(top.map((r) => {
    const c = cover.get(r.id)
    return planOption(deps, r, c ? `${Math.round(c.coverage * 100)}% in your pantry${c.missing.length ? ` · need ${c.missing.slice(0, 3).join(', ')}` : ''}` : 'nothing in your pantry yet')
  }))).filter((o): o is Option => !!o)
  return answer(foods.length ? `Recipes with ${foods.join(' and ')}, most in your pantry first:` : 'From what’s in your pantry:', {
    lines: options.length ? undefined : top.map((r) => r.name),
    options,
  })
}

/** Products in stock matching the words, with their lots (soonest-dated first). */
async function stockMatching(repo: Repo, item: string): Promise<Array<{ product: Product; lots: InventoryLot[] }>> {
  const [lots, products, foods] = await Promise.all([repo.db.inventory_lots.toArray(), repo.db.products.toArray(), repo.db.foods.toArray()])
  const inStock = lots.filter((l) => l.remaining > 1e-9)
  const stocked = products.filter((p) => inStock.some((l) => l.productId === p.id))
  const hits = searchItems(item, stocked, foods, 20).filter((h) => h.kind === 'product')
  // a food match also finds products linked to that food
  const foodHits = searchItems(item, [], foods, 5).filter((h) => h.kind === 'food').map((h) => (h.kind === 'food' ? h.food.id : ''))
  const ids = new Set([...hits.map((h) => (h.kind === 'product' ? h.product.id : '')), ...stocked.filter((p) => p.foodId && foodHits.includes(p.foodId)).map((p) => p.id)])
  return stocked
    .filter((p) => ids.has(p.id))
    .map((product) => ({ product, lots: inStock.filter((l) => l.productId === product.id).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999')) }))
}

const sumQty = (lots: InventoryLot[]) => {
  const byUnit = new Map<QtyUnit, number>()
  for (const l of lots) byUnit.set(l.unit, (byUnit.get(l.unit) ?? 0) + l.remaining)
  return [...byUnit.entries()].map(([u, q]) => formatQty(q, u)).join(' + ')
}

async function stock(deps: ChefDeps, item?: string, location?: InventoryLot['location']): Promise<Reply> {
  if (item) {
    const found = await stockMatching(deps.repo, item)
    const here = location ? found.map((f) => ({ ...f, lots: f.lots.filter((l) => l.location === location) })).filter((f) => f.lots.length) : found
    if (!here.length) {
      return answer(`No ${item} in ${location ? `the ${location}` : 'your pantry'}.`, { options: [{ label: `Add ${item} to the shopping list`, run: () => shopAdd(deps, item) }] })
    }
    return answer(here.length === 1 ? `You have ${sumQty(here[0].lots)} of ${here[0].product.name}.` : `You have:`, {
      lines: here.length === 1 ? undefined : here.map((f) => `${f.product.name}: ${sumQty(f.lots)}`),
      link: { to: '/pantry', label: 'Open Pantry' },
    })
  }
  const [lots, products] = await Promise.all([deps.repo.db.inventory_lots.toArray(), deps.repo.db.products.toArray()])
  const here = lots.filter((l) => l.remaining > 1e-9 && (!location || l.location === location))
  if (!here.length) return answer(location ? `Nothing in the ${location}.` : 'Your pantry is empty.', { link: { to: '/scan', label: 'Scan a receipt' } })
  const byProduct = new Map<string, InventoryLot[]>()
  for (const l of here) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l])
  const name = new Map(products.map((p) => [p.id, p.name]))
  return answer(`In ${location ? `the ${location}` : 'your pantry'}:`, {
    lines: [...byProduct.entries()].map(([pid, ls]) => `${name.get(pid) ?? 'Item'}: ${sumQty(ls)}`).sort(),
    link: { to: '/pantry', label: 'Open Pantry' },
  })
}

async function discard(deps: ChefDeps, i: Extract<Intent, { type: 'discard' }>): Promise<Reply> {
  const found = await stockMatching(deps.repo, i.item)
  if (!found.length) return answer(`I can’t find any ${i.item} in your pantry.`, { link: { to: '/pantry', label: 'Open Pantry' } })
  if (found.length > 1 && !found.every((f) => f.product.foodId && f.product.foodId === found[0].product.foodId)) {
    return answer('Which one?', { options: found.slice(0, 4).map((f) => ({ label: f.product.name, run: () => discard(deps, { ...i, item: f.product.name }) })) })
  }
  const lots = found.flatMap((f) => f.lots).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))
  const unit = lots[0].unit
  const same = lots.filter((l) => l.unit === unit)
  const have = same.reduce((s, l) => s + l.remaining, 0)
  const want = Math.min(have, i.qty && i.unit === unit ? i.qty : have * (i.fraction ?? 1))
  if (want <= 1e-9) return answer('That’s nothing to throw out.')
  const plan: Array<{ lot: InventoryLot; qty: number }> = []
  let left = want
  for (const l of same) {
    if (left <= 1e-9) break
    const q = Math.min(l.remaining, left)
    plan.push({ lot: l, qty: q })
    left -= q
  }
  const cost = Math.round(plan.reduce((s, p) => s + p.qty * p.lot.unitCostCents, 0))
  const name = found[0].product.name
  return {
    kind: 'proposal',
    text: `Throw out ${formatQty(want, unit)} of ${name}?`,
    changes: [`Pantry: ${formatQty(have, unit)} → ${formatQty(have - want, unit)} of ${name}`, cost > 0 ? `Recorded as food waste: ${money(cost)}` : 'Recorded as food waste'],
    apply: async () => {
      const txns: string[] = []
      await deps.repo.tx(async () => {
        for (const p of plan) {
          const reason = i.spoiled ? 'spoiled' : p.lot.expiryDate && p.lot.expiryDate < deps.today ? 'expired' : 'other'
          const w = await deps.pantry.discard(p.lot.id, p.qty, reason)
          txns.push(w.transactionId)
        }
      })
      return {
        text: `Threw out ${formatQty(want, unit)} of ${name}.`,
        link: { to: '/pantry', label: 'Open Pantry' },
        undo: async () => {
          await deps.repo.tx(async () => {
            for (const t of txns) await deps.pantry.undo(t)
          })
          return `${name} is back in your pantry.`
        },
      }
    },
  }
}

// ---------- shopping ----------

async function shopAdd(deps: ChefDeps, item: string, qty?: number, unit?: QtyUnit): Promise<Reply> {
  const [products, foods, list] = await Promise.all([deps.repo.db.products.toArray(), deps.repo.db.foods.toArray(), currentList(deps.repo)])
  const hit = searchItems(item, products, foods, 1)[0]
  const choice: ExtraChoice = hit ? (hit.kind === 'product' ? { kind: 'product', product: hit.product } : { kind: 'food', foodId: hit.food.id, label: hit.label }) : { kind: 'text', name: cap(item) }
  const label = hit ? hit.label : cap(item)
  const amount = qty ? `${formatQty(qty, unit ?? 'unit')}${unit === 'unit' || !unit ? ' × ' : ' of '}` : ''
  return {
    kind: 'proposal',
    text: `Add ${amount}${label} to the shopping list?`,
    changes: [list ? `Shopping list: + ${amount}${label}` : `Starts this week’s shopping list from your meal plan, then adds ${amount}${label}`],
    apply: async () => {
      let listId = list?.id
      if (!listId) listId = (await generateList(deps.repo, thisWeekRange(deps.today))).listId
      const added = await addExtra(deps.repo, listId, choice, qty ?? 1, unit ?? 'unit')
      return {
        text: `Added ${label} to the shopping list.`,
        link: { to: '/shopping', label: 'Open the list' },
        undo: async () => {
          await removeItem(deps.repo, added.id)
          return `Took ${label} off the list.`
        },
      }
    },
  }
}

async function shopBuild(deps: ChefDeps, week: 'this' | 'next'): Promise<Reply> {
  const list = await currentList(deps.repo)
  const range = week === 'next' ? nextWeekRange(deps.today) : thisWeekRange(deps.today)
  return {
    kind: 'proposal',
    text: `${list ? 'Update' : 'Build'} the shopping list for meals ${dayLabel(range.from, deps.today)} to ${dayLabel(range.to, deps.today)}?`,
    changes: [list ? 'Recalculates the planned items; your ticks and added items stay' : 'A new list from your planned meals and breakfasts, minus your pantry'],
    apply: async () => {
      const r = await generateList(deps.repo, range, list?.id)
      return {
        text: `${r.toBuy} item${r.toBuy === 1 ? '' : 's'} to buy, from ${r.plannedMeals} planned meal${r.plannedMeals === 1 ? '' : 's'} and ${r.meals - r.plannedMeals} breakfasts.${r.covered.length ? ` ${r.covered.length} already in your pantry.` : ''}`,
        link: { to: '/shopping', label: 'Open the list' },
      }
    },
  }
}

// ---------- progress and money ----------

async function weigh(deps: ChefDeps, kg: number, timeOfDay: 'morning' | 'midday' | 'evening'): Promise<Reply> {
  const last = (await deps.repo.db.weight_measurements.orderBy('date').reverse().toArray())[0]
  const diff = last ? Math.round((kg - last.weightKg) * 10) / 10 : null
  return {
    kind: 'proposal',
    text: `Add a weigh-in of ${kg} kg?`,
    changes: [`Progress: ${kg} kg, ${timeOfDay}, ${dayLabel(deps.today, deps.today)}`, diff !== null ? `${diff === 0 ? 'Same as' : diff > 0 ? `+${diff} kg on` : `${diff} kg on`} your last weigh-in (${last.weightKg} kg, ${dayLabel(last.date, deps.today)})` : ''].filter(Boolean),
    apply: async () => {
      const id = newId()
      await deps.repo.insert('weight_measurements', { id, profileId: PROFILE_ID, date: deps.today, weightKg: kg, timeOfDay })
      return {
        text: `Saved ${kg} kg.`,
        link: { to: '/progress', label: 'See Progress' },
        undo: async () => {
          await deps.repo.remove('weight_measurements', id)
          return 'Removed that weigh-in.'
        },
      }
    },
  }
}

async function spent(deps: ChefDeps, period: 'week' | 'month'): Promise<Reply> {
  const r = periodRange(period, deps.today)
  const xs = await deps.repo.db.expenses.where('date').between(r.start, r.end, true, true).toArray()
  return answer(`${money(total(xs))} spent this ${period} (${xs.length} expense${xs.length === 1 ? '' : 's'}).`, { link: { to: '/expenses', label: 'See Expenses' } })
}

async function budget(deps: ChefDeps): Promise<Reply> {
  const s = await budgetStatuses(deps.repo, deps.today)
  if (!s.length) return answer('You haven’t set a budget yet.', { link: { to: '/expenses', label: 'Set one in Expenses' } })
  return answer('Your budgets:', {
    lines: s.map(({ period, status }) => `This ${period}: ${money(status.spentCents)} of ${money(status.limitCents)} · ${status.remainingCents >= 0 ? `${money(status.remainingCents)} left` : `${money(-status.remainingCents)} over`}`),
    link: { to: '/expenses', label: 'See Expenses' },
  })
}

import { describe, expect, it } from 'vitest'
import type { Nutrients, SlotTag } from '../../db/types'
import type { DayTargets, SlotTargets } from '../contract'
import { planWeek, PLAN_SLOTS, type PlanInput, type PlannerRecipe } from './engine'

const N = (p: number, c: number, f: number, extra: Partial<Nutrients> = {}): Nutrients => ({
  energyKj: 0, energyKcal: p * 4 + c * 4 + f * 9, proteinG: p, fatG: f, satFatG: 0, carbsG: c, sugarsG: 0, addedSugarG: 0, fibreG: 10, sodiumMg: 0, ...extra,
})
const slot = (time: string, p: number, c: number, f: number, extra: Partial<SlotTargets> = {}): SlotTargets => ({ time, proteinG: [p - 5, p + 5], carbLevel: 'low-moderate', carbsG: [c - 10, c + 10], fatG: [f - 8, f + 8], ...extra })
const day = (date: string, extra: Partial<DayTargets> = {}): DayTargets => ({
  date, dayType: 'rest', energyKcal: 4 * (30 + 40 * 3) + 4 * (10 + 30 * 3) + 9 * (40 + 20 * 3), proteinG: { min: 120, preferred: 150 }, carbsG: 100, carbsMinG: null, fatG: 100,
  satFatMaxG: null, fibreMinG: 20, addedSugarMaxG: 50,
  slots: { breakfast: slot('07:00', 30, 10, 40), smoko: slot('11:00', 40, 30, 20), lunch: slot('14:00', 40, 30, 20), dinner: slot('18:00', 40, 30, 20) },
  ...extra,
})
let n = 0
const recipe = (name: string, tags: SlotTag[], ps: Nutrients, extra: Partial<PlannerRecipe> = {}): PlannerRecipe => ({
  id: `r${String(n++).padStart(3, '0')}-${name}`, name, cuisine: name, slotTags: tags, perServing: ps, ingredients: [], costPerServing: null, ...extra,
})

/** Enough distinct, well-fitting recipes per slot for a week (built once, so ids are stable). */
const CAT: PlannerRecipe[] = (['smoko', 'lunch', 'dinner'] as const).flatMap((s) => Array.from({ length: 6 }, (_, i) => recipe(`${s}${i}`, [s], N(40, 30, 20))))
const catalogue = () => CAT
const DATES = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']
function input(over: Partial<PlanInput> = {}): PlanInput {
  const dates = over.dates ?? DATES
  return {
    dates,
    days: Object.fromEntries(dates.map((d) => [d, day(d)])),
    recipes: catalogue(),
    breakfast: { perDay: N(30, 10, 40), ingredients: [] },
    stock: [],
    ratings: new Map(),
    locked: [],
    fill: dates.flatMap((date) => PLAN_SLOTS.map((s) => ({ date, slot: s }))),
    ...over,
  }
}
const at = (r: ReturnType<typeof planWeek>, date: string, s: string) => r.meals.find((m) => m.date === date && m.slot === s)!

describe('planner', () => {
  it('fills every open slot, days on target, deterministic', () => {
    const a = planWeek(input())
    expect(a.meals).toHaveLength(21)
    expect(a.unfilled).toEqual([])
    for (const d of a.days) expect(Math.abs(d.totals.energyKcal - d.target.energyKcal) / d.target.energyKcal).toBeLessThan(0.1)
    expect(planWeek(input()).meals.map((m) => m.recipeId)).toEqual(a.meals.map((m) => m.recipeId))
  })

  it('slot fit decides: a recipe far outside the carb range loses', () => {
    const good = recipe('fits', ['dinner'], N(40, 30, 20))
    const carby = recipe('aaa-carby', ['dinner'], N(40, 120, 20))
    const r = planWeek(input({ dates: [DATES[0]], recipes: [carby, good, ...catalogue().filter((x) => !x.slotTags.includes('dinner'))] }))
    expect(at(r, DATES[0], 'dinner').recipeId).toBe(good.id)
  })

  it('prefers post-workout lunches on training days', () => {
    const plain = recipe('aaa-plain', ['lunch'], N(40, 30, 20))
    const post = recipe('zzz-post', ['lunch', 'post-workout'], N(40, 30, 20))
    const base = catalogue().filter((x) => !x.slotTags.includes('lunch'))
    const d = DATES[0]
    const training = planWeek(input({ dates: [d], days: { [d]: day(d, { dayType: 'training' }) }, recipes: [plain, post, ...base] }))
    expect(at(training, d, 'lunch')).toMatchObject({ recipeId: post.id, reasons: expect.arrayContaining(['post-workout']) })
  })

  it('uses food dated soon; never food past its use-by; stock is not double-counted', () => {
    const chicken = recipe('zzz-chicken', ['dinner'], N(40, 30, 20), { ingredients: [{ foodId: 'chicken', grams: 200 }] })
    const base = catalogue()
    const names = new Map([['chicken', 'Chicken breast']])
    const soon = planWeek(input({ dates: DATES.slice(0, 3), recipes: [...base, chicken], foodNames: names, stock: [{ foodId: 'chicken', grams: 200, expiryDate: DATES[1], expiryKind: 'use_by' }] }))
    const dinners = soon.meals.filter((m) => m.slot === 'dinner' && m.recipeId === chicken.id)
    expect(dinners).toHaveLength(1) // 200 g covers one dinner only
    expect(dinners[0].date <= DATES[1]).toBe(true)
    expect(dinners[0].reasons[0]).toBe('uses Chicken breast dated soon')
    expect(soon.week.usesSoon).toEqual(['Chicken breast'])
    // past its use-by on every planned day: no pull towards it
    const past = planWeek(input({ dates: DATES.slice(2, 4), recipes: [...base, chicken], stock: [{ foodId: 'chicken', grams: 2000, expiryDate: DATES[0], expiryKind: 'use_by' }] }))
    expect(past.week.usesSoon).toEqual([])
  })

  it('variety: at most twice a week and never on consecutive days', () => {
    // only 3 dinners exist: the week needs repeats, but spaced out
    const three = [0, 1, 2].map((i) => recipe(`only${i}`, ['dinner'], N(40, 30, 20)))
    const r = planWeek(input({ recipes: [...catalogue().filter((x) => !x.slotTags.includes('dinner')), ...three] }))
    const dinners = r.meals.filter((m) => m.slot === 'dinner')
    const count = new Map<string, string[]>()
    for (const m of dinners) count.set(m.recipeId, [...(count.get(m.recipeId) ?? []), m.date])
    for (const ds of count.values()) {
      expect(ds.length).toBeLessThanOrEqual(2)
      if (ds.length === 2) expect(DATES.indexOf(ds[1]) - DATES.indexOf(ds[0])).toBeGreaterThan(1)
    }
    expect(dinners.length).toBe(6) // 3 recipes x 2: one dinner can't be filled
    expect(r.unfilled).toHaveLength(1)
  })

  it('ratings: never "don’t recommend"; favourites win ties', () => {
    const base = catalogue()
    const banned = base.find((x) => x.slotTags.includes('dinner'))!
    const fav = base.filter((x) => x.slotTags.includes('lunch'))[3]
    const r = planWeek(input({ dates: DATES.slice(0, 2), recipes: base, ratings: new Map([[banned.id, { flags: ['do_not_recommend'] }], [fav.id, { flags: ['favourite'] }]]) }))
    expect(r.meals.some((m) => m.recipeId === banned.id)).toBe(false)
    expect(at(r, DATES[0], 'lunch')).toMatchObject({ recipeId: fav.id, reasons: expect.arrayContaining(['a favourite']) })
  })

  it('cost only breaks near-ties; it never beats a clearly better fit', () => {
    const d = DATES[0]
    const others = catalogue().filter((x) => !x.slotTags.includes('dinner'))
    const cheap = recipe('cheap', ['dinner'], N(40, 30, 20), { costPerServing: 300 })
    const dear = recipe('aaa-dear', ['dinner'], N(40, 30, 20), { costPerServing: 1500 })
    expect(at(planWeek(input({ dates: [d], recipes: [dear, cheap, ...others] })), d, 'dinner').recipeId).toBe(cheap.id)
    const cheapPoorFit = recipe('cheap-carby', ['dinner'], N(40, 90, 20), { costPerServing: 100 })
    expect(at(planWeek(input({ dates: [d], recipes: [dear, cheapPoorFit, ...others] })), d, 'dinner').recipeId).toBe(dear.id)
  })

  it('locked meals are kept and only open slots are filled', () => {
    const base = catalogue()
    const lockedDinner = base.find((x) => x.slotTags.includes('dinner'))!
    const r = planWeek(input({
      dates: [DATES[0]],
      locked: [{ date: DATES[0], slot: 'dinner', recipeId: lockedDinner.id, portionScale: 1 }],
      fill: [{ date: DATES[0], slot: 'smoko' }, { date: DATES[0], slot: 'lunch' }],
    }))
    expect(r.meals.map((m) => m.slot)).toEqual(['smoko', 'lunch'])
  })

  it('day totals: a low-fibre week gets flagged; alternatives are offered', () => {
    const lowFibre = catalogue().map((r) => ({ ...r, perServing: { ...r.perServing, fibreG: 1 } }))
    const r = planWeek(input({ dates: [DATES[0]], recipes: lowFibre, breakfast: { perDay: { ...N(30, 10, 40), fibreG: 0 }, ingredients: [] } }))
    expect(r.days[0].issues.join()).toMatch(/fibre 3 g, under 20 g/)
    expect(at(r, DATES[0], 'dinner').alternatives.length).toBeGreaterThan(0)
  })

  it('swapping away from a recipe excludes it from that slot only', () => {
    const a = planWeek(input({ dates: [DATES[0]] }))
    const was = at(a, DATES[0], 'dinner').recipeId
    const b = planWeek(input({ dates: [DATES[0]], exclude: { [`${DATES[0]}|dinner`]: [was] } }))
    expect(at(b, DATES[0], 'dinner').recipeId).not.toBe(was)
    expect(b.meals).toHaveLength(3)
  })

  it('a seed gives a different but equally valid plan', () => {
    const a = planWeek(input())
    const b = planWeek(input({ seed: 7 }))
    expect(b.meals).toHaveLength(21)
    expect(b.meals.map((m) => m.recipeId)).not.toEqual(a.meals.map((m) => m.recipeId))
    expect(planWeek(input({ seed: 7 })).meals.map((m) => m.recipeId)).toEqual(b.meals.map((m) => m.recipeId))
  })
})

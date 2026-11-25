import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { approveTargets, changeGoal, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { assignMeal } from './day'
import { acceptDraft, buildDraft, reportion, staleTargets, type DraftParams } from './planner'
import { rate } from './ratings'

const TODAY = '2026-11-26' // Thursday
let repo: Repo
let pantry: Pantry
const week = (over: Partial<DraftParams> = {}): DraftParams => ({ from: TODAY, to: '2026-11-29', mode: 'empty', seed: 0, locks: [], skips: [], ...over })

beforeEach(async () => {
  const db = openDb(`plan-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-20')
  const { record } = await proposeTargets(repo, TODAY)
  await approveTargets(repo, record.id)
})

async function scanWoolworths() {
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  await saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines, imageHash: 'h' })
}

describe('planner with the real recipes', () => {
  it('plans this week from today: every open meal filled, days near target, nothing written yet', async () => {
    const d = await buildDraft(repo, week(), TODAY, '10:00')
    expect(d.result.meals).toHaveLength(4 * 3)
    expect(d.result.unfilled).toEqual([])
    for (const day of d.result.days) {
      expect(Math.abs(day.totals.energyKcal - day.target.energyKcal) / day.target.energyKcal).toBeLessThan(0.12)
    }
    expect(await repo.db.planned_meals.count()).toBe(0)
  })

  it('skips meals already past today', async () => {
    const d = await buildDraft(repo, week(), TODAY, '15:00')
    expect(d.result.meals.filter((m) => m.date === TODAY).map((m) => m.slot)).toEqual(['dinner'])
  })

  it('uses chicken dated tomorrow on or before tomorrow', async () => {
    await scanWoolworths()
    const chicken = (await repo.db.products.toArray()).find((p) => p.name.startsWith('Chicken'))!
    const lot = (await repo.db.inventory_lots.where('productId').equals(chicken.id).first())!
    await repo.update('inventory_lots', lot.id, { expiryDate: '2026-11-27', expiryKind: 'use_by' })
    const d = await buildDraft(repo, week(), TODAY, '08:00')
    const users = d.result.meals.filter((m) => m.reasons.some((r) => /chicken breast dated soon/i.test(r)))
    expect(users.length).toBeGreaterThan(0)
    for (const m of users) expect(m.date <= '2026-11-27').toBe(true)
  })

  it('accept writes every suggested meal; undo puts the week back', async () => {
    const t = (await repo.db.nutrition_targets.where('status').equals('approved').first())!
    await assignMeal(repo, { date: '2026-11-27', slot: 'dinner', time: '18:00', recipeId: 'recipe:au-chicken-rice-bowl', portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
    const d = await buildDraft(repo, week(), TODAY, '08:00')
    expect(d.result.meals.some((m) => m.date === '2026-11-27' && m.slot === 'dinner')).toBe(false) // kept: fill-empty mode
    const a = await acceptDraft(repo, d)
    expect(a.written).toBe(11)
    expect(await repo.db.planned_meals.count()).toBe(12)
    await a.undo()
    expect((await repo.db.planned_meals.toArray()).map((m) => m.recipeId)).toEqual(['recipe:au-chicken-rice-bowl'])
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('replan mode replaces unlocked meals; pinned swaps and cleared slots are honoured', async () => {
    const t = (await repo.db.nutrition_targets.where('status').equals('approved').first())!
    await assignMeal(repo, { date: '2026-11-27', slot: 'dinner', time: '18:00', recipeId: 'recipe:au-chicken-rice-bowl', portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
    const base = await buildDraft(repo, week({ mode: 'unlocked' }), TODAY, '08:00')
    const fri = base.result.meals.find((m) => m.date === '2026-11-27' && m.slot === 'lunch')!
    const swapped = { ...fri, recipeId: fri.alternatives[0] }
    const d = await buildDraft(repo, week({ mode: 'unlocked', locks: [swapped], skips: ['2026-11-27|dinner'] }), TODAY, '08:00')
    expect(d.result.meals.some((m) => m.date === '2026-11-27' && (m.slot === 'lunch' || m.slot === 'dinner'))).toBe(false)
    await acceptDraft(repo, d)
    expect((await repo.db.planned_meals.where('[date+slot]').equals(['2026-11-27', 'lunch']).first())!.recipeId).toBe(swapped.recipeId)
    expect(await repo.db.planned_meals.where('[date+slot]').equals(['2026-11-27', 'dinner']).first()).toBeUndefined() // cleared
  })

  it('never suggests a recipe rated "don’t suggest"', async () => {
    const d1 = await buildDraft(repo, week(), TODAY, '08:00')
    const victim = d1.result.meals[0].recipeId
    await rate(repo, victim, { on: ['do_not_recommend'] })
    const d2 = await buildDraft(repo, week(), TODAY, '08:00')
    expect(d2.result.meals.some((m) => m.recipeId === victim)).toBe(false)
  })

  it('after new targets: upcoming meals are stale; re-portion updates them and undo restores', async () => {
    await acceptDraft(repo, await buildDraft(repo, week(), TODAY, '08:00'))
    expect(await staleTargets(repo, TODAY)).toBeNull()
    const { record } = await changeGoal(repo, 'muscle_gain', 10, TODAY)
    await approveTargets(repo, record.id)
    const stale = await staleTargets(repo, TODAY)
    expect(stale).toMatchObject({ version: 2, meals: 12 })
    const r = await reportion(repo, TODAY)
    const before = new Map((await repo.db.planned_meals.toArray()).map((m) => [m.id, m.portionScale]))
    const undo = await r.apply()
    expect(await staleTargets(repo, TODAY)).toBeNull()
    for (const c of r.changes) expect((await repo.db.planned_meals.get(c.id))!.portionScale).toBe(c.to)
    await undo()
    for (const [id, s] of before) expect((await repo.db.planned_meals.get(id))!.portionScale).toBe(s)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('needs approved targets', async () => {
    await repo.db.nutrition_targets.clear()
    await expect(buildDraft(repo, week(), TODAY)).rejects.toThrow(/Approve your targets/)
  })
})

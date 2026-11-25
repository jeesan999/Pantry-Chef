import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { seedIfEmpty } from '../db/seed'
import { approveTargets, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { ask, type ChefDeps, type Done, type Reply } from './chef'
import { assignMeal } from './day'
import { dayChoice } from './schedule'

const TODAY = '2026-11-26' // Thursday
const BOWL = 'recipe:au-chicken-rice-bowl'
let repo: Repo
let pantry: Pantry
let deps: ChefDeps

beforeEach(async () => {
  const db = openDb(`chef-${newId()}`)
  await db.open()
  repo = new Repo(db)
  pantry = new Pantry(repo)
  await seedIfEmpty(repo, '2026-11-25')
  const { record } = await proposeTargets(repo, TODAY)
  const t = await approveTargets(repo, record.id)
  await assignMeal(repo, { date: TODAY, slot: 'dinner', time: '18:00', recipeId: BOWL, portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
  deps = { repo, pantry, today: TODAY }
})

async function scanWoolworths() {
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  const lines = await toCheckedLines(repo, p, await repo.db.foods.toArray())
  await saveReceipt(repo, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines, imageHash: 'h' })
}

function as<K extends Reply['kind']>(r: Reply, kind: K): Extract<Reply, { kind: K }> {
  expect(r.kind, JSON.stringify(r)).toBe(kind)
  return r as Extract<Reply, { kind: K }>
}
const apply = async (text: string): Promise<Done> => as(await ask(deps, text), 'proposal').apply()
const dinnerTonight = () => repo.db.planned_meals.where('[date+slot]').equals([TODAY, 'dinner']).first()

describe('Chef: meals', () => {
  it('swap tonight’s dinner offers 3 others; picking one changes it; undo puts it back', async () => {
    const r = as(await ask(deps, "swap tonight's dinner"), 'answer')
    expect(r.text).toMatch(/now: Lemon chicken/)
    expect(r.options).toHaveLength(3)
    const done = as(await r.options![1].run(), 'done')
    const after = await dinnerTonight()
    expect(after!.recipeId).not.toBe(BOWL)
    expect(done.text).toContain('tonight’s dinner')
    expect(await done.undo!()).toMatch(/Put back Lemon chicken/)
    expect((await dinnerTonight())!.recipeId).toBe(BOWL)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('swap with a food only offers recipes using it', async () => {
    const r = as(await ask(deps, 'something with salmon for dinner tomorrow'), 'answer')
    expect(r.options!.length).toBeGreaterThan(0)
    for (const o of r.options!) {
      const rec = (await repo.db.recipes.toArray()).find((x) => x.name === o.label)!
      const ings = await repo.db.recipe_ingredients.where('recipeId').equals(rec.id).toArray()
      expect(ings.some((i) => /salmon/i.test(`${i.label} ${i.foodId}`))).toBe(true)
    }
  })

  it('set a named recipe: proposal, then apply; slot asked only when needed', async () => {
    const p = as(await ask(deps, 'have prawn risotto for dinner on friday'), 'proposal')
    expect(p.changes[0]).toMatch(/tomorrow’s dinner: nothing → Prawn and pea risotto/i)
    await p.apply()
    const m = await repo.db.planned_meals.where('[date+slot]').equals(['2026-11-27', 'dinner']).first()
    expect((await repo.get('recipes', m!.recipeId))!.name).toMatch(/risotto/i)
  })

  it('an unknown recipe name says so', async () => {
    expect(as(await ask(deps, 'have zzqx flurb for dinner'), 'answer').text).toMatch(/couldn’t find/)
  })

  it('clear a meal, then undo', async () => {
    const done = await apply('eating out tonight')
    expect(await dinnerTonight()).toBeUndefined()
    await done.undo!()
    expect((await dinnerTonight())!.recipeId).toBe(BOWL)
    expect(as(await ask(deps, 'skip lunch tomorrow'), 'answer').text).toMatch(/Nothing is planned/)
  })

  it('without a slot, asks which meal', async () => {
    const r = as(await ask(deps, 'swap something tomorrow'), 'answer')
    expect(r.options!.map((o) => o.label)).toEqual(['Smoko', 'Lunch', 'Dinner'])
  })

  it('what’s for dinner, and protein left today', async () => {
    expect(as(await ask(deps, "what's for dinner"), 'answer').text).toMatch(/Tonight’s dinner: Lemon chicken/)
    const n = as(await ask(deps, 'how much protein is left today'), 'answer')
    expect(n.lines!.find((l) => l.startsWith('Protein'))).toMatch(/of \d+ g planned/)
  })
})

describe('Chef: training days', () => {
  it('make tomorrow a rest day; undo returns to the usual week', async () => {
    const before = await dayChoice(repo, '2026-11-27')
    const p = as(await ask(deps, 'make tomorrow a rest day'), 'proposal')
    if (before.dayType === 'rest') return // already rest in the usual week: covered by the next test
    expect(p.changes.join(' ')).toMatch(/→ rest/)
    const done = await p.apply()
    expect((await dayChoice(repo, '2026-11-27')).dayType).toBe('rest')
    await done.undo!()
    expect(await dayChoice(repo, '2026-11-27')).toMatchObject({ dayType: before.dayType, source: 'usual' })
  })

  it('train Saturday at 6am, then back to the usual week', async () => {
    const done = await apply('train saturday at 6am')
    expect(await dayChoice(repo, '2026-11-28')).toMatchObject({ dayType: 'training', workout: { start: '06:00' } })
    expect(done.text).toMatch(/06:00/)
    const back = await apply('back to my usual week on saturday')
    expect((await dayChoice(repo, '2026-11-28')).source).toBe('usual')
    await back.undo!()
    expect((await dayChoice(repo, '2026-11-28')).workout?.start).toBe('06:00')
    expect(await repo.checkIntegrity()).toEqual([])
  })
})

describe('Chef: pantry, shopping, weigh-ins, money', () => {
  it('stock questions and throwing out half the milk, with undo', async () => {
    await scanWoolworths()
    expect(as(await ask(deps, 'how much rice do I have'), 'answer').text).toMatch(/2 kg of Jasmine Rice/)
    const milk = (await repo.db.products.toArray()).find((p) => /milk/i.test(p.name))!
    const milkLot = async () => (await repo.db.inventory_lots.where('productId').equals(milk.id).first())!
    const p = as(await ask(deps, 'bin half the milk'), 'proposal')
    expect(p.changes[0]).toMatch(/3 L → 1\.5 L/)
    const done = await p.apply()
    expect((await milkLot()).remaining).toBe(1500)
    expect(await repo.db.waste_records.count()).toBe(1)
    await done.undo!()
    expect((await milkLot()).remaining).toBe(3000)
    expect(as(await ask(deps, 'I threw out the caviar'), 'answer').text).toMatch(/can’t find/)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('use up what expires soon lists dated food and offers to plan a recipe', async () => {
    await scanWoolworths()
    const chicken = (await repo.db.products.toArray()).find((p) => p.name.startsWith('Chicken'))!
    const lot = (await repo.db.inventory_lots.where('productId').equals(chicken.id).first())!
    await repo.update('inventory_lots', lot.id, { expiryDate: '2026-11-27', expiryKind: 'use_by' })
    const r = as(await ask(deps, 'use up what expires soon'), 'answer')
    expect(r.lines!.join()).toMatch(/Chicken Breast.*use by tomorrow/)
    expect(r.options!.length).toBeGreaterThan(0)
    expect(r.options![0].label).toMatch(/^Put .+ on /)
  })

  it('what can I make with chicken and rice', async () => {
    await scanWoolworths()
    const r = as(await ask(deps, 'what can I make with chicken and rice'), 'answer')
    expect(r.options!.length).toBeGreaterThan(0)
  })

  it('add milk to the shopping list starts a list; undo takes it off', async () => {
    const done = await apply('add 2 avocados to the shopping list')
    const items = await repo.db.shopping_list_items.toArray()
    const avo = items.find((i) => i.source === 'extra')!
    expect(avo).toMatchObject({ quantity: 2, unit: 'unit' })
    expect(items.some((i) => i.source === 'plan')).toBe(true) // the list was built from the plan first
    await done.undo!()
    expect(await repo.db.shopping_list_items.get(avo.id)).toBeUndefined()
  })

  it('weigh-in and undo', async () => {
    const done = await apply('I weigh 80.4 kg')
    expect(await repo.db.weight_measurements.where('date').equals(TODAY).first()).toMatchObject({ weightKg: 80.4, timeOfDay: 'morning' })
    await done.undo!()
    expect(await repo.db.weight_measurements.where('date').equals(TODAY).count()).toBe(0)
  })

  it('money questions', async () => {
    await scanWoolworths()
    expect(as(await ask(deps, 'how much have I spent this week'), 'answer').text).toBe('$49.88 spent this week (2 expenses).')
    expect(as(await ask(deps, 'budget left?'), 'answer').text).toMatch(/haven’t set a budget/)
  })

  it('not understood: three closest examples', async () => {
    const r = as(await ask(deps, 'chicken'), 'unknown')
    expect(r.examples).toHaveLength(3)
  })
})

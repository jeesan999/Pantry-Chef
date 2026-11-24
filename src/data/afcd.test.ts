import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error build-time script, plain JS
import { matchFood, parseWorkbook } from '../../scripts/import-afcd.mjs'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { seedIfEmpty } from '../db/seed'
import { fixedBreakfastNutrition } from '../engines/nutrition/service'
import { applyAfcd, type AfcdData, type AfcdMap, type AfcdRow } from './afcd'
import { INTERIM_FOODS } from './interimFoods'

let repo: Repo
let data: AfcdData
let map: AfcdMap

beforeEach(async () => {
  const db = openDb(`afcd-${newId()}`)
  await db.open()
  repo = new Repo(db)
  await seedIfEmpty(repo, '2026-11-24')
  const parsed = parseWorkbook(readFileSync('src/test/fixtures/afcd-synthetic.xlsx'))
  data = { release: 'test', importedAt: 'x', foods: parsed.foods as AfcdRow[] }
  map = {}
  for (const f of INTERIM_FOODS) {
    const hit = matchFood(f.afcdSearch, parsed.foods)[0]
    map[f.key] = hit ? { afcdKey: hit[0], afcdName: hit[1] } : null
  }
})

describe('AFCD import', () => {
  it('parses the nutrient sheet, skipping the notes sheet and title rows; "<1" reads as 0', () => {
    const parsed = parseWorkbook(readFileSync('src/test/fixtures/afcd-synthetic.xlsx'))
    expect(parsed.foods).toHaveLength(4)
    expect(parsed.foods[0]).toEqual(['F003688', 'Egg, chicken, whole, raw', 577, 12.4, 9.9, 2.9, 0.3, 0.3, 0, 0, 135])
    expect(parsed.foods[3][2]).toBe(1490) // text '1490' read as a number
    expect(parsed.foods[3][10]).toBe(0) // '<1' treated as trace
  })

  it('matches interim foods to the raw AFCD entry, not the boiled one', () => {
    expect(map.egg).toEqual({ afcdKey: 'F003688', afcdName: 'Egg, chicken, whole, raw' })
    expect(map.bacon_middle).toBeNull()
  })

  it('replaces matched interim foods in place and adds the rest; re-running duplicates nothing', async () => {
    const r1 = await applyAfcd(repo, data, map)
    expect(r1).toEqual({ replaced: 3, added: 1 }) // egg, avocado, rice; + boiled egg
    const egg = await repo.get('foods', 'food:egg')
    expect(egg).toMatchObject({ source: 'afcd', afcdKey: 'F003688' })
    expect(egg!.per100g.energyKcal).toBe(137.9) // 577 / 4.184
    const r2 = await applyAfcd(repo, data, map)
    expect(r2.added).toBe(0)
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('breakfast is recalculated from AFCD values but stays "approximate" while bacon is interim', async () => {
    await applyAfcd(repo, data, map)
    const n = await fixedBreakfastNutrition(repo)
    // eggs now 204 g x 12.4 g/100 g = 25.296 g protein (was 25.704)
    expect(n.total.proteinG).toBeCloseTo(25.296 + 0.85 * 1.8 + 7.65 + 0.01, 3)
    expect(n.approximate).toBe(true)
  })
})

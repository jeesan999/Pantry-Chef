import { describe, expect, it } from 'vitest'
import type { LotInfo, Need } from '../eating/engine'
import { checkAvailability, summaryText } from './engine'
import { SUBSTITUTE_GROUPS, substitutesFor } from '../../data/substitutes'
import { INTERIM_FOODS } from '../../data/interimFoods'

const lot = (id: string, foodId: string, remaining: number, extra: Partial<LotInfo> = {}): LotInfo => ({ id, productId: `p-${foodId}`, foodId, unit: 'g', remaining, unitCostCents: 1, ...extra })
const need = (label: string, foodId: string, grams: number | null, qty = grams ?? 1, unit: Need['unit'] = 'g'): Need => ({ label, foodId, grams, qty, unit })

describe('availability', () => {
  const needs = [need('Chicken breast', 'chicken', 200), need('White rice', 'rice', 100), need('Broccoli', 'broccoli', 100), need('Olive oil', 'oil', 10), need('Garlic', 'garlic', 12)]
  const lots = [lot('c', 'chicken', 500), lot('r', 'rice', 2000), lot('o', 'oil', 750), lot('g', 'garlic', 5)]

  it('marks each ingredient available, partial (with amounts) or missing', () => {
    const s = checkAvailability(needs, lots, '2026-11-26')
    expect(s.lines.map((l) => l.status)).toEqual(['available', 'available', 'missing', 'available', 'partial'])
    expect(s.lines[4]).toMatchObject({ have: { amount: 5, unit: 'g' }, short: { amount: 7, unit: 'g' } })
    expect(s).toMatchObject({ available: 3, partial: 1, missing: 1, allAvailable: false })
    expect(summaryText(s)).toBe('3 available · 1 partly available · 1 missing · shopping needed')
  })

  it('never changes the stock it reads', () => {
    const before = JSON.stringify(lots)
    checkAvailability(needs, lots, '2026-11-26')
    expect(JSON.stringify(lots)).toBe(before)
  })

  it('food past its use-by does not count; dated-soon stock is flagged', () => {
    const s = checkAvailability([need('Chicken', 'chicken', 200)], [lot('old', 'chicken', 500, { expiryDate: '2026-11-20', expiryKind: 'use_by' })], '2026-11-26')
    expect(s.lines[0].status).toBe('missing')
    const soon = checkAvailability([need('Chicken', 'chicken', 200)], [lot('s', 'chicken', 500, { expiryDate: '2026-11-27' })], '2026-11-26')
    expect(soon.lines[0].datedSoon).toBe(true)
  })

  it('items count by number; a repeated food shares the stock', () => {
    const eggs = lot('e', 'egg', 3, { unit: 'unit', gramsPerUnit: 50 })
    const s = checkAvailability([need('Eggs', 'egg', 100, 2, 'unit'), need('Egg wash', 'egg', 100, 2, 'unit')], [eggs], '2026-11-26')
    expect(s.lines.map((l) => l.status)).toEqual(['available', 'partial'])
    expect(s.allAvailable).toBe(false)
    expect(checkAvailability([], [], '2026-11-26')).toMatchObject({ allAvailable: true, coverage: 1 })
  })
})

describe('substitutes', () => {
  it('every food in the groups exists', () => {
    const keys = new Set(INTERIM_FOODS.map((f) => f.key))
    for (const [g, list] of Object.entries(SUBSTITUTE_GROUPS)) for (const k of list) expect(keys.has(k), `${g}: ${k}`).toBe(true)
  })
  it('offers foods from the same groups, not itself', () => {
    const s = substitutesFor('food:broccoli').map((x) => x.foodId)
    expect(s).toContain('food:green_beans')
    expect(s).not.toContain('food:broccoli')
    expect(substitutesFor('food:whey')).toEqual([])
  })
})

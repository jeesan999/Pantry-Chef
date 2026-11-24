import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../db/schema'
import { newId, Repo } from '../../db/repo'
import { seedIfEmpty, updateBreakfast } from '../../db/seed'
import { on } from '../../lib/events'
import { approveTargets, approvedTargets, changeGoal, fixedBreakfastNutrition, proposeTargets } from './service'
import { clearDayChoice, dayChoice, dayChoices, setDayType } from '../../lib/schedule'
import { resolveDay } from '../contract'

let repo: Repo
beforeEach(async () => {
  const db = openDb(`svc-${newId()}`)
  await db.open()
  repo = new Repo(db)
  await seedIfEmpty(repo, '2026-11-24')
})

describe('seed', () => {
  it('is idempotent and leaves a sound database', async () => {
    expect(await seedIfEmpty(repo, '2026-11-24')).toBe(false)
    expect(await repo.checkIntegrity()).toEqual([])
    expect(await repo.db.training_schedule.count()).toBe(4)
  })
})

describe('fixed breakfast (interim values)', () => {
  it('4 eggs (204 g) + ½ avocado (85 g) + 1 rasher (45 g) + 5 g ghee', async () => {
    const n = await fixedBreakfastNutrition(repo)
    // kcal: 281.52 + 169.15 + 102.6 + 44.95 = 598.22
    expect(n.total.energyKcal).toBeCloseTo(598.22, 2)
    // protein: 25.704 + 1.615 + 7.65 + 0.01 = 34.979
    expect(n.total.proteinG).toBeCloseTo(34.979, 3)
    // sat fat: 5.916 + 3.57 + 2.97 + 3.15 = 15.606
    expect(n.total.satFatG).toBeCloseTo(15.606, 3)
    expect(n.approximate).toBe(true)
    expect(n.missing).toEqual([])
  })

  it('editing quantities rewrites the recipe (3 eggs -> −69.0 kcal)', async () => {
    const before = (await fixedBreakfastNutrition(repo)).total.energyKcal
    await updateBreakfast(repo, { eggs: 3, avocadoHalves: 1, baconRashers: 1, gheeG: 5 })
    const after = (await fixedBreakfastNutrition(repo)).total.energyKcal
    expect(before - after).toBeCloseTo(1.38 * 51, 6) // one 51 g egg at 138 kcal/100 g
  })
})

describe('targets: propose -> approve -> version', () => {
  it('proposal has no version; approval gives v1 and fires targets-approved', async () => {
    const events: number[] = []
    const off = on('targets-approved', (e) => events.push(e.version))
    const { record, result } = await proposeTargets(repo, '2026-11-24')
    expect(record.status).toBe('proposed')
    expect(record.version).toBeNull()
    expect(result.maintenanceKcal).toBe(2690)
    expect(await approvedTargets(repo)).toBeUndefined()
    const a = await approveTargets(repo, record.id)
    expect(a.version).toBe(1)
    expect(a.targetSet.version).toBe(1)
    expect(events).toEqual([1])
    off()
  })

  it('goal change keeps history: old goal closed, new targets proposed, v2 supersedes v1', async () => {
    const p1 = await proposeTargets(repo, '2026-11-24')
    await approveTargets(repo, p1.record.id)
    const p2 = await changeGoal(repo, 'fat_loss', -15, '2026-11-24')
    expect(p2.result.dailyEnergyKcal).toBe(2290)
    // still on v1 until approved
    expect((await approvedTargets(repo))!.version).toBe(1)
    await approveTargets(repo, p2.record.id)
    const all = await repo.db.nutrition_targets.toArray()
    expect(all.map((r) => [r.status, r.version]).sort()).toEqual([['approved', 2], ['superseded', 1]])
    const goals = await repo.db.body_goals.toArray()
    expect(goals).toHaveLength(2)
    expect(goals.filter((g) => g.endDate)).toHaveLength(1)
  })

  it('a newer proposal withdraws the older open one, which can no longer be approved', async () => {
    const p1 = await proposeTargets(repo, '2026-11-24')
    await proposeTargets(repo, '2026-11-24')
    await expect(approveTargets(repo, p1.record.id)).rejects.toThrow(/only proposed/)
  })

  it('a weigh-in replaces the starting weight in the next proposal', async () => {
    await repo.insert('weight_measurements', { id: newId(), profileId: 'profile:me', date: '2026-11-24', weightKg: 79, timeOfDay: 'morning' })
    const { record } = await proposeTargets(repo, '2026-11-24')
    expect(record.inputs.weightKg).toBe(79)
  })
})

describe('training or rest, chosen per day', () => {
  it('usual week is the default: Mon/Tue/Thu/Fri training at 12:15, others rest', async () => {
    const week = await dayChoices(repo, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(week.map((d) => d.dayType)).toEqual(['training', 'training', 'rest', 'training', 'training', 'rest', 'rest'])
    expect(week[0].workout?.start).toBe('12:15')
    expect(week.every((d) => d.source === 'usual')).toBe(true)
  })

  it('a usual training day can be made a rest day, and a rest day a training day; clearing restores the usual', async () => {
    await setDayType(repo, '2026-11-23', 'rest') // Monday
    await setDayType(repo, '2026-11-29', 'training', '09:00') // Sunday
    expect(await dayChoice(repo, '2026-11-23')).toMatchObject({ dayType: 'rest', source: 'chosen' })
    expect(await dayChoice(repo, '2026-11-29')).toMatchObject({ dayType: 'training', source: 'chosen', workout: { start: '09:00' } })
    await setDayType(repo, '2026-11-23', 'training')
    expect((await dayChoice(repo, '2026-11-23')).dayType).toBe('training')
    expect(await repo.db.workouts.where('date').equals('2026-11-23').count()).toBe(1) // updated, not duplicated
    await clearDayChoice(repo, '2026-11-29')
    expect(await dayChoice(repo, '2026-11-29')).toMatchObject({ dayType: 'rest', source: 'usual' })
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('switching a day needs no re-approval: approved v1 already holds both day types', async () => {
    const p = await proposeTargets(repo, '2026-11-24')
    const a = await approveTargets(repo, p.record.id)
    await setDayType(repo, '2026-11-25', 'training')
    const c = await dayChoice(repo, '2026-11-25')
    const d = resolveDay(a.targetSet, c.date, c.dayType, c.workout)
    expect(d.dayType).toBe('training')
    expect(d.slots.smoko.digestibility).toBe('high')
    expect((await approvedTargets(repo))!.version).toBe(1)
  })

  it('approved targets: 2,690 kcal, 150 g carbs, fat fills the rest, no sat fat limit', async () => {
    const p = await proposeTargets(repo, '2026-11-24')
    const t = p.record.targetSet.templates.rest
    expect(t.energyKcal).toBe(2690)
    expect(t.carbsG).toBe(150)
    expect(t.satFatMaxG).toBeNull()
    // fat = (2690 − 138x4 − 150x4)/9 = 170.9 -> 171
    expect(t.fatG).toBe(171)
  })
})

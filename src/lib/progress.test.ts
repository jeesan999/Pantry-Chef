import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { PROFILE_ID, SETTINGS_ID, seedIfEmpty } from '../db/seed'
import { addDays } from '../engines/nutrition/engine'
import { approveTargets, approvedTargets, changeGoal, proposeTargets, rejectTargets } from '../engines/nutrition/service'
import { deleteWeight, loadProgress, proposeCalibration, setGoalTargets } from './progress'

const TODAY = '2026-11-26'
let repo: Repo

beforeEach(async () => {
  const db = openDb(`prog-${newId()}`)
  await db.open()
  repo = new Repo(db)
  await seedIfEmpty(repo, '2026-10-01')
})

/** Fat loss from 1 Oct, approved then; weigh-ins every day for the 28 days to today, changing by perWeek. */
async function fatLossWith(perWeek: number) {
  const { record } = await changeGoal(repo, 'fat_loss', -15, '2026-10-01')
  await approveTargets(repo, record.id)
  await repo.update('nutrition_targets', record.id, { approvedAt: '2026-10-01T08:00:00.000Z' })
  for (let i = 27; i >= 0; i--) {
    const d = 27 - i
    await repo.insert('weight_measurements', { id: newId(), profileId: PROFILE_ID, date: addDays(TODAY, -i), weightKg: Math.round((81 + (perWeek / 7) * d + (d % 2 ? 0.2 : -0.2)) * 100) / 100, timeOfDay: 'morning' })
  }
}

describe('targets service: proposals with a calibrated activity factor', () => {
  it('stores the override and note; approval makes it the setting; rejection leaves settings alone', async () => {
    const first = await proposeTargets(repo, TODAY)
    await approveTargets(repo, first.record.id)
    const before = (await repo.get('settings', SETTINGS_ID))!.activityFactor

    const r = await proposeTargets(repo, TODAY, { activityFactor: 1.45, note: 'calibrated' })
    expect(r.record).toMatchObject({ note: 'calibrated', inputs: { activityFactor: 1.45 } })
    expect(r.record.inputs.maintenanceKcal).toBeLessThan(first.record.inputs.maintenanceKcal)
    await rejectTargets(repo, r.record.id)
    expect((await repo.get('settings', SETTINGS_ID))!.activityFactor).toBe(before)

    const again = await proposeTargets(repo, TODAY, { activityFactor: 1.45 })
    await approveTargets(repo, again.record.id)
    expect((await repo.get('settings', SETTINGS_ID))!.activityFactor).toBe(1.45)
    // a plain recalculation now keeps the calibration
    expect((await proposeTargets(repo, TODAY)).record.inputs.activityFactor).toBe(1.45)
    expect(await repo.checkIntegrity()).toEqual([])
  })
})

describe('progress from real weigh-ins', () => {
  it('7-day average, weekly trend, monthly rows', async () => {
    await fatLossWith(-0.4)
    const p = await loadProgress(repo, TODAY)
    expect(p.latestAvg).toBeCloseTo(81 - (0.4 / 7) * 24, 0)
    expect(p.weekAgoAvg! - p.latestAvg!).toBeCloseTo(0.4, 0) // the zig-zag doesn't average out exactly over 7 days
    expect('kgPerWeek' in p.rate && p.rate.kgPerWeek).toBeCloseTo(-0.4, 1)
    expect(p.months.map((m) => m.month)).toEqual(['2026-11', '2026-10'])
    expect(p.lastWeighIn).toBe(TODAY)
  })

  it('a flat trend on a deficit suggests lower maintenance; approving it lowers calories, same goal %', async () => {
    await fatLossWith(0)
    const p = await loadProgress(repo, TODAY)
    expect(p.adjustment.kind).toBe('suggest')
    if (p.adjustment.kind !== 'suggest') return
    const before = (await approvedTargets(repo))!
    const id = await proposeCalibration(repo, TODAY, p.adjustment)
    const proposed = (await repo.get('nutrition_targets', id))!
    expect(proposed.note).toMatch(/assumes you ate to plan/)
    await expect(proposeCalibration(repo, TODAY, p.adjustment)).rejects.toThrow(/waiting/)
    await approveTargets(repo, id)
    const after = (await approvedTargets(repo))!
    expect(after.inputs.goalAdjustPct).toBe(before.inputs.goalAdjustPct)
    expect(after.targetSet.templates.rest.energyKcal).toBeLessThan(before.targetSet.templates.rest.energyKcal)
    expect(after.inputs.activityFactor).toBe(p.adjustment.newActivityFactor)
    // straight after approval the trend is judged afresh: no new suggestion yet
    expect((await loadProgress(repo, TODAY)).adjustment).toMatchObject({ kind: 'none', why: expect.stringMatching(/2 weeks/) })
    expect(await repo.checkIntegrity()).toEqual([])
  })

  it('on track: no suggestion', async () => {
    await fatLossWith(-0.36)
    expect((await loadProgress(repo, TODAY)).adjustment).toMatchObject({ kind: 'none', why: expect.stringMatching(/matches/) })
  })

  it('goal target weight gives progress and a finish date; targets can be cleared', async () => {
    await fatLossWith(-0.5)
    await setGoalTargets(repo, { targetWeightKg: 76, targetWaistCm: 85 })
    const p = await loadProgress(repo, TODAY)
    expect(p.goal).toMatchObject({ targetWeightKg: 76, targetWaistCm: 85 })
    expect(p.progress).toMatchObject({ direction: 'down', reached: false })
    expect(p.progress!.eta! > TODAY).toBe(true)
    await setGoalTargets(repo, { targetWeightKg: null })
    expect((await loadProgress(repo, TODAY)).progress).toBeNull()
    await expect(setGoalTargets(repo, { targetWeightKg: 10 })).rejects.toThrow()
  })

  it('deleting a weigh-in', async () => {
    await fatLossWith(0)
    const w = (await repo.db.weight_measurements.toArray())[0]
    await deleteWeight(repo, w.id)
    expect(await repo.db.weight_measurements.count()).toBe(27)
  })
})

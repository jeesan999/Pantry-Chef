/** Database side of Progress: loads measurements and targets for the progress engine, sets goal targets, proposes calibrations. */
import { IntegrityError, type Repo } from '../db/repo'
import { PROFILE_ID, SETTINGS_ID } from '../db/seed'
import type { BodyGoal, WaistMeasurement, WeightMeasurement } from '../db/types'
import { CONTRACT_VERSION } from '../engines/contract'
import { activeGoal, approvedTargets, proposeTargets } from '../engines/nutrition/service'
import { loggedDays } from './eating'
import {
  dailyWeights,
  goalProgress,
  goalStartKg,
  hasRate,
  monthlySummary,
  rollingAverage,
  suggestAdjustment,
  weeklyRate,
  type Adjustment,
  type AdjustmentResult,
  type DayValue,
  type GoalProgress,
  type MonthRow,
  type RateResult,
} from '../engines/progress/engine'

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)

export interface ProgressData {
  weights: WeightMeasurement[]
  waists: WaistMeasurement[]
  daily: Array<DayValue & { avg: number | null }>
  latestAvg: number | null // latest 7-day average
  weekAgoAvg: number | null // the 7-day average about a week before that
  latestKg: number | null
  rate: RateResult
  months: MonthRow[]
  goal: BodyGoal
  progress: GoalProgress | null
  adjustment: AdjustmentResult
  lastWeighIn: string | null
}

export async function loadProgress(repo: Repo, today: string): Promise<ProgressData> {
  const [weights, waists, goal, approved, profile, settings] = await Promise.all([
    repo.db.weight_measurements.where('profileId').equals(PROFILE_ID).toArray(),
    repo.db.waist_measurements.where('profileId').equals(PROFILE_ID).toArray(),
    activeGoal(repo),
    approvedTargets(repo),
    repo.get('profile', PROFILE_ID),
    repo.get('settings', SETTINGS_ID),
  ])
  weights.sort((a, b) => a.date.localeCompare(b.date))
  waists.sort((a, b) => a.date.localeCompare(b.date))
  const daily = rollingAverage(dailyWeights(weights))
  const withAvg = daily.filter((d) => d.avg !== null)
  const latest = withAvg[withAvg.length - 1]
  const weekAgo = latest ? [...withAvg].reverse().find((d) => dayNum(d.date) <= dayNum(latest.date) - 7) : undefined
  const rate = weeklyRate(daily, { asOf: today })
  const currentKg = latest?.avg ?? daily[daily.length - 1]?.kg ?? null

  let progress: GoalProgress | null = null
  if (goal.targetWeightKg && currentKg !== null) {
    progress = goalProgress({
      startKg: goalStartKg(goal, daily, profile?.startingWeightKg ?? currentKg),
      currentKg,
      targetKg: goal.targetWeightKg,
      kgPerWeek: hasRate(rate) ? rate.kgPerWeek : null,
      asOf: today,
    })
  }

  let adjustment: AdjustmentResult = { kind: 'none', why: 'Approve your targets first.' }
  if (approved && approved.targetSet.contractVersion === CONTRACT_VERSION) {
    const t = approved.targetSet.templates
    const nTrain = settings?.trainingDaysPerWeek ?? 4
    const targetKcal = (t.training.energyKcal * nTrain + t.rest.energyKcal * (7 - nTrain)) / 7
    // the trend is judged from whichever came later: the goal change or the last approval
    const since = [goal.startDate, approved.approvedAt?.slice(0, 10) ?? goal.startDate].sort().pop()!
    const days = hasRate(rate) ? await loggedDays(repo, rate.from, rate.to) : []
    adjustment = suggestAdjustment({
      rate,
      intake: days.length ? { avgKcal: days.reduce((s, d) => s + d.kcal, 0) / days.length, days: days.length } : undefined,
      targetKcal,
      maintenanceKcal: approved.inputs.maintenanceKcal,
      bmrKcal: approved.inputs.bmrKcal,
      activityFactor: approved.inputs.activityFactor,
      daysSinceGoalChange: dayNum(today) - dayNum(since),
    })
  }

  return {
    weights,
    waists,
    daily,
    latestAvg: latest?.avg ?? null,
    weekAgoAvg: weekAgo?.avg ?? null,
    latestKg: daily[daily.length - 1]?.kg ?? null,
    rate,
    months: monthlySummary(daily, waists),
    goal,
    progress,
    adjustment,
    lastWeighIn: weights[weights.length - 1]?.date ?? null,
  }
}

/** Set or clear the active goal's target weight and waist. */
export async function setGoalTargets(repo: Repo, t: { targetWeightKg?: number | null; targetWaistCm?: number | null }): Promise<void> {
  const goal = await activeGoal(repo)
  const patch: Partial<BodyGoal> = {}
  if (t.targetWeightKg !== undefined) patch.targetWeightKg = t.targetWeightKg ?? undefined
  if (t.targetWaistCm !== undefined) patch.targetWaistCm = t.targetWaistCm ?? undefined
  await repo.update('body_goals', goal.id, patch)
}

/** Turn a calibration suggestion into a proposal on the Goals screen; nothing changes until it is approved. */
export async function proposeCalibration(repo: Repo, today: string, adj: Adjustment): Promise<string> {
  if (await repo.db.nutrition_targets.where('status').equals('proposed').count()) {
    throw new IntegrityError('Another proposal is waiting on the Goals screen. Approve or reject it first.')
  }
  const { record } = await proposeTargets(repo, today, { activityFactor: adj.newActivityFactor, note: adj.reason })
  return record.id
}

export const deleteWeight = (repo: Repo, id: string) => repo.remove('weight_measurements', id)
export const deleteWaist = (repo: Repo, id: string) => repo.remove('waist_measurements', id)

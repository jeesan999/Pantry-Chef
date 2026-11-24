/**
 * Glue between the database and Engine A. Reads the inputs, runs the pure engine, and
 * stores the result as PROPOSED. Only approval assigns a version number and tells the
 * Meal Planning Engine (via the targets-approved event).
 */
import { FIXED_BREAKFAST_ID, PROFILE_ID, SETTINGS_ID } from '../../db/seed'
import { IntegrityError, newId, nowIso, type Repo } from '../../db/repo'
import type { NutritionTargetRecord } from '../../db/types'
import { emit } from '../../lib/events'
import { recipeNutrition } from '../../lib/nutrition'
import { computeTargets, mondayOf, type EngineResult, type NutritionInputs } from './engine'

export async function currentWeightKg(repo: Repo): Promise<{ kg: number; fromWeighIn: boolean }> {
  const latest = await repo.db.weight_measurements.orderBy('date').last()
  if (latest) return { kg: latest.weightKg, fromWeighIn: true }
  const profile = await repo.get('profile', PROFILE_ID)
  return { kg: profile!.startingWeightKg, fromWeighIn: false }
}

export async function fixedBreakfastNutrition(repo: Repo) {
  const recipe = await repo.get('recipes', FIXED_BREAKFAST_ID)
  if (!recipe) throw new IntegrityError('fixed breakfast recipe is missing')
  const ings = await repo.db.recipe_ingredients.where('recipeId').equals(FIXED_BREAKFAST_ID).toArray()
  const foods = await repo.db.foods.bulkGet(ings.map((i) => i.foodId!))
  const map = new Map(foods.filter(Boolean).map((f) => [f!.id, f!]))
  return recipeNutrition(ings, map, recipe.servings, await repo.db.cooking_yields.toArray())
}

export async function activeGoal(repo: Repo) {
  const goals = await repo.db.body_goals.where('profileId').equals(PROFILE_ID).toArray()
  const open = goals.filter((g) => !g.endDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (!open[0]) throw new IntegrityError('no active goal')
  return open[0]
}

export async function buildInputs(repo: Repo, weekStart: string): Promise<NutritionInputs> {
  const profile = (await repo.get('profile', PROFILE_ID))!
  const settings = (await repo.get('settings', SETTINGS_ID))!
  const goal = await activeGoal(repo)
  const { kg } = await currentWeightKg(repo)
  const bf = (await fixedBreakfastNutrition(repo)).total
  const schedule = (await repo.db.training_schedule.toArray()).filter((s) => s.active)
  return {
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: profile.heightCm,
    weightKg: kg,
    activityFactor: settings.activityFactor,
    goal: goal.type,
    goalAdjustPct: goal.energyAdjustPct,
    proteinMinG: settings.proteinMinG,
    proteinMaxGPerKg: settings.proteinMaxGPerKg,
    fatPctEnergy: settings.fatPctEnergy,
    satFatPctEnergy: settings.satFatPctEnergy,
    fibreMinG: settings.fibreMinG,
    addedSugarPctEnergy: settings.addedSugarPctEnergy,
    restDayCarbReductionPct: settings.restDayCarbReductionPct,
    slotProtein: settings.slotProtein,
    slotCarbShare: settings.slotCarbShare,
    mealTimes: profile.mealTimes,
    schedule: schedule.map((s) => ({ weekday: s.weekday, type: s.type, start: s.start, durationMin: s.durationMin, intensity: s.intensity })),
    breakfast: { energyKcal: bf.energyKcal, proteinG: bf.proteinG, carbsG: bf.carbsG, fatG: bf.fatG, satFatG: bf.satFatG },
    fixedBreakfastRecipeId: FIXED_BREAKFAST_ID,
    weekStart: mondayOf(weekStart),
  }
}

/** Calculate targets and store them as a proposal. Any earlier open proposal is withdrawn. */
export async function proposeTargets(repo: Repo, date: string): Promise<{ record: NutritionTargetRecord; result: EngineResult }> {
  const inputs = await buildInputs(repo, date)
  const result = computeTargets(inputs)
  const goal = await activeGoal(repo)
  const record: NutritionTargetRecord = {
    id: newId(),
    bodyGoalId: goal.id,
    status: 'proposed',
    version: null,
    weekStart: inputs.weekStart,
    inputs: {
      weightKg: inputs.weightKg,
      ageYears: result.ageYears,
      heightCm: inputs.heightCm,
      sex: inputs.sex,
      activityFactor: inputs.activityFactor,
      bmrKcal: result.bmrKcal,
      maintenanceKcal: result.maintenanceKcal,
      goalAdjustPct: result.goalAdjustPct,
    },
    targetSet: result.targetSet,
    createdAt: nowIso(),
  }
  await repo.tx(async () => {
    const open = await repo.db.nutrition_targets.where('status').equals('proposed').toArray()
    for (const o of open) await repo.update('nutrition_targets', o.id, { status: 'rejected' })
    await repo.insert('nutrition_targets', record)
  })
  return { record, result }
}

export async function approveTargets(repo: Repo, id: string): Promise<NutritionTargetRecord> {
  const approved = await repo.tx(async () => {
    const rec = await repo.get('nutrition_targets', id)
    if (!rec) throw new IntegrityError('targets not found')
    if (rec.status !== 'proposed') throw new IntegrityError(`only proposed targets can be approved (this is ${rec.status})`)
    const all = await repo.db.nutrition_targets.toArray()
    const version = Math.max(0, ...all.map((r) => r.version ?? 0)) + 1
    for (const r of all.filter((r) => r.status === 'approved')) {
      await repo.update('nutrition_targets', r.id, { status: 'superseded' })
    }
    return repo.update('nutrition_targets', id, {
      status: 'approved',
      version,
      approvedAt: nowIso(),
      targetSet: { ...rec.targetSet, version },
    })
  })
  emit('targets-approved', { targetsId: approved.id, version: approved.version! })
  return approved
}

export async function rejectTargets(repo: Repo, id: string): Promise<void> {
  await repo.update('nutrition_targets', id, { status: 'rejected' })
}

export async function approvedTargets(repo: Repo): Promise<NutritionTargetRecord | undefined> {
  return (await repo.db.nutrition_targets.where('status').equals('approved').toArray())[0]
}

/** Change goal: the old goal is closed (kept as history), the new one opened, targets re-proposed. */
export async function changeGoal(repo: Repo, type: NutritionTargetRecord['targetSet']['goal'], energyAdjustPct: number, today: string) {
  await repo.tx(async () => {
    const old = await activeGoal(repo)
    await repo.update('body_goals', old.id, { endDate: today })
    await repo.insert('body_goals', { id: newId(), profileId: PROFILE_ID, type, energyAdjustPct, startDate: today, createdAt: nowIso() })
  })
  return proposeTargets(repo, today)
}

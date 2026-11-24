/**
 * Engine A: the Nutrition Engine. Pure functions only: no database, no clock, no
 * imports from the Meal Planning Engine. Its one output is a TargetSet (see contract.ts).
 */
import {
  CONTRACT_VERSION,
  SLOTS,
  type DayTargets,
  type GoalType,
  type SlotName,
  type SlotTargets,
  type TargetSet,
  type WorkoutType,
} from '../contract'

export interface ScheduleDay {
  weekday: number // 0 = Monday
  type: WorkoutType
  start: string
  durationMin: number
  intensity: 1 | 2 | 3
}

export interface MacroSlice {
  energyKcal: number
  proteinG: number
  carbsG: number
  fatG: number
  satFatG: number
}

export interface NutritionInputs {
  sex: 'male' | 'female'
  birthDate: string
  heightCm: number
  weightKg: number
  activityFactor: number
  goal: GoalType
  goalAdjustPct?: number
  proteinMinG: number
  proteinMaxGPerKg: number
  fatPctEnergy: number
  satFatPctEnergy: number
  fibreMinG: number
  addedSugarPctEnergy: number
  restDayCarbReductionPct: number
  slotProtein: Record<SlotName, { min: number; preferred: number; max: number }>
  slotCarbShare: { smoko: number; lunch: number; dinner: number }
  mealTimes: Record<SlotName, string>
  schedule: ScheduleDay[]
  breakfast: MacroSlice // the fixed breakfast, calculated from food data
  fixedBreakfastRecipeId?: string
  weekStart: string // a Monday, YYYY-MM-DD
}

export interface EngineResult {
  targetSet: TargetSet
  ageYears: number
  bmrKcal: number
  maintenanceKcal: number
  goalAdjustPct: number
  dailyEnergyKcal: number
  warnings: string[]
}

export const ACTIVITY_LEVELS = [
  { factor: 1.375, label: 'Light', detail: 'training 2–3 days, mostly seated work' },
  { factor: 1.55, label: 'Moderate', detail: 'training 3–5 days' },
  { factor: 1.725, label: 'High', detail: 'training 6–7 days or physical job' },
] as const

/** Energy adjustment per goal, as % of maintenance. min/max are the allowed range. */
export const GOAL_RULES: Record<GoalType, { label: string; defaultPct: number; minPct: number; maxPct: number }> = {
  maintenance: { label: 'Maintenance', defaultPct: 0, minPct: 0, maxPct: 0 },
  recomp: { label: 'Body recomposition', defaultPct: -5, minPct: -10, maxPct: 0 },
  fat_loss: { label: 'Fat loss / muscle preservation', defaultPct: -15, minPct: -20, maxPct: -10 },
  weight_loss: { label: 'Weight loss', defaultPct: -20, minPct: -20, maxPct: -15 },
  muscle_gain: { label: 'Muscle gain', defaultPct: 5, minPct: 5, maxPct: 10 },
  weight_gain: { label: 'Weight gain', defaultPct: 10, minPct: 10, maxPct: 15 },
}

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

export const round10 = (n: number) => Math.round(n / 10) * 10

export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = onDate.split('-').map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age
}

/** Mifflin–St Jeor resting energy, kcal/day. */
export function bmrMifflin(sex: 'male' | 'female', weightKg: number, heightCm: number, ageYears: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161)
}

export function maintenanceKcal(bmr: number, activityFactor: number): number {
  return round10(bmr * activityFactor)
}

export function clampGoalAdjust(goal: GoalType, pct?: number): number {
  const r = GOAL_RULES[goal]
  const v = pct ?? r.defaultPct
  return Math.min(r.maxPct, Math.max(r.minPct, v))
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing date. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  return addDays(date, -dow)
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function computeTargets(inp: NutritionInputs): EngineResult {
  const warnings: string[] = []
  const ageYears = ageOn(inp.birthDate, inp.weekStart)
  const bmr = bmrMifflin(inp.sex, inp.weightKg, inp.heightCm, ageYears)
  const maintenance = maintenanceKcal(bmr, inp.activityFactor)
  const adjust = clampGoalAdjust(inp.goal, inp.goalAdjustPct)
  if (inp.goalAdjustPct !== undefined && adjust !== inp.goalAdjustPct) {
    warnings.push(`Energy adjustment ${inp.goalAdjustPct}% is outside the allowed range for this goal; using ${adjust}%.`)
  }
  const energy = round10(maintenance * (1 + adjust / 100))

  // Protein: the floor is fixed; the planner aims for the sum of the slots' preferred amounts.
  const proteinMax = Math.round(inp.proteinMaxGPerKg * inp.weightKg)
  const slotMinSum = SLOTS.reduce((s, k) => s + inp.slotProtein[k].min, 0)
  const slotPrefSum = SLOTS.reduce((s, k) => s + inp.slotProtein[k].preferred, 0)
  const proteinPreferred = Math.min(proteinMax, Math.max(inp.proteinMinG, slotPrefSum))
  if (slotMinSum < inp.proteinMinG) {
    warnings.push(
      `Slot protein minimums add up to ${slotMinSum} g, below the ${inp.proteinMinG} g floor; the planner aims for ${proteinPreferred} g.`,
    )
  }

  const fatG = Math.round((energy * inp.fatPctEnergy) / 100 / KCAL_PER_G.fat)
  const satFatMaxG = Math.round((energy * inp.satFatPctEnergy) / 100 / KCAL_PER_G.fat)
  const addedSugarMaxG = Math.round((energy * inp.addedSugarPctEnergy) / 100 / KCAL_PER_G.carbs)
  const baseCarbs = (energy - proteinPreferred * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs
  if (baseCarbs < 50) warnings.push('Carbohydrate is very low at this energy target; check protein and fat settings.')

  if (inp.breakfast.satFatG >= satFatMaxG / 2) {
    warnings.push(
      `The fixed breakfast has ${r1(inp.breakfast.satFatG)} g saturated fat, half or more of the ${satFatMaxG} g daily limit; later meals lean on unsaturated fats.`,
    )
  }

  if (inp.breakfast.fatG > fatG * 0.5) {
    const leftFat = Math.max(0, fatG - inp.breakfast.fatG)
    warnings.push(
      `The fixed breakfast has ${Math.round(inp.breakfast.fatG)} g of the ${fatG} g daily fat but only ${Math.round(inp.breakfast.carbsG)} g carbohydrate, so the other three meals share just ${Math.round(leftFat)} g fat and about ${Math.round(baseCarbs - inp.breakfast.carbsG)} g carbohydrate. Dinner cannot be truly low-carb at this energy level unless fat % or protein rises, or breakfast changes.`,
    )
  }

  // Carbs move from rest days to training days; the weekly total stays the same.
  const trainingDays = new Set(inp.schedule.map((s) => s.weekday))
  const nTrain = trainingDays.size
  const nRest = 7 - nTrain
  const r = inp.restDayCarbReductionPct / 100
  const restCarbs = nTrain > 0 && nRest > 0 ? baseCarbs * (1 - r) : baseCarbs
  const trainCarbs = nTrain > 0 && nRest > 0 ? baseCarbs * (1 + (r * nRest) / nTrain) : baseCarbs

  const shareSum = inp.slotCarbShare.smoko + inp.slotCarbShare.lunch + inp.slotCarbShare.dinner
  const days: DayTargets[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(inp.weekStart, i)
    const session = inp.schedule.find((s) => s.weekday === i)
    const carbsG = Math.round(session ? trainCarbs : restCarbs)
    const energyKcal = Math.round(proteinPreferred * 4 + fatG * 9 + carbsG * 4)
    const carbsAfterBreakfast = Math.max(0, carbsG - inp.breakfast.carbsG)

    const slots = {} as Record<SlotName, SlotTargets>
    for (const slot of SLOTS) {
      const p = inp.slotProtein[slot]
      if (slot === 'breakfast') {
        const bp = Math.round(inp.breakfast.proteinG)
        const bc = Math.round(inp.breakfast.carbsG)
        slots.breakfast = {
          time: inp.mealTimes.breakfast,
          proteinG: [bp, bp],
          carbLevel: 'low',
          carbsG: [bc, bc],
          fixedRecipeId: inp.fixedBreakfastRecipeId,
        }
        continue
      }
      const mid = (carbsAfterBreakfast * inp.slotCarbShare[slot]) / shareSum
      slots[slot] = {
        time: inp.mealTimes[slot],
        proteinG: [p.min, p.max],
        carbLevel: slot === 'smoko' ? 'low-moderate' : slot === 'lunch' ? 'highest' : 'lowest',
        carbsG: [Math.round(mid * 0.85), Math.round(mid * 1.15)],
      }
    }
    if (session) {
      const gap = toMin(session.start) - toMin(inp.mealTimes.smoko)
      if (gap >= 0 && gap <= 120) slots.smoko.digestibility = 'high'
    }

    days.push({
      date,
      dayType: session ? 'training' : 'rest',
      workout: session
        ? { start: session.start, durationMin: session.durationMin, type: session.type, intensity: session.intensity }
        : undefined,
      energyKcal,
      proteinG: { min: inp.proteinMinG, preferred: proteinPreferred },
      carbsG,
      fatG,
      satFatMaxG,
      fibreMinG: inp.fibreMinG,
      addedSugarMaxG,
      slots,
    })
  }

  return {
    targetSet: { contractVersion: CONTRACT_VERSION, version: 0, goal: inp.goal, days },
    ageYears,
    bmrKcal: bmr,
    maintenanceKcal: maintenance,
    goalAdjustPct: adjust,
    dailyEnergyKcal: energy,
    warnings,
  }
}

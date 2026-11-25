/**
 * The versioned contract between Engine A (Nutrition) and Engine B (Meal Planning).
 * Engine B receives nothing from Engine A except a TargetSet. Neither engine imports
 * the other's code; both import only this file.
 *
 * v2 (24 Nov 2026): targets are approved per DAY TYPE (training / rest), and the day type of
 * each date is chosen by the user, not fixed by the week. Slots carry a fat range. The
 * saturated fat limit is optional (null = no limit).
 */

export const CONTRACT_VERSION = 2

export type GoalType =
  | 'maintenance'
  | 'recomp'
  | 'fat_loss'
  | 'weight_loss'
  | 'muscle_gain'
  | 'weight_gain'

export type WorkoutType = 'strength' | 'cardio' | 'hiit' | 'sport' | 'mobility' | 'other'

export type SlotName = 'breakfast' | 'smoko' | 'lunch' | 'dinner'
export const SLOTS: readonly SlotName[] = ['breakfast', 'smoko', 'lunch', 'dinner'] as const

export type CarbLevel = 'low' | 'low-moderate' | 'highest' | 'lowest'
export type DayType = 'training' | 'rest'

export interface SlotTargets {
  time: string // HH:MM
  proteinG: [number, number]
  carbLevel: CarbLevel
  carbsG: [number, number]
  fatG: [number, number]
  digestibility?: 'high' // set when training starts soon after smoko
  fixedRecipeId?: string // breakfast
}

export interface WorkoutInfo {
  start: string
  durationMin: number
  type: WorkoutType
  intensity: 1 | 2 | 3
}

/** Targets for one kind of day, independent of date. */
export interface DayTemplate {
  energyKcal: number
  proteinG: { min: number; preferred: number }
  carbsG: number
  carbsMinG: number | null // a floor the day must reach (fixed-carb mode); null = none
  fatG: number
  satFatMaxG: number | null // null = no limit set
  fibreMinG: number
  addedSugarMaxG: number
  slots: Record<SlotName, SlotTargets>
}

export interface DayTargets extends DayTemplate {
  date: string // YYYY-MM-DD
  dayType: DayType
  workout?: WorkoutInfo
}

export interface TargetSet {
  contractVersion: typeof CONTRACT_VERSION
  version: number // increments on every approved change
  goal: GoalType
  templates: Record<DayType, DayTemplate>
  days: DayTargets[] // 7 entries for the week it was proposed in (resolved with that week's day types)
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Targets for a date, given the day type the user chose for it. */
export function resolveDay(ts: TargetSet, date: string, dayType: DayType, workout?: WorkoutInfo): DayTargets {
  const t = ts.templates[dayType]
  const slots = { ...t.slots, smoko: { ...t.slots.smoko } }
  delete slots.smoko.digestibility
  if (dayType === 'training' && workout) {
    const gap = toMin(workout.start) - toMin(slots.smoko.time)
    if (gap >= 0 && gap <= 120) slots.smoko.digestibility = 'high'
  }
  return { ...t, slots, date, dayType, workout: dayType === 'training' ? workout : undefined }
}

/** Engine B's entry point, in general form. Implemented by planWeek in engines/planner/engine.ts (Phase 8). */
export type PlanWeek<Inventory, Recipe, Preferences, MealPlan> = (
  targets: TargetSet,
  dayTypes: Record<string, { dayType: DayType; workout?: WorkoutInfo }>,
  inventory: Inventory,
  recipes: Recipe[],
  prefs: Preferences,
) => MealPlan

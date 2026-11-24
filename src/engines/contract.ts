/**
 * The versioned contract between Engine A (Nutrition) and Engine B (Meal Planning).
 * Engine B receives nothing from Engine A except a TargetSet. Neither engine imports
 * the other's code; both import only this file.
 */

export const CONTRACT_VERSION = 1

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

export interface SlotTargets {
  time: string // HH:MM
  proteinG: [number, number]
  carbLevel: CarbLevel
  carbsG: [number, number]
  digestibility?: 'high' // set when training starts soon after smoko
  fixedRecipeId?: string // breakfast
}

export interface DayTargets {
  date: string // YYYY-MM-DD
  dayType: 'training' | 'rest' | 'recovery'
  workout?: { start: string; durationMin: number; type: WorkoutType; intensity: 1 | 2 | 3 }
  energyKcal: number
  proteinG: { min: number; preferred: number }
  carbsG: number
  fatG: number
  satFatMaxG: number
  fibreMinG: number
  addedSugarMaxG: number
  slots: Record<SlotName, SlotTargets>
}

export interface TargetSet {
  contractVersion: typeof CONTRACT_VERSION
  version: number // increments on every approved change
  goal: GoalType
  days: DayTargets[] // 7 entries, one per date
}

/** Engine B's entry point (implemented in Phase 5). */
export type PlanWeek<Inventory, Recipe, Preferences, MealPlan> = (
  targets: TargetSet,
  inventory: Inventory,
  recipes: Recipe[],
  prefs: Preferences,
) => MealPlan

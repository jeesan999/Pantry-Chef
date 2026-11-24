import { resolveDay, type DayTargets, type SlotName, type TargetSet } from '../engines/contract'
import type { DayChoice } from './schedule'
import type { SlotTag } from '../db/types'
import { newId, nowIso, type Repo } from '../db/repo'
import { addDays, mondayOf } from '../engines/nutrition/engine'

export const SLOT_LABEL: Record<SlotName, string> = { breakfast: 'Breakfast', smoko: 'Smoko', lunch: 'Lunch', dinner: 'Dinner' }

/** Recipe tags that suit each slot. */
export const SLOT_TAGS: Record<SlotName, SlotTag[]> = {
  breakfast: ['breakfast'],
  smoko: ['smoko', 'pre-workout'],
  lunch: ['lunch', 'post-workout'],
  dinner: ['dinner', 'low-carb-dinner'],
}

/** Targets for a date, using the training/rest choice for that date. */
export function targetsForDate(ts: TargetSet, choice: DayChoice): DayTargets {
  return resolveDay(ts, choice.date, choice.dayType, choice.workout)
}

export const weekDates = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(date), i))

/** Put a recipe in a slot on a date, creating that week's plan (tied to the approved targets) if needed. */
export async function assignMeal(
  repo: Repo,
  args: { date: string; slot: SlotName; time: string; recipeId: string; portionScale: number; targetsId: string; targetsVersion: number },
): Promise<void> {
  await repo.tx(async () => {
    const weekStart = mondayOf(args.date)
    let plan = await repo.db.meal_plans.where('weekStart').equals(weekStart).first()
    if (!plan) {
      plan = { id: newId(), weekStart, targetsId: args.targetsId, targetsVersion: args.targetsVersion, createdAt: nowIso() }
      await repo.insert('meal_plans', plan)
    }
    const existing = await repo.db.planned_meals.where('[date+slot]').equals([args.date, args.slot]).first()
    if (existing) {
      const eaten = await repo.db.meal_consumption.where('plannedMealId').equals(existing.id).filter((c) => !c.undone).count()
      if (eaten) throw new Error('This meal is already marked eaten; undo that first.')
      await repo.update('planned_meals', existing.id, { recipeId: args.recipeId, portionScale: args.portionScale, time: args.time })
    } else {
      await repo.insert('planned_meals', {
        id: newId(),
        mealPlanId: plan.id,
        date: args.date,
        slot: args.slot,
        time: args.time,
        recipeId: args.recipeId,
        portionScale: args.portionScale,
      })
    }
  })
}

export async function clearMeal(repo: Repo, date: string, slot: SlotName): Promise<void> {
  const existing = await repo.db.planned_meals.where('[date+slot]').equals([date, slot]).first()
  if (existing) await repo.remove('planned_meals', existing.id)
}

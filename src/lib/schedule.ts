/**
 * Training or rest, per date. The user's choice for a date (a row in workouts) wins; with no
 * choice, the "usual week" in Settings is the default.
 *   workouts.status planned | completed -> training (with its time)
 *   workouts.status skipped              -> rest
 */
import { newId, type Repo } from '../db/repo'
import { SETTINGS_ID } from '../db/seed'
import type { DayType, WorkoutInfo } from '../engines/contract'

export interface DayChoice {
  date: string
  dayType: DayType
  workout?: WorkoutInfo
  source: 'chosen' | 'usual'
}

const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

export async function dayChoices(repo: Repo, dates: string[]): Promise<DayChoice[]> {
  const [workouts, schedule] = await Promise.all([
    repo.db.workouts.where('date').anyOf(dates).toArray(),
    repo.db.training_schedule.toArray(),
  ])
  return dates.map((date) => {
    const w = workouts.find((x) => x.date === date)
    if (w) {
      return w.status === 'skipped'
        ? { date, dayType: 'rest', source: 'chosen' }
        : { date, dayType: 'training', source: 'chosen', workout: { start: w.start, durationMin: w.durationMin, type: w.type, intensity: w.intensity } }
    }
    const s = schedule.find((x) => x.active && x.weekday === weekdayOf(date))
    return s
      ? { date, dayType: 'training', source: 'usual', workout: { start: s.start, durationMin: s.durationMin, type: s.type, intensity: s.intensity } }
      : { date, dayType: 'rest', source: 'usual' }
  })
}

export async function dayChoice(repo: Repo, date: string): Promise<DayChoice> {
  return (await dayChoices(repo, [date]))[0]
}

/** Make a date a training day or a rest day. Does not touch targets: they are approved per day type. */
export async function setDayType(repo: Repo, date: string, dayType: DayType, start?: string): Promise<void> {
  await repo.tx(async () => {
    const existing = await repo.db.workouts.where('date').equals(date).first()
    const settings = await repo.get('settings', SETTINGS_ID)
    const usual = (await repo.db.training_schedule.toArray()).find((s) => s.active && s.weekday === weekdayOf(date))
    const def = settings?.defaultWorkout ?? { start: '12:15', durationMin: 60, type: 'strength' as const }
    if (existing) {
      if (existing.status === 'completed' && dayType === 'rest') throw new Error('This workout is marked completed.')
      await repo.update('workouts', existing.id, {
        status: dayType === 'training' ? (existing.status === 'completed' ? 'completed' : 'planned') : 'skipped',
        ...(start ? { start } : {}),
      })
      return
    }
    await repo.insert('workouts', {
      id: newId(),
      scheduleId: usual?.id,
      date,
      type: usual?.type ?? def.type,
      start: start ?? usual?.start ?? def.start,
      durationMin: usual?.durationMin ?? def.durationMin,
      intensity: usual?.intensity ?? 2,
      status: dayType === 'training' ? 'planned' : 'skipped',
    })
  })
}

/** Forget the choice for a date, so it follows the usual week again. */
export async function clearDayChoice(repo: Repo, date: string): Promise<void> {
  const w = await repo.db.workouts.where('date').equals(date).first()
  if (w && w.status !== 'completed') await repo.remove('workouts', w.id)
}

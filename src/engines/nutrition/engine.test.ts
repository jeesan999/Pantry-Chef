import { describe, expect, it } from 'vitest'
import { resolveDay } from '../contract'
import { ageOn, bmrMifflin, computeTargets, maintenanceKcal, mondayOf, type NutritionInputs } from './engine'

const workout = { start: '12:15', durationMin: 60, type: 'strength' as const, intensity: 2 as const }
const T = { dayType: 'training' as const, workout }
const R = { dayType: 'rest' as const }

// The user's stats: 5'11" (180.34 cm), 41, ~81 kg. 150 g carbs a day, fat fills the rest.
const base: NutritionInputs = {
  sex: 'male',
  birthDate: '1985-07-01',
  heightCm: 180.34,
  weightKg: 81,
  activityFactor: 1.55,
  goal: 'maintenance',
  proteinMinG: 130,
  proteinMaxGPerKg: 2.0,
  carbMode: 'fixed',
  carbsPerDayG: 150,
  fatPctEnergy: 30,
  satFatLimitEnabled: false,
  satFatPctEnergy: 10,
  fibreMinG: 30,
  addedSugarPctEnergy: 5,
  restDayCarbReductionPct: 0,
  trainingDaysPerWeek: 4,
  slotProtein: {
    breakfast: { min: 32, preferred: 32, max: 36 },
    smoko: { min: 25, preferred: 28, max: 32 },
    lunch: { min: 35, preferred: 40, max: 45 },
    dinner: { min: 35, preferred: 38, max: 45 },
  },
  slotCarbShare: { smoko: 0.27, lunch: 0.6, dinner: 0.13 },
  slotFatShare: { smoko: 0.25, lunch: 0.35, dinner: 0.4 },
  mealTimes: { breakfast: '07:00', smoko: '11:00', lunch: '14:00', dinner: '18:00' },
  week: [T, T, R, T, T, R, R], // the user can choose any pattern
  breakfast: { energyKcal: 598, proteinG: 35, carbsG: 1.5, fatG: 49, satFatG: 15.6 },
  fixedBreakfastRecipeId: 'bf',
  weekStart: '2026-11-23',
}

describe('energy', () => {
  it('age is counted in whole years on the date', () => {
    expect(ageOn('1985-07-01', '2026-11-23')).toBe(41)
    expect(ageOn('1985-11-24', '2026-11-23')).toBe(40) // birthday tomorrow
  })

  it('Mifflin–St Jeor: 10x81 + 6.25x180.34 − 5x41 + 5 = 1,737.1 kcal', () => {
    expect(bmrMifflin('male', 81, 180.34, 41)).toBeCloseTo(1737.125, 6)
    expect(bmrMifflin('female', 81, 180.34, 41)).toBeCloseTo(1571.125, 6) // − 166
  })

  it('maintenance by activity level', () => {
    expect(maintenanceKcal(1737.125, 1.375)).toBe(2390) // 2,388.5
    expect(maintenanceKcal(1737.125, 1.55)).toBe(2690) // 2,692.5
    expect(maintenanceKcal(1737.125, 1.725)).toBe(3000) // 2,996.5
  })

  it.each([
    ['maintenance', undefined, 2690],
    ['fat_loss', undefined, 2290], // 2,690 x 0.85 = 2,286.5
    ['weight_loss', undefined, 2150], // x 0.80 = 2,152
    ['recomp', -10, 2420], // x 0.90 = 2,421
    ['muscle_gain', 10, 2960], // x 1.10 = 2,959
    ['weight_gain', 15, 3090], // x 1.15 = 3,093.5
  ] as const)('goal %s (%s%%) -> %i kcal', (goal, pct, kcal) => {
    expect(computeTargets({ ...base, goal, goalAdjustPct: pct }).dailyEnergyKcal).toBe(kcal)
  })

  it('weight loss can never go below −20%', () => {
    const r = computeTargets({ ...base, goal: 'weight_loss', goalAdjustPct: -30 })
    expect(r.goalAdjustPct).toBe(-20)
    expect(r.warnings.join()).toMatch(/outside the allowed range/)
  })
})

describe('fixed 150 g carbs, fat fills the rest (the approved approach)', () => {
  const r = computeTargets(base)
  const t = r.targetSet.templates.training
  const rest = r.targetSet.templates.rest

  it('every day: 2,690 kcal, 138 g protein, 150 g carbs, fat (2690 − 552 − 600)/9 = 170.9 -> 171 g', () => {
    for (const d of [t, rest]) {
      expect(d.energyKcal).toBe(2690)
      expect(d.proteinG).toEqual({ min: 130, preferred: 138 })
      expect(d.carbsG).toBe(150)
      expect(d.carbsMinG).toBe(150) // a floor, not just a target
      expect(d.fatG).toBe(171)
    }
  })

  it('no saturated fat limit unless switched on (then 10% = 30 g)', () => {
    expect(t.satFatMaxG).toBeNull()
    expect(r.warnings.join()).not.toMatch(/saturated/)
    const on = computeTargets({ ...base, satFatLimitEnabled: true })
    expect(on.targetSet.templates.rest.satFatMaxG).toBe(30)
    expect(on.warnings.join()).toMatch(/15.6 g saturated fat/)
  })

  it('carbs go to smoko, lunch and dinner, not breakfast: 148.5 g split 27/60/13 ±15%', () => {
    expect(t.slots.breakfast.carbsG).toEqual([2, 2])
    expect(t.slots.smoko.carbsG).toEqual([34, 46]) // 40.1
    expect(t.slots.lunch.carbsG).toEqual([76, 102]) // 89.1
    expect(t.slots.dinner.carbsG).toEqual([16, 22]) // 19.3
  })

  it('fat after breakfast (171 − 49 = 122 g) split 25/35/40 ±20%', () => {
    expect(t.slots.breakfast.fatG).toEqual([49, 49])
    expect(t.slots.smoko.fatG).toEqual([24, 37]) // 30.5
    expect(t.slots.lunch.fatG).toEqual([34, 51]) // 42.7
    expect(t.slots.dinner.fatG).toEqual([39, 59]) // 48.8
  })

  it('optional rest-day shift 20%: rest 120 g / training 172.5 -> 173 g; fat 184 / 161 g; energy unchanged', () => {
    const s = computeTargets({ ...base, restDayCarbReductionPct: 20 }).targetSet.templates
    expect(s.rest.carbsG).toBe(120)
    expect(s.training.carbsG).toBe(173)
    expect(s.rest.fatG).toBe(184) // (2690 − 552 − 480)/9 = 184.2
    expect(s.training.fatG).toBe(161) // (2690 − 552 − 692)/9 = 160.7
    expect(s.rest.energyKcal).toBe(2690)
  })

  it('warns when protein and carbs alone exceed energy', () => {
    expect(computeTargets({ ...base, carbsPerDayG: 600 }).warnings.join()).toMatch(/exceed the energy target/)
  })
})

describe('day types are chosen per date', () => {
  const ts = computeTargets(base).targetSet

  it('the proposal week follows the chosen pattern', () => {
    expect(ts.days.map((d) => d.dayType)).toEqual(['training', 'training', 'rest', 'training', 'training', 'rest', 'rest'])
    expect(ts.days.map((d) => d.date)).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
    ])
  })

  it('any date can be resolved as training or rest; smoko is "easy to digest" when training is within 2 h', () => {
    const sat = resolveDay(ts, '2026-11-28', 'training', workout)
    expect(sat.dayType).toBe('training')
    expect(sat.slots.smoko.digestibility).toBe('high') // 11:00 -> 12:15 = 75 min
    expect(resolveDay(ts, '2026-11-28', 'training', { ...workout, start: '16:00' }).slots.smoko.digestibility).toBeUndefined()
    const mon = resolveDay(ts, '2026-11-23', 'rest', workout)
    expect(mon.dayType).toBe('rest')
    expect(mon.workout).toBeUndefined()
    expect(mon.slots.smoko.digestibility).toBeUndefined()
  })

  it('protein minimums sum to 127 g, below the 130 g floor: warned', () => {
    expect(computeTargets(base).warnings.join()).toMatch(/add up to 127 g/)
  })

  it('mondayOf', () => {
    expect(mondayOf('2026-11-29')).toBe('2026-11-23')
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')
  })
})

describe('percent mode (Phase 1 behaviour) still works', () => {
  const p = computeTargets({ ...base, carbMode: 'percent', restDayCarbReductionPct: 15, satFatLimitEnabled: true }).targetSet.templates
  it('fat 30% = 90 g; carbs base 332 g -> rest 282 g, training 369 g; energy 2,490 / 2,838', () => {
    expect(p.rest.fatG).toBe(90)
    expect(p.rest.carbsG).toBe(282)
    expect(p.training.carbsG).toBe(369)
    expect(p.rest.energyKcal).toBe(2490)
    expect(p.training.energyKcal).toBe(2838)
  })
})

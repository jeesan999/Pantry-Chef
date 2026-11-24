import { describe, expect, it } from 'vitest'
import { ageOn, bmrMifflin, computeTargets, maintenanceKcal, mondayOf, type NutritionInputs } from './engine'

// The user's stats: 5'11" (180.34 cm), 41, ~81 kg (the weight implied by the approved BMR).
const base: NutritionInputs = {
  sex: 'male',
  birthDate: '1985-07-01',
  heightCm: 180.34,
  weightKg: 81,
  activityFactor: 1.55,
  goal: 'maintenance',
  proteinMinG: 130,
  proteinMaxGPerKg: 2.0,
  fatPctEnergy: 30,
  satFatPctEnergy: 10,
  fibreMinG: 30,
  addedSugarPctEnergy: 5,
  restDayCarbReductionPct: 15,
  slotProtein: {
    breakfast: { min: 32, preferred: 32, max: 36 },
    smoko: { min: 25, preferred: 28, max: 32 },
    lunch: { min: 35, preferred: 40, max: 45 },
    dinner: { min: 35, preferred: 38, max: 45 },
  },
  slotCarbShare: { smoko: 0.25, lunch: 0.55, dinner: 0.2 },
  mealTimes: { breakfast: '07:00', smoko: '11:00', lunch: '14:00', dinner: '18:00' },
  // Mon, Tue, Thu, Fri at 12:15, between smoko and lunch
  schedule: [0, 1, 3, 4].map((weekday) => ({ weekday, type: 'strength' as const, start: '12:15', durationMin: 60, intensity: 2 as const })),
  breakfast: { energyKcal: 580, proteinG: 33, carbsG: 3, fatG: 45, satFatG: 15 },
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

  it('maintenance by activity level matches the approved table', () => {
    expect(maintenanceKcal(1737.125, 1.375)).toBe(2390) // 2,388.5
    expect(maintenanceKcal(1737.125, 1.55)).toBe(2690) // 2,692.5
    expect(maintenanceKcal(1737.125, 1.725)).toBe(3000) // 2,996.5 (Phase 1 table said 2,990)
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

describe('macros and day targets (maintenance, 4 training days)', () => {
  const r = computeTargets(base)
  const mon = r.targetSet.days[0]
  const wed = r.targetSet.days[2]

  it('fat 30% = 90 g, sat fat 10% = 30 g, added sugar 5% = 34 g', () => {
    expect(mon.fatG).toBe(90) // 807 / 9 = 89.7
    expect(mon.satFatMaxG).toBe(30) // 269 / 9 = 29.9
    expect(mon.addedSugarMaxG).toBe(34) // 134.5 / 4 = 33.6
    expect(mon.fibreMinG).toBe(30)
  })

  it('protein aims at 138 g (32+28+40+38), floor stays 130 g, and warns that minimums sum to 127 g', () => {
    expect(mon.proteinG).toEqual({ min: 130, preferred: 138 })
    expect(r.warnings.join()).toMatch(/add up to 127 g/)
  })

  it('carbs: base 332 g; rest day −15% = 282 g; training day +11.25% = 369 g', () => {
    // base = (2690 − 138x4 − 90x9) / 4 = 1328 / 4 = 332
    expect(mon.dayType).toBe('training')
    expect(mon.carbsG).toBe(369)
    expect(wed.dayType).toBe('rest')
    expect(wed.carbsG).toBe(282)
  })

  it('weekly average energy stays at the 2,690 kcal target', () => {
    // training 552 + 810 + 1476 = 2838; rest 552 + 810 + 1128 = 2490
    expect(mon.energyKcal).toBe(2838)
    expect(wed.energyKcal).toBe(2490)
    const avg = r.targetSet.days.reduce((s, d) => s + d.energyKcal, 0) / 7
    expect(Math.abs(avg - 2690)).toBeLessThan(5)
  })

  it('slots: fixed breakfast, carb levels, lunch gets the most carbs, dinner the least', () => {
    expect(mon.slots.breakfast).toMatchObject({ fixedRecipeId: 'bf', proteinG: [33, 33], carbsG: [3, 3], carbLevel: 'low' })
    // carbs after breakfast 366: lunch 55% = 201.3 -> [171, 231]; dinner 20% = 73.2 -> [62, 84]
    expect(mon.slots.lunch.carbsG).toEqual([171, 231])
    expect(mon.slots.dinner.carbsG).toEqual([62, 84])
    expect(mon.slots.lunch.carbLevel).toBe('highest')
    expect(mon.slots.dinner.carbLevel).toBe('lowest')
  })

  it('smoko is marked highly digestible when training starts within 2 h of it', () => {
    expect(mon.slots.smoko.digestibility).toBe('high') // 11:00 -> 12:15 = 75 min
    expect(wed.slots.smoko.digestibility).toBeUndefined()
  })

  it('flags breakfast using over half the saturated fat limit', () => {
    expect(r.warnings.join()).toMatch(/15 g saturated fat/)
  })

  it('flags breakfast taking over half the fat budget (45 of 90 g), leaving 329 g carbs for 3 meals', () => {
    expect(r.warnings.join()).not.toMatch(/45 g of the 90 g/) // exactly half is not over half
    const r2 = computeTargets({ ...base, breakfast: { ...base.breakfast, fatG: 49 } })
    expect(r2.warnings.join()).toMatch(/49 g of the 90 g daily fat.*41 g fat and about 329 g carbohydrate/)
  })

  it('emits 7 dated days from the Monday', () => {
    expect(r.targetSet.days.map((d) => d.date)).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
    ])
    expect(mondayOf('2026-11-29')).toBe('2026-11-23')
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')
  })
})

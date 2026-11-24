import { z } from 'zod'
import type { TableName } from './schema'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')
const nonNeg = z.number().finite().min(0)
const id = z.string().min(1)

export const nutrientsSchema = z.object({
  energyKj: nonNeg,
  energyKcal: nonNeg,
  proteinG: nonNeg,
  fatG: nonNeg,
  satFatG: nonNeg,
  carbsG: nonNeg,
  sugarsG: nonNeg,
  addedSugarG: nonNeg,
  fibreG: nonNeg,
  sodiumMg: nonNeg,
})

const slotTimes = z.object({ breakfast: time, smoko: time, lunch: time, dinner: time })
const qtyUnit = z.enum(['g', 'ml', 'unit'])

/**
 * Validation for every table people type into. Tables written only by the app's own
 * logic (ledger, consumption snapshots) are checked by the functions that write them.
 */
export const SCHEMAS: Partial<Record<TableName, z.ZodType>> = {
  profile: z.object({
    id,
    name: z.string(),
    sex: z.enum(['male', 'female']),
    birthDate: date,
    heightCm: z.number().min(100).max(250),
    startingWeightKg: z.number().min(30).max(300),
    mealTimes: slotTimes,
    units: z.literal('metric'),
    confirmed: z.boolean(),
    updatedAt: z.string(),
  }),
  settings: z.object({
    id,
    profileId: id,
    activityFactor: z.number().min(1.2).max(2.0),
    proteinMinG: z.number().min(0).max(400),
    proteinMaxGPerKg: z.number().min(0.8).max(3.5),
    fatPctEnergy: z.number().min(15).max(50),
    satFatPctEnergy: z.number().min(5).max(15),
    fibreMinG: z.number().min(0).max(80),
    addedSugarPctEnergy: z.number().min(0).max(25),
    restDayCarbReductionPct: z.number().min(0).max(50),
    backupReminderDays: z.number().int().min(1).max(60),
  }).loose(),
  body_goals: z.object({
    id,
    profileId: id,
    type: z.enum(['maintenance', 'recomp', 'fat_loss', 'weight_loss', 'muscle_gain', 'weight_gain']),
    energyAdjustPct: z.number().min(-20).max(15),
    startDate: date,
  }).loose(),
  training_schedule: z.object({
    id,
    profileId: id,
    weekday: z.number().int().min(0).max(6),
    start: time,
    durationMin: z.number().int().min(5).max(300),
    intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }).loose(),
  foods: z.object({
    id,
    name: z.string().min(1),
    source: z.enum(['afcd', 'label', 'manual', 'interim']),
    state: z.enum(['raw', 'cooked', 'na']),
    ediblePortion: z.number().gt(0).max(1),
    per100g: nutrientsSchema,
  }).loose(),
  products: z.object({
    id,
    name: z.string().min(1),
    category: z.string().min(1),
    storage: z.enum(['pantry', 'fridge', 'freezer']),
    packSize: nonNeg.optional(),
  }).loose(),
  inventory_lots: z.object({
    id,
    productId: id,
    quantity: z.number().positive(),
    remaining: nonNeg,
    unit: qtyUnit,
    unitCostCents: nonNeg,
    purchaseDate: date,
    expiryDate: date.optional(),
  }).loose().refine((l) => l.remaining <= l.quantity + 1e-9, 'remaining cannot exceed quantity'),
  recipes: z.object({
    id,
    name: z.string().min(1),
    cuisine: z.string().min(1),
    method: z.array(z.string()),
    prepMin: nonNeg,
    cookMin: nonNeg,
    servings: z.number().positive(),
  }).loose(),
  recipe_ingredients: z.object({
    id,
    recipeId: id,
    label: z.string().min(1),
    quantity: z.number().positive(),
    unit: qtyUnit,
    weighed: z.enum(['raw', 'cooked']),
  }).loose().refine((i) => i.foodId || i.productId, 'ingredient needs a food or a product'),
  weight_measurements: z.object({ id, profileId: id, date, weightKg: z.number().min(30).max(300) }).loose(),
  waist_measurements: z.object({ id, profileId: id, date, waistCm: z.number().min(40).max(200) }).loose(),
  planned_meals: z.object({ id, mealPlanId: id, date, time, recipeId: id, portionScale: z.number().positive().max(5) }).loose(),
}

/**
 * Record types for all 30 tables.
 * Conventions: ids are UUID strings; money is whole cents; quantities are grams (g),
 * millilitres (ml) or units; dates are 'YYYY-MM-DD'; timestamps are ISO strings.
 */
import type { GoalType, SlotName, TargetSet, WorkoutType } from '../engines/contract'

export type Id = string
export type Cents = number
export type QtyUnit = 'g' | 'ml' | 'unit'

/** Nutrients per 100 g of edible portion. */
export interface Nutrients {
  energyKj: number
  energyKcal: number
  proteinG: number
  fatG: number
  satFatG: number
  carbsG: number // available carbohydrate
  sugarsG: number
  addedSugarG: number
  fibreG: number
  sodiumMg: number
}

// ---------- You ----------
export interface Profile {
  id: Id
  name: string
  sex: 'male' | 'female'
  birthDate: string
  heightCm: number
  startingWeightKg: number // used until the first weigh-in
  mealTimes: Record<SlotName, string>
  units: 'metric'
  confirmed: boolean // false while the stats are placeholders awaiting the user
  updatedAt: string
}

export interface Settings {
  id: Id
  profileId: Id
  activityFactor: number // 1.375 | 1.55 | 1.725 or custom
  proteinMinG: number
  proteinMaxGPerKg: number
  carbMode: 'fixed' | 'percent' // fixed: set grams of carbs, fat fills the rest
  carbsPerDayG: number
  fatPctEnergy: number // percent mode only
  satFatLimitEnabled: boolean
  satFatPctEnergy: number
  fibreMinG: number
  addedSugarPctEnergy: number
  restDayCarbReductionPct: number
  trainingDaysPerWeek: number // nominal, balances any rest-day carb shift
  defaultWorkout: { start: string; durationMin: number; type: WorkoutType }
  slotProtein: Record<SlotName, { min: number; preferred: number; max: number }>
  slotCarbShare: { smoko: number; lunch: number; dinner: number } // of carbs left after breakfast
  slotFatShare: { smoko: number; lunch: number; dinner: number } // of fat left after breakfast
  breakfast: { eggs: number; avocadoHalves: number; baconRashers: number; gheeG: number }
  fixedBreakfastRecipeId?: Id
  weeklyBudgetCents?: Cents
  monthlyBudgetCents?: Cents
  backupReminderDays: number
  lastBackupAt?: string
  updatedAt: string
}

// ---------- Goals ----------
export interface BodyGoal {
  id: Id
  profileId: Id
  type: GoalType
  energyAdjustPct: number
  targetWeightKg?: number
  targetWaistCm?: number
  rateKgPerWeek?: number
  startDate: string
  endDate?: string // set when replaced; history never overwritten
  createdAt: string
}

export interface NutritionTargetRecord {
  id: Id
  bodyGoalId: Id
  status: 'proposed' | 'approved' | 'superseded' | 'rejected'
  version: number | null // assigned only on approval
  weekStart: string
  inputs: {
    weightKg: number
    ageYears: number
    heightCm: number
    sex: 'male' | 'female'
    activityFactor: number
    bmrKcal: number
    maintenanceKcal: number
    goalAdjustPct: number
  }
  targetSet: TargetSet
  createdAt: string
  approvedAt?: string
}

// ---------- Training ----------
export interface TrainingScheduleEntry {
  id: Id
  profileId: Id
  weekday: number // 0 = Monday ... 6 = Sunday
  type: WorkoutType
  start: string // HH:MM
  durationMin: number
  intensity: 1 | 2 | 3
  active: boolean
}

export interface Workout {
  id: Id
  scheduleId?: Id
  date: string
  type: WorkoutType
  start: string
  durationMin: number
  intensity: 1 | 2 | 3
  status: 'planned' | 'completed' | 'skipped'
  notes?: string
}

// ---------- Food data ----------
export interface Food {
  id: Id
  afcdKey?: string // AFCD Public Food Key
  name: string
  source: 'afcd' | 'label' | 'manual' | 'interim'
  state: 'raw' | 'cooked' | 'na'
  ediblePortion: number // 0..1
  per100g: Nutrients
  gramsPerUnit?: number // e.g. one large egg, edible portion
  densityGPerMl?: number
  updatedAt: string
}

export interface CookingYield {
  id: Id
  rawFoodId: Id
  cookedFoodId?: Id
  method: string
  factor: number // cooked weight / raw weight
}

export interface Product {
  id: Id
  foodId?: Id
  name: string
  brand?: string
  packSize?: number
  packUnit?: QtyUnit
  category: string
  storage: 'pantry' | 'fridge' | 'freezer'
  labelNutrients?: Nutrients // branded items, typed once from the label
  createdAt: string
}

export interface ProductAlias {
  id: Id
  productId: Id
  store: string
  receiptText: string
  createdAt: string
}

// ---------- Pantry ----------
export interface InventoryLot {
  id: Id
  productId: Id
  purchaseId?: Id
  quantity: number
  remaining: number
  unit: QtyUnit
  unitCostCents: number // per g / ml / unit, may be fractional
  purchaseDate: string
  expiryDate?: string
  expiryKind?: 'use_by' | 'best_before'
  location: 'pantry' | 'fridge' | 'freezer'
  createdAt: string
}

export type InventoryTxnType = 'purchase' | 'consume' | 'discard' | 'adjust' | 'undo'

export interface InventoryTransaction {
  id: Id
  lotId: Id
  type: InventoryTxnType
  qtyDelta: number
  consumptionId?: Id
  reversesId?: Id // set on an undo row: the transaction it cancels
  note?: string
  at: string
}

export interface WasteRecord {
  id: Id
  transactionId: Id
  reason: 'expired' | 'spoiled' | 'leftover' | 'other'
  costCents: Cents
  at: string
}

// ---------- Shopping ----------
export interface Receipt {
  id: Id
  store: string
  purchasedAt: string
  totalCents: Cents
  discountCents: Cents
  imageHash?: string
  image?: Blob
  createdAt: string
}

export interface ReceiptItem {
  id: Id
  receiptId: Id
  productId?: Id
  rawText: string
  parsedName?: string
  quantity?: number
  weightG?: number
  priceCents?: Cents
  discountCents?: Cents
  confidence: number
}

export interface GroceryPurchase {
  id: Id
  receiptItemId?: Id
  productId: Id
  store: string
  date: string
  quantity: number
  unit: QtyUnit
  priceCents: Cents
  discountCents: Cents
}

export interface Expense {
  id: Id
  receiptId?: Id
  store: string
  date: string
  amountCents: Cents
  category: string
}

export interface PriceHistory {
  id: Id
  productId: Id
  purchaseId: Id
  date: string
  store: string
  centsPerKgOrUnit: number
}

export interface Budget {
  id: Id
  settingsId: Id
  period: 'week' | 'month'
  limitCents: Cents
  alertPct: number
}

export interface ShoppingList {
  id: Id
  mealPlanId?: Id
  name: string
  createdAt: string
}

export interface ShoppingListItem {
  id: Id
  listId: Id
  productId: Id
  quantity: number
  unit: QtyUnit
  estCostCents: Cents
  ticked: boolean
}

// ---------- Recipes ----------
export type SlotTag = 'breakfast' | 'smoko' | 'pre-workout' | 'post-workout' | 'lunch' | 'low-carb-dinner' | 'dinner'

export interface Recipe {
  id: Id
  name: string
  cuisine: string
  method: string[]
  prepMin: number
  cookMin: number
  servings: number
  slotTags: SlotTag[]
  fixedSlot?: SlotName
  photo?: Blob
  starter: boolean
  createdAt: string
  updatedAt: string
}

export interface RecipeIngredient {
  id: Id
  recipeId: Id
  foodId?: Id
  productId?: Id
  label: string
  quantity: number
  unit: QtyUnit
  weighed: 'raw' | 'cooked'
  optional: boolean
  sort: number
}

export type RatingFlag =
  | 'favourite'
  | 'cook_again'
  | 'do_not_recommend'
  | 'too_expensive'
  | 'too_slow'
  | 'needs_flavour'
  | 'too_repetitive'

export interface RecipeRating {
  id: Id
  recipeId: Id
  stars?: 1 | 2 | 3 | 4 | 5
  flags: RatingFlag[]
  at: string
}

// ---------- Meals ----------
export interface MealPlan {
  id: Id
  weekStart: string
  targetsId: Id
  targetsVersion: number
  createdAt: string
}

export interface PlannedMeal {
  id: Id
  mealPlanId: Id
  date: string
  slot: SlotName
  time: string
  recipeId: Id
  portionScale: number
}

export interface MealConsumption {
  id: Id
  plannedMealId: Id
  fractionEaten: number
  nutrition: Nutrients // frozen totals
  costCents: number // frozen
  at: string
  undone: boolean
}

export interface NutritionalRecord {
  id: Id
  date: string
  targetsId: Id
  workoutId?: Id
  dayType: 'training' | 'rest' | 'recovery'
  totals: Nutrients
}

// ---------- Progress ----------
export interface WeightMeasurement {
  id: Id
  profileId: Id
  date: string
  weightKg: number
  timeOfDay: 'morning' | 'midday' | 'evening'
}

export interface WaistMeasurement {
  id: Id
  profileId: Id
  date: string
  waistCm: number
  bodyFatPct?: number
}

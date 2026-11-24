import Dexie, { type EntityTable } from 'dexie'
import type * as T from './types'

/** The 30 tables. Indexes list only fields that are queried; every record is stored whole. */
export const STORES = {
  // You
  profile: 'id',
  settings: 'id, profileId',
  // Goals
  body_goals: 'id, profileId, startDate, endDate',
  nutrition_targets: 'id, bodyGoalId, status, version, weekStart',
  // Training
  training_schedule: 'id, profileId, weekday',
  workouts: 'id, scheduleId, date',
  // Food data
  foods: 'id, &afcdKey, name, source',
  cooking_yields: 'id, rawFoodId, cookedFoodId',
  products: 'id, foodId, name, category',
  product_aliases: 'id, productId, [store+receiptText]',
  // Pantry
  inventory_lots: 'id, productId, purchaseId, expiryDate, location',
  inventory_transactions: 'id, lotId, type, consumptionId, reversesId, at',
  waste_records: 'id, transactionId, at',
  // Shopping
  receipts: 'id, store, purchasedAt, imageHash',
  receipt_items: 'id, receiptId, productId',
  grocery_purchases: 'id, receiptItemId, productId, date',
  expenses: 'id, receiptId, date, store, category',
  price_history: 'id, productId, purchaseId, date',
  budgets: 'id, settingsId, period',
  shopping_lists: 'id, mealPlanId',
  shopping_list_items: 'id, listId, productId',
  // Recipes
  recipes: 'id, name, cuisine, *slotTags, fixedSlot',
  recipe_ingredients: 'id, recipeId, foodId, productId',
  recipe_ratings: 'id, recipeId',
  // Meals
  meal_plans: 'id, weekStart, targetsId',
  planned_meals: 'id, mealPlanId, date, [date+slot], recipeId',
  meal_consumption: 'id, plannedMealId',
  nutritional_records: 'id, &date, targetsId, workoutId',
  // Progress
  weight_measurements: 'id, profileId, date',
  waist_measurements: 'id, profileId, date',
} as const

export type TableName = keyof typeof STORES

export interface RecordMap {
  profile: T.Profile
  settings: T.Settings
  body_goals: T.BodyGoal
  nutrition_targets: T.NutritionTargetRecord
  training_schedule: T.TrainingScheduleEntry
  workouts: T.Workout
  foods: T.Food
  cooking_yields: T.CookingYield
  products: T.Product
  product_aliases: T.ProductAlias
  inventory_lots: T.InventoryLot
  inventory_transactions: T.InventoryTransaction
  waste_records: T.WasteRecord
  receipts: T.Receipt
  receipt_items: T.ReceiptItem
  grocery_purchases: T.GroceryPurchase
  expenses: T.Expense
  price_history: T.PriceHistory
  budgets: T.Budget
  shopping_lists: T.ShoppingList
  shopping_list_items: T.ShoppingListItem
  recipes: T.Recipe
  recipe_ingredients: T.RecipeIngredient
  recipe_ratings: T.RecipeRating
  meal_plans: T.MealPlan
  planned_meals: T.PlannedMeal
  meal_consumption: T.MealConsumption
  nutritional_records: T.NutritionalRecord
  weight_measurements: T.WeightMeasurement
  waist_measurements: T.WaistMeasurement
}

export type ChefDB = Dexie & { [K in TableName]: EntityTable<RecordMap[K], 'id'> }

export function openDb(name = 'personal-chef'): ChefDB {
  const db = new Dexie(name) as ChefDB
  db.version(1).stores(STORES)
  return db
}

/**
 * Foreign keys, enforced by the repository layer (IndexedDB has none of its own).
 * restrict: a parent cannot be deleted while children point at it.
 * cascade: deleting the parent deletes the children in the same transaction.
 */
export interface ForeignKey {
  table: TableName
  field: string
  ref: TableName
  onDelete: 'restrict' | 'cascade'
  optional?: boolean
}

export const FOREIGN_KEYS: ForeignKey[] = [
  { table: 'settings', field: 'profileId', ref: 'profile', onDelete: 'cascade' },
  { table: 'settings', field: 'fixedBreakfastRecipeId', ref: 'recipes', onDelete: 'restrict', optional: true },
  { table: 'body_goals', field: 'profileId', ref: 'profile', onDelete: 'cascade' },
  { table: 'nutrition_targets', field: 'bodyGoalId', ref: 'body_goals', onDelete: 'restrict' },
  { table: 'training_schedule', field: 'profileId', ref: 'profile', onDelete: 'cascade' },
  { table: 'workouts', field: 'scheduleId', ref: 'training_schedule', onDelete: 'restrict', optional: true },
  { table: 'cooking_yields', field: 'rawFoodId', ref: 'foods', onDelete: 'cascade' },
  { table: 'cooking_yields', field: 'cookedFoodId', ref: 'foods', onDelete: 'restrict', optional: true },
  { table: 'products', field: 'foodId', ref: 'foods', onDelete: 'restrict', optional: true },
  { table: 'product_aliases', field: 'productId', ref: 'products', onDelete: 'cascade' },
  { table: 'inventory_lots', field: 'productId', ref: 'products', onDelete: 'restrict' },
  { table: 'inventory_lots', field: 'purchaseId', ref: 'grocery_purchases', onDelete: 'restrict', optional: true },
  { table: 'inventory_transactions', field: 'lotId', ref: 'inventory_lots', onDelete: 'restrict' },
  { table: 'inventory_transactions', field: 'consumptionId', ref: 'meal_consumption', onDelete: 'restrict', optional: true },
  { table: 'inventory_transactions', field: 'reversesId', ref: 'inventory_transactions', onDelete: 'restrict', optional: true },
  { table: 'waste_records', field: 'transactionId', ref: 'inventory_transactions', onDelete: 'restrict' },
  { table: 'receipt_items', field: 'receiptId', ref: 'receipts', onDelete: 'cascade' },
  { table: 'receipt_items', field: 'productId', ref: 'products', onDelete: 'restrict', optional: true },
  { table: 'grocery_purchases', field: 'receiptItemId', ref: 'receipt_items', onDelete: 'restrict', optional: true },
  { table: 'grocery_purchases', field: 'productId', ref: 'products', onDelete: 'restrict' },
  { table: 'expenses', field: 'receiptId', ref: 'receipts', onDelete: 'restrict', optional: true },
  { table: 'price_history', field: 'productId', ref: 'products', onDelete: 'restrict' },
  { table: 'price_history', field: 'purchaseId', ref: 'grocery_purchases', onDelete: 'cascade' },
  { table: 'budgets', field: 'settingsId', ref: 'settings', onDelete: 'cascade' },
  { table: 'shopping_lists', field: 'mealPlanId', ref: 'meal_plans', onDelete: 'cascade', optional: true },
  { table: 'shopping_list_items', field: 'listId', ref: 'shopping_lists', onDelete: 'cascade' },
  { table: 'shopping_list_items', field: 'productId', ref: 'products', onDelete: 'restrict' },
  { table: 'recipe_ingredients', field: 'recipeId', ref: 'recipes', onDelete: 'cascade' },
  { table: 'recipe_ingredients', field: 'foodId', ref: 'foods', onDelete: 'restrict', optional: true },
  { table: 'recipe_ingredients', field: 'productId', ref: 'products', onDelete: 'restrict', optional: true },
  { table: 'recipe_ratings', field: 'recipeId', ref: 'recipes', onDelete: 'cascade' },
  { table: 'meal_plans', field: 'targetsId', ref: 'nutrition_targets', onDelete: 'restrict' },
  { table: 'planned_meals', field: 'mealPlanId', ref: 'meal_plans', onDelete: 'cascade' },
  { table: 'planned_meals', field: 'recipeId', ref: 'recipes', onDelete: 'restrict' },
  { table: 'meal_consumption', field: 'plannedMealId', ref: 'planned_meals', onDelete: 'restrict' },
  { table: 'nutritional_records', field: 'targetsId', ref: 'nutrition_targets', onDelete: 'restrict' },
  { table: 'nutritional_records', field: 'workoutId', ref: 'workouts', onDelete: 'restrict', optional: true },
  { table: 'weight_measurements', field: 'profileId', ref: 'profile', onDelete: 'cascade' },
  { table: 'waist_measurements', field: 'profileId', ref: 'profile', onDelete: 'cascade' },
]

/** Tables whose rows are never edited or deleted, only appended (the pantry ledger). */
export const APPEND_ONLY: ReadonlySet<TableName> = new Set(['inventory_transactions'])

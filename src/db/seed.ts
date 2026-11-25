import { INTERIM_FOODS, INTERIM_FOOD_ID, INTERIM_YIELDS } from '../data/interimFoods'
import type { StarterRecipe } from '../data/recipes'
import { ALL_RECIPES, LIBRARY_RECIPES, RECIPE_LIBRARY_VERSION } from '../data/library'
import { newId, nowIso, type Repo } from './repo'
import type { Profile, Recipe, RecipeIngredient, Settings } from './types'

export const PROFILE_ID = 'profile:me'
export const SETTINGS_ID = 'settings:me'
export const FIXED_BREAKFAST_ID = 'recipe:fixed-breakfast'

export function defaultProfile(): Profile {
  return {
    id: PROFILE_ID,
    name: '',
    sex: 'male',
    // Age 41 given; exact birth date not yet given (edit in Settings).
    birthDate: '1985-07-01',
    heightCm: 180.3, // 5 ft 11 in
    startingWeightKg: 81, // implied by the approved 1,735 kcal BMR; replaced by the first weigh-in
    mealTimes: { breakfast: '07:00', smoko: '11:00', lunch: '14:00', dinner: '18:00' },
    units: 'metric',
    confirmed: false,
    updatedAt: nowIso(),
  }
}

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    profileId: PROFILE_ID,
    activityFactor: 1.55,
    proteinMinG: 130,
    proteinMaxGPerKg: 2.0,
    // Agreed 24 Nov 2026: 150 g carbs a day across smoko, lunch and dinner; fat fills the rest.
    carbMode: 'fixed',
    carbsPerDayG: 150,
    fatPctEnergy: 30,
    satFatLimitEnabled: false, // user does not follow the saturated fat guideline; still tracked
    satFatPctEnergy: 10,
    fibreMinG: 30,
    addedSugarPctEnergy: 5,
    restDayCarbReductionPct: 0,
    trainingDaysPerWeek: 4,
    defaultWorkout: { start: '12:15', durationMin: 60, type: 'strength' },
    slotProtein: {
      breakfast: { min: 32, preferred: 32, max: 36 },
      smoko: { min: 25, preferred: 28, max: 32 },
      lunch: { min: 35, preferred: 40, max: 45 },
      dinner: { min: 35, preferred: 38, max: 45 },
    },
    // Low-carb dinners; most carbs at smoko and the post-workout lunch.
    slotCarbShare: { smoko: 0.27, lunch: 0.6, dinner: 0.13 },
    slotFatShare: { smoko: 0.25, lunch: 0.35, dinner: 0.4 },
    breakfast: { eggs: 4, avocadoHalves: 1, baconRashers: 1, gheeG: 5 },
    fixedBreakfastRecipeId: FIXED_BREAKFAST_ID,
    backupReminderDays: 7,
    updatedAt: nowIso(),
  }
}

/** The fixed breakfast's ingredient lines, built from the editable quantities in settings. */
export function breakfastIngredients(b: Settings['breakfast']): RecipeIngredient[] {
  const lines: Array<[string, string, number, RecipeIngredient['unit']]> = [
    ['egg', 'Large eggs', b.eggs, 'unit'],
    ['avocado', 'Avocado (halves)', b.avocadoHalves / 2, 'unit'],
    ['bacon_middle', 'Middle bacon rashers', b.baconRashers, 'unit'],
    ['ghee', 'Ghee', b.gheeG, 'g'],
  ]
  return lines
    .filter(([, , q]) => q > 0)
    .map(([key, label, quantity, unit], i) => ({
      id: `${FIXED_BREAKFAST_ID}:${key}`,
      recipeId: FIXED_BREAKFAST_ID,
      foodId: INTERIM_FOOD_ID(key),
      label,
      quantity,
      unit,
      weighed: 'raw',
      optional: false,
      sort: i,
    }))
}

function starterToRecords(s: StarterRecipe): { recipe: Recipe; ingredients: RecipeIngredient[] } {
  const id = `recipe:${s.key}`
  const recipe: Recipe = {
    id,
    name: s.name,
    cuisine: s.cuisine,
    method: s.method,
    prepMin: s.prepMin,
    cookMin: s.cookMin,
    servings: s.servings,
    slotTags: s.slotTags,
    protein: s.protein,
    technique: s.technique,
    starter: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const ingredients = s.ingredients.map(([food, quantity, unit, label, flags], i): RecipeIngredient => ({
    id: `${id}:${i}`,
    recipeId: id,
    foodId: INTERIM_FOOD_ID(food),
    label,
    quantity,
    unit,
    weighed: flags?.includes('cooked') ? 'cooked' : 'raw',
    optional: !!flags?.includes('optional'),
    sort: i,
  }))
  return { recipe, ingredients }
}

/** First run: create the profile, settings, goal, training week, foods and recipes. Idempotent. */
export async function seedIfEmpty(repo: Repo, today: string): Promise<boolean> {
  if (await repo.db.profile.get(PROFILE_ID)) return false
  await repo.tx(async () => {
    await repo.insert('profile', defaultProfile())
    for (const f of INTERIM_FOODS) {
      const { key: _k, afcdSearch: _s, ...food } = f
      await repo.insert('foods', food)
    }
    for (const y of INTERIM_YIELDS) {
      await repo.insert('cooking_yields', { id: `yield:${y.key}`, rawFoodId: INTERIM_FOOD_ID(y.key), method: y.method, factor: y.factor })
    }
    await repo.insert('recipes', {
      id: FIXED_BREAKFAST_ID,
      name: 'Fixed breakfast: eggs, avocado, bacon',
      cuisine: 'Australian',
      method: ['Melt the ghee in a pan over medium heat.', 'Cook the bacon until crisp.', 'Cook the eggs to your liking.', 'Serve with sliced avocado.'],
      prepMin: 3,
      cookMin: 10,
      servings: 1,
      slotTags: ['breakfast'],
      fixedSlot: 'breakfast',
      starter: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    const settings = defaultSettings()
    for (const ing of breakfastIngredients(settings.breakfast)) await repo.insert('recipe_ingredients', ing)
    await repo.insert('settings', settings)
    await repo.insert('body_goals', {
      id: newId(),
      profileId: PROFILE_ID,
      type: 'maintenance',
      energyAdjustPct: 0,
      startDate: today,
      createdAt: nowIso(),
    })
    // A usual week: four training days between smoko and lunch. Only a default: the user picks
    // training or rest for any date on the Plan or Today screen.
    for (const weekday of [0, 1, 3, 4]) {
      await repo.insert('training_schedule', {
        id: `training:${weekday}`,
        profileId: PROFILE_ID,
        weekday,
        type: 'strength',
        start: '12:15',
        durationMin: 60,
        intensity: 2,
        active: true,
      })
    }
    for (const s of ALL_RECIPES) {
      const { recipe, ingredients } = starterToRecords(s)
      await repo.insert('recipes', recipe)
      for (const ing of ingredients) await repo.insert('recipe_ingredients', ing)
    }
  })
  return true
}

/**
 * Give an existing install the recipes added in later versions, once. Only recipes new in that version
 * are added (a starter recipe you deleted stays deleted) and nothing you have is changed.
 */
export async function ensureStarterRecipes(repo: Repo): Promise<number> {
  const settings = await repo.get('settings', SETTINGS_ID)
  if (!settings || (settings.recipeLibrary ?? 1) >= RECIPE_LIBRARY_VERSION) return 0
  let added = 0
  await repo.tx(async () => {
    for (const s of LIBRARY_RECIPES) {
      const { recipe, ingredients } = starterToRecords(s)
      if (await repo.db.recipes.get(recipe.id)) continue
      await repo.insert('recipes', recipe)
      for (const ing of ingredients) await repo.insert('recipe_ingredients', ing)
      added++
    }
    await repo.update('settings', SETTINGS_ID, { recipeLibrary: RECIPE_LIBRARY_VERSION })
  })
  return added
}

/** Rewrite the fixed breakfast's ingredients after its quantities change in settings. */
export async function updateBreakfast(repo: Repo, b: Settings['breakfast']): Promise<void> {
  await repo.tx(async () => {
    await repo.update('settings', SETTINGS_ID, { breakfast: b, updatedAt: nowIso() })
    await repo.db.recipe_ingredients.where('recipeId').equals(FIXED_BREAKFAST_ID).delete()
    for (const ing of breakfastIngredients(b)) await repo.insert('recipe_ingredients', ing)
  })
}

/** Add any interim foods introduced in later versions to an existing database (never overwrites). */
export async function ensureInterimFoods(repo: Repo): Promise<number> {
  let added = 0
  await repo.tx(async () => {
    for (const f of INTERIM_FOODS) {
      if (await repo.db.foods.get(f.id)) continue
      const { key: _k, afcdSearch: _s, ...food } = f
      await repo.insert('foods', food)
      added++
    }
  })
  return added
}

/**
 * One-off: rebalance the starter recipes to the agreed eating pattern (24 Nov 2026):
 * ~150 g carbs a day across smoko, lunch and dinner; fat fills the rest of the energy;
 * cooking fats are ghee, coconut oil or olive oil (no seed oils: sesame oil is replaced).
 *
 * Per meal the targets, relative to protein (portions are later scaled to protein), are:
 *   smoko  C/P 1.50  F/P 1.09   lunch  C/P 2.40  F/P 1.07   dinner  C/P 0.51  F/P 1.28
 * Writes src/data/recipes.ts; prints before/after for review.
 */
import { writeFileSync } from 'node:fs'
import { STARTER_RECIPES, type StarterIngredient, type StarterRecipe } from '../src/data/recipes.ts'
import { INTERIM_FOODS } from '../src/data/interimFoods.ts'

const foods = new Map(INTERIM_FOODS.map((f) => [f.key, f]))
// 150 g is a MINIMUM and dinners are low-carb, so smoko (42 g) and lunch (96 g) aim a little above their share
const RATIO = { smoko: { c: 42 / 28, f: 30.5 / 28 }, lunch: { c: 96 / 40, f: 42.7 / 40 }, dinner: { c: 19.3 / 38, f: 48.8 / 38 } }
const CARB = new Set(['rice_white', 'rice_brown', 'pasta', 'rice_noodles', 'soba', 'oats', 'bread_wholemeal', 'wrap', 'potato', 'sweet_potato', 'quinoa', 'banana', 'honey', 'apple', 'lentils_red', 'corn', 'berries'])

type Slot = keyof typeof RATIO
const slotOf = (r: StarterRecipe): Slot => (r.slotTags.includes('smoko') ? 'smoko' : r.slotTags.includes('post-workout') ? 'lunch' : 'dinner')

function grams(i: StarterIngredient): number {
  const [key, q, unit] = i
  const f = foods.get(key)!
  return unit === 'g' ? q : unit === 'ml' ? q * (f.densityGPerMl ?? 1) : q * (f.gramsPerUnit ?? 0)
}
function totals(ings: StarterIngredient[]) {
  let p = 0, c = 0, f = 0, cCarb = 0, kcal = 0, sat = 0
  for (const i of ings) {
    const n = foods.get(i[0])!.per100g
    const g = grams(i) / 100
    p += n.proteinG * g; c += n.carbsG * g; f += n.fatG * g; kcal += n.energyKcal * g; sat += n.satFatG * g
    if (CARB.has(i[0])) cCarb += n.carbsG * g
  }
  return { p, c, f, cCarb, kcal, sat }
}

const roundQty = (q: number, unit: string) => (unit === 'unit' ? Math.max(0.5, Math.round(q * 2) / 2) : Math.max(5, Math.round(q / 5) * 5))

const NAME: Record<string, string> = {
  'Lean spaghetti bolognese': 'Spaghetti bolognese',
  'Lighter butter chicken with rice': 'Butter chicken with rice',
  'Spinach and parmesan egg-white frittata with toast': 'Spinach and parmesan frittata with toast',
}

const out: StarterRecipe[] = []
const report: string[] = []
for (const r of STARTER_RECIPES) {
  const slot = slotOf(r)
  const fat = r.cuisine === 'Thai' || r.cuisine === 'Korean' ? 'coconut_oil' : 'ghee'
  const fatName = fat === 'ghee' ? 'ghee' : 'coconut oil'
  const fatLabel = fat === 'ghee' ? 'Ghee' : 'Coconut oil'
  const before = totals(r.ingredients)

  // 1. Swaps: no seed/vegetable oils; full-fat dairy; fattier cuts at dinner.
  let ings: StarterIngredient[] = r.ingredients.map((i) => {
    let [key, q, unit, label, flags] = i
    const swap = (k: string, l: string) => { key = k; label = l }
    if (key === 'sesame_oil') swap(fat, fatLabel) // seed oil out; olive oil stays (user, 24 Nov)
    else if (key === 'coconut_milk_light') swap('coconut_milk', 'Coconut milk')
    else if (key === 'milk_skim') swap('milk_full', 'Full-cream milk')
    else if (key === 'beef_mince') swap('beef_mince_regular', label.replace(/lean /i, '').replace(/\s*\(5 star\)/, '').replace(/^beef mince$/i, 'Beef mince'))
    else if (key === 'cheddar_light') swap('cheddar', 'Cheddar')
    else if (slot === 'dinner' && (key === 'chicken_breast' || key === 'chicken_thigh')) swap('chicken_thigh_skin', label.includes('mince') ? 'Chicken thigh, skin on, finely chopped' : 'Chicken thigh, skin on')
    else if (slot !== 'smoko' && key === 'greek_yoghurt') swap('greek_yoghurt_full', label.replace(/^Greek yoghurt/, 'Full-fat Greek yoghurt'))
    label = label.replace(/^Lean beef mince/i, 'Beef mince')
    return [key, q, unit, label, flags] as StarterIngredient
  })

  // 2. Scale the starchy ingredients so carbs sit at the meal's carb-to-protein ratio.
  let k = 1
  for (let it = 0; it < 4; it++) {
    const t = totals(ings.map((i) => (CARB.has(i[0]) ? ([i[0], i[1] * k, i[2], i[3], i[4]] as StarterIngredient) : i)))
    const cOther = t.c - t.cCarb
    const cCarbAt1 = t.cCarb / k
    if (cCarbAt1 <= 0) break
    k = Math.min(1.2, Math.max(0.3, (RATIO[slot].c * t.p - cOther) / cCarbAt1))
  }
  ings = ings.map((i) => (CARB.has(i[0]) ? ([i[0], roundQty(i[1] * k, i[2]), i[2], i[3], i[4]] as StarterIngredient) : i))

  // 3. Top up fat with ghee / coconut oil (cooked dishes) or macadamias (no-cook), max 30 g a line.
  const cold = r.cookMin === 0
  const hasOlive = r.ingredients.some((i) => i[0] === 'olive_oil')
  // One fat per dish: recipes written with olive oil get more olive oil, others ghee / coconut oil.
  const source = cold ? 'macadamia' : hasOlive ? 'olive_oil' : fat
  const t2 = totals(ings)
  const need = RATIO[slot].f * t2.p - t2.f
  let addedFat = 0
  if (need > 2) {
    const perG = foods.get(source)!.per100g.fatG / 100
    const idx = ings.findIndex((i) => i[0] === source)
    const current = idx >= 0 ? ings[idx][1] : 0
    const target = Math.min(30, Math.max(current, Math.round((current + need / perG) / 5) * 5))
    addedFat = target - current
    if (idx >= 0) ings[idx] = [source, target, 'g', ings[idx][3], ings[idx][4]]
    else if (target > 0) ings.push([source, target, 'g', cold ? 'Macadamias, chopped' : fatLabel])
  }

  // 4. Method wording: name the fat; make sure an added fat is used somewhere.
  const usesOlive = r.ingredients.some((i) => i[0] === 'olive_oil')
  let method = r.method.map((m) => m.replace(/sesame oil/gi, fatName).replace(/(?<!olive |coconut )\boil\b(?! ?\w*paste)/gi, usesOlive ? 'olive oil' : fatName))
  // Oil that was a salad dressing becomes lemon/lime: melted ghee is no dressing.
  method = method.map((m) => m.replace(new RegExp(`(Toss|toss|dressed|Dress)([^.;]*?)(with|in) (the )?${fatName}(,| and)?`, 'g'), (_x, v, mid, w) => `${v}${mid}${w} lemon juice`))
  const sourceName = cold ? 'macadamia' : hasOlive ? 'olive oil' : fatName
  const mentions = method.some((m) => m.toLowerCase().includes(sourceName))
  if ((addedFat > 0 || ings.some((i) => i[0] === source)) && !mentions) {
    if (cold) method = [...method, 'Scatter over the chopped macadamias.']
    else {
      const rules: Array<[RegExp, string]> = [
        [/\b(pan-cook|pan-fry|fry|brown|sear|stir-fry|sauté|scramble|soften|wilt)/i, ` Use the ${fatName} for this.`],
        [/\b(grill|roast|bake)/i, ` Brush with the ${fatName} first.`],
        [/\btoast\b/i, ` Spread with the ${fatName}.`],
        [/\b(simmer|poach|cook the rice|cook the oats)/i, ` Stir the ${fatName} through at the end.`],
      ]
      let done = false
      for (const [re, add] of rules) {
        const idx = method.findIndex((m) => re.test(m))
        if (idx >= 0) {
          method[idx] = method[idx].replace(/\.?$/, '.') + add
          done = true
          break
        }
      }
      if (!done) method = [...method, `Finish with the ${fatName} melted over the top.`]
    }
  }

  const after = totals(ings)
  out.push({ ...r, name: NAME[r.name] ?? r.name, ingredients: ings, method })
  report.push(
    `${slot.padEnd(6)} ${r.key.padEnd(28)} P ${before.p.toFixed(0).padStart(3)}->${after.p.toFixed(0).padStart(3)}  C ${before.c.toFixed(0).padStart(3)}->${after.c.toFixed(0).padStart(3)} (target ${(RATIO[slot].c * after.p).toFixed(0)})  F ${before.f.toFixed(0).padStart(3)}->${after.f.toFixed(0).padStart(3)} (target ${(RATIO[slot].f * after.p).toFixed(0)})  kcal ${after.kcal.toFixed(0)}`,
  )
}

// ---- emit ----
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const ing = (i: StarterIngredient) => {
  const [key, n, unit, label, flags] = i
  const fn = unit === 'g' ? 'g' : unit === 'ml' ? 'ml' : 'u'
  return `${fn}(${q(key)}, ${+n.toFixed(2)}, ${q(label)}${flags?.length ? `, ${JSON.stringify(flags).replace(/"/g, "'")}` : ''})`
}
const tagConst = (r: StarterRecipe) => (r.slotTags.includes('smoko') ? 'SMOKO' : r.slotTags.includes('post-workout') ? 'LUNCH' : 'DINNER')
let body = ''
let cuisine = ''
for (const r of out) {
  if (r.cuisine !== cuisine) { cuisine = r.cuisine; body += `\n  // ---------------- ${cuisine} ----------------\n` }
  body += `  { key: ${q(r.key)}, name: ${q(r.name)}, cuisine: ${q(r.cuisine)}, slotTags: ${tagConst(r)}, prepMin: ${r.prepMin}, cookMin: ${r.cookMin}, servings: ${r.servings},\n`
  body += `    ingredients: [${r.ingredients.map(ing).join(', ')}],\n`
  body += `    method: [${r.method.map(q).join(', ')}] },\n`
}

const file = `import type { QtyUnit, SlotTag } from '../db/types'

/** [foodKey, quantity, unit, label, flags?] — flags: 'cooked' (weighed cooked), 'optional'. */
export type StarterIngredient = [string, number, QtyUnit, string, Array<'cooked' | 'optional'>?]

export interface StarterRecipe {
  key: string
  name: string
  cuisine: string
  slotTags: SlotTag[]
  prepMin: number
  cookMin: number
  servings: number
  ingredients: StarterIngredient[]
  method: string[]
}

const g = (food: string, qty: number, label: string, flags?: Array<'cooked' | 'optional'>): StarterIngredient => [food, qty, 'g', label, flags]
const ml = (food: string, qty: number, label: string): StarterIngredient => [food, qty, 'ml', label]
const u = (food: string, qty: number, label: string): StarterIngredient => [food, qty, 'unit', label]

const SMOKO: SlotTag[] = ['smoko', 'pre-workout']
const LUNCH: SlotTag[] = ['lunch', 'post-workout']
const DINNER: SlotTag[] = ['dinner', 'low-carb-dinner']

/**
 * Starter library: 8 cuisines x (2 smoko, 3 post-workout lunches, 3 low-carb dinners) = 64,
 * all one serving. Balanced (24 Nov 2026) to the agreed pattern: about 150 g carbs a day
 * across smoko, lunch and dinner, fat filling the rest of the energy, and cooking fats
 * limited to ghee, coconut oil and olive oil (no seed oils). Relative to protein, each
 * meal aims at: smoko carbs 1.5x / fat 1.1x, lunch carbs 2.4x / fat 1.1x, dinner carbs
 * 0.5x / fat 1.3x. Portions are scaled to each meal's protein target when chosen.
 * Generated by scripts/rebalance-recipes.mts from the original library; edit freely.
 */
export const STARTER_RECIPES: StarterRecipe[] = [${body}]
`
writeFileSync(new URL('../src/data/recipes.ts', import.meta.url), file)
console.log(report.join('\n'))

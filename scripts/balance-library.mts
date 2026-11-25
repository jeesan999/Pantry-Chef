/**
 * Balance the recipe library drafts (src/data/library/drafts.ts) to the agreed eating pattern, the
 * same rules scripts/rebalance-recipes.mts applied to the original 64:
 *   - no seed oils; cooking fats are ghee, coconut oil or olive oil; full-fat dairy; fattier cuts at dinner
 *   - starchy ingredients scaled so carbs sit at the meal's carb-to-protein ratio
 *   - cooking fat topped up so fat sits at the meal's fat-to-protein ratio
 * Writes src/data/library/balanced.ts and prints before/after. Run: node scripts/balance-library.mts
 */
import { writeFileSync } from 'node:fs'
import { DRAFTS, type LibraryRecipe } from '../src/data/library/drafts.ts'
import type { StarterIngredient } from '../src/data/recipes.ts'
import { INTERIM_FOODS } from '../src/data/interimFoods.ts'

const foods = new Map(INTERIM_FOODS.map((f) => [f.key, f]))
const RATIO = { smoko: { c: 42 / 28, f: 30.5 / 28 }, lunch: { c: 96 / 40, f: 42.7 / 40 }, dinner: { c: 19.3 / 38, f: 48.8 / 38 } }
const CARB = new Set(['rice_white', 'rice_brown', 'pasta', 'rice_noodles', 'soba', 'oats', 'bread_wholemeal', 'wrap', 'potato', 'sweet_potato', 'quinoa', 'banana', 'honey', 'apple', 'lentils_red', 'corn', 'berries', 'couscous', 'bulgur'])
type Slot = keyof typeof RATIO
const slotOf = (r: LibraryRecipe): Slot => (r.slotTags.includes('smoko') ? 'smoko' : r.slotTags.includes('post-workout') ? 'lunch' : 'dinner')

function grams(i: StarterIngredient): number {
  const [key, q, unit] = i
  const f = foods.get(key)
  if (!f) throw new Error(`unknown food ${key}`)
  return unit === 'g' ? q : unit === 'ml' ? q * (f.densityGPerMl ?? 1) : q * (f.gramsPerUnit ?? 0)
}
function totals(ings: StarterIngredient[]) {
  let p = 0, c = 0, f = 0, cCarb = 0, kcal = 0
  for (const i of ings) {
    const n = foods.get(i[0])!.per100g
    const g = grams(i) / 100
    p += n.proteinG * g; c += n.carbsG * g; f += n.fatG * g; kcal += n.energyKcal * g
    if (CARB.has(i[0])) cCarb += n.carbsG * g
  }
  return { p, c, f, cCarb, kcal }
}
const roundQty = (q: number, unit: string) => (unit === 'unit' ? Math.max(0.5, Math.round(q * 2) / 2) : Math.max(5, Math.round(q / 5) * 5))
const FAT_NAME: Record<string, [string, string]> = { ghee: ['ghee', 'Ghee'], coconut_oil: ['coconut oil', 'Coconut oil'], olive_oil: ['olive oil', 'Olive oil'], macadamia: ['macadamia', 'Macadamias, chopped'] }

const out: LibraryRecipe[] = []
const report: string[] = []
for (const r of DRAFTS) {
  const slot = slotOf(r)
  const cookFat = ['Thai', 'Korean', 'Chinese'].includes(r.cuisine) ? 'coconut_oil' : 'ghee'
  const before = totals(r.ingredients)

  // 1. Swaps, as for the original library
  let ings: StarterIngredient[] = r.ingredients.map((i) => {
    let [key, q, unit, label, flags] = i
    const swap = (k: string, l: string) => { key = k; label = l }
    if (key === 'sesame_oil') swap(cookFat, FAT_NAME[cookFat][1])
    else if (key === 'coconut_milk_light') swap('coconut_milk', 'Coconut milk')
    else if (key === 'milk_skim') swap('milk_full', 'Full-cream milk')
    else if (key === 'beef_mince') swap('beef_mince_regular', 'Beef mince')
    else if (key === 'cheddar_light') swap('cheddar', 'Cheddar')
    else if (slot === 'dinner' && (key === 'chicken_breast' || key === 'chicken_thigh')) swap('chicken_thigh_skin', 'Chicken thigh, skin on')
    else if (slot !== 'smoko' && key === 'greek_yoghurt') swap('greek_yoghurt_full', label.replace(/^Greek yoghurt/, 'Full-fat Greek yoghurt'))
    return [key, q, unit, label, flags] as StarterIngredient
  })

  // 1b. Protein to the meal's usual level: scale everything except starch and cooking fat
  const P_TARGET = { smoko: 30, lunch: 44, dinner: 43 }[slot] // starch added later brings a little protein too
  const FATS = new Set(['ghee', 'coconut_oil', 'olive_oil', 'macadamia'])
  const p0 = totals(ings).p
  if (p0 > P_TARGET * 1.12 || p0 < P_TARGET * 0.85) {
    const f = Math.min(1.4, Math.max(0.55, P_TARGET / p0))
    ings = ings.map((i) => (CARB.has(i[0]) || FATS.has(i[0]) ? i : ([i[0], roundQty(i[1] * f, i[2]), i[2], i[3], i[4]] as StarterIngredient)))
  }

  // 2. Starch to the meal's carb ratio
  let k = 1
  for (let it = 0; it < 6; it++) {
    const t = totals(ings.map((i) => (CARB.has(i[0]) ? ([i[0], i[1] * k, i[2], i[3], i[4]] as StarterIngredient) : i)))
    const cCarbAt1 = t.cCarb / k
    if (cCarbAt1 <= 0) break
    k = Math.min(1.6, Math.max(0.3, (RATIO[slot].c * t.p - (t.c - t.cCarb)) / cCarbAt1))
  }
  ings = ings.map((i) => (CARB.has(i[0]) ? ([i[0], roundQty(i[1] * k, i[2]), i[2], i[3], i[4]] as StarterIngredient) : i))

  // 3. Fat to the meal's fat ratio: no-cook dishes get macadamias, olive-oil dishes more olive oil, others ghee / coconut oil
  const cold = r.cookMin === 0
  const source = cold ? 'macadamia' : r.ingredients.some((i) => i[0] === 'olive_oil') ? 'olive_oil' : cookFat
  const t2 = totals(ings)
  const need = RATIO[slot].f * t2.p - t2.f
  const idx = ings.findIndex((i) => i[0] === source)
  const current = idx >= 0 ? ings[idx][1] : 0
  let target = current
  if (need > 2) target = Math.min(30, Math.max(current, Math.round((current + need / (foods.get(source)!.per100g.fatG / 100)) / 5) * 5))
  // a method that names the cooking fat must have it in the list
  const [fatName, fatLabel] = FAT_NAME[source]
  if (!cold && target === 0 && r.method.some((m) => m.toLowerCase().includes(fatName))) target = 5
  if (idx >= 0) ings[idx] = [source, target, 'g', ings[idx][3], ings[idx][4]]
  else if (target > 0) ings.push([source, target, 'g', fatLabel])

  // 4. Method: name the fat; make sure an added fat is used somewhere
  let method = r.method.map((m) => m.replace(/(?<!olive |coconut |sesame )\boil\b(?! ?\w*paste)/gi, fatName).replace(/\bthe sizzling fat\b/g, `the sizzling ${fatName}`))
  const hasFat = ings.some((i) => i[0] === source && i[1] > 0)
  if (hasFat && !method.some((m) => m.toLowerCase().includes(fatName))) {
    if (cold) method = [...method, 'Scatter over the chopped macadamias.']
    else {
      const rules: Array<[RegExp, string]> = [
        [/\b(pan-cook|pan-fry|fry|brown|sear|stir-fry|sauté|scramble|soften|sizzle)/i, ` Use the ${fatName} for this.`],
        [/\b(grill|roast|bake)/i, ` Brush with the ${fatName} first.`],
        [/\btoast\b/i, ` Spread with the ${fatName}.`],
        [/\b(simmer|poach|steam|cook the rice|boil)/i, ` Stir the ${fatName} through at the end.`],
      ]
      let done = false
      for (const [re, add] of rules) {
        const i = method.findIndex((m) => re.test(m))
        if (i >= 0) {
          method[i] = method[i].replace(/\.?$/, '.') + add
          done = true
          break
        }
      }
      if (!done) method = [...method, `Finish with the ${fatName} melted over the top.`]
    }
  }

  const after = totals(ings)
  out.push({ ...r, ingredients: ings, method })
  report.push(`${slot.padEnd(6)} ${r.key.padEnd(30)} P ${before.p.toFixed(0).padStart(3)}->${after.p.toFixed(0).padStart(3)}  C ${before.c.toFixed(0).padStart(3)}->${after.c.toFixed(0).padStart(3)} (t ${(RATIO[slot].c * after.p).toFixed(0)})  F ${before.f.toFixed(0).padStart(3)}->${after.f.toFixed(0).padStart(3)} (t ${(RATIO[slot].f * after.p).toFixed(0)})  kcal ${after.kcal.toFixed(0)}`)
}

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const ing = (i: StarterIngredient) => {
  const [key, n, unit, label, flags] = i
  const fn = unit === 'g' ? 'g' : unit === 'ml' ? 'ml' : 'u'
  return `${fn}(${q(key)}, ${+n.toFixed(2)}, ${q(label)}${flags?.length ? `, ${JSON.stringify(flags).replace(/"/g, "'")}` : ''})`
}
const tags = (r: LibraryRecipe) => (r.slotTags.includes('breakfast') ? 'SB' : r.slotTags.includes('smoko') ? 'S' : r.slotTags.includes('post-workout') ? 'L' : 'D')
let body = ''
let cuisine = ''
for (const r of out) {
  if (r.cuisine !== cuisine) { cuisine = r.cuisine; body += `\n  // ---------------- ${cuisine} ----------------\n` }
  body += `  { key: ${q(r.key)}, name: ${q(r.name)}, cuisine: ${q(r.cuisine)}, slotTags: ${tags(r)}, protein: ${q(r.protein)}, technique: ${q(r.technique)}, prepMin: ${r.prepMin}, cookMin: ${r.cookMin}, servings: 1,\n`
  body += `    ingredients: [${r.ingredients.map(ing).join(', ')}],\n`
  body += `    method: [${r.method.map(q).join(', ')}] },\n`
}
writeFileSync('src/data/library/balanced.ts', `/** Generated by scripts/balance-library.mts from library/drafts.ts. Edit the drafts and re-run, not this file. */
import type { SlotTag } from '../../db/types'
import type { StarterIngredient } from '../recipes'
import type { LibraryRecipe } from './drafts'

const g = (food: string, qty: number, label: string, flags?: Array<'cooked' | 'optional'>): StarterIngredient => [food, qty, 'g', label, flags]
const ml = (food: string, qty: number, label: string): StarterIngredient => [food, qty, 'ml', label]
const u = (food: string, qty: number, label: string): StarterIngredient => [food, qty, 'unit', label]
const S: SlotTag[] = ['smoko', 'pre-workout']
const SB: SlotTag[] = ['smoko', 'pre-workout', 'breakfast']
const L: SlotTag[] = ['lunch', 'post-workout']
const D: SlotTag[] = ['dinner', 'low-carb-dinner']

export const LIBRARY_RECIPES: LibraryRecipe[] = [${body}]
`)
console.log(report.join('\n'))

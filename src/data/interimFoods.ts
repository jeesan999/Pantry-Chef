/**
 * INTERIM food values, approximate, from general reference knowledge, NOT from AFCD.
 * They exist only so recipes can be costed and checked before the AFCD Release 3 file is
 * imported. Each row lists the AFCD food it should be replaced by; the import overwrites
 * the nutrients in place (same id), so recipes never need editing.
 *
 * Columns: key, name, state, kcal, protein, fat, satFat, carbs, sugars, addedSugar, fibre,
 * sodiumMg, gramsPerUnit?, densityGPerMl?, afcdSearch (words the AFCD name must contain).
 */
import type { Food } from '../db/types'

type Row = [string, string, Food['state'], number, number, number, number, number, number, number, number, number, number | null, number | null, string]

const ROWS: Row[] = [
  ['egg', 'Egg, chicken, whole, raw', 'raw', 138, 12.6, 9.5, 2.9, 0.4, 0.4, 0, 0, 140, 51, null, 'egg chicken whole raw'],
  ['avocado', 'Avocado, raw', 'raw', 199, 1.9, 20, 4.2, 0.5, 0.4, 0, 3, 4, 170, null, 'avocado raw'],
  ['bacon_middle', 'Bacon, middle rasher, raw', 'raw', 228, 17, 17.6, 6.6, 0.5, 0.5, 0, 0, 1300, 45, null, 'bacon middle rasher raw'],
  ['ghee', 'Ghee', 'na', 899, 0.2, 99.8, 63, 0, 0, 0, 0, 2, null, 0.91, 'ghee'],
  ['chicken_breast', 'Chicken, breast, lean flesh, raw', 'raw', 110, 23.5, 1.6, 0.5, 0, 0, 0, 0, 55, null, null, 'chicken breast lean raw'],
  ['chicken_thigh', 'Chicken, thigh, lean flesh, raw', 'raw', 125, 20, 5, 1.4, 0, 0, 0, 0, 80, null, null, 'chicken thigh lean raw'],
  ['beef_mince', 'Beef, mince, lean (5 star), raw', 'raw', 137, 21.5, 5.5, 2.3, 0, 0, 0, 0, 65, null, null, 'beef mince lean raw'],
  ['beef_rump', 'Beef, rump steak, lean, raw', 'raw', 125, 23, 3.5, 1.4, 0, 0, 0, 0, 55, null, null, 'beef rump lean raw'],
  ['lamb_leg', 'Lamb, leg, lean, raw', 'raw', 125, 21.5, 4.3, 1.8, 0, 0, 0, 0, 65, null, null, 'lamb leg lean raw'],
  ['pork_fillet', 'Pork, fillet, lean, raw', 'raw', 110, 22, 2.2, 0.8, 0, 0, 0, 0, 55, null, null, 'pork fillet lean raw'],
  ['salmon', 'Salmon, Atlantic, raw', 'raw', 200, 20, 13, 3, 0, 0, 0, 0, 50, null, null, 'salmon atlantic raw'],
  ['barramundi', 'Barramundi, raw', 'raw', 95, 20, 1.5, 0.5, 0, 0, 0, 0, 60, null, null, 'barramundi raw'],
  ['prawns', 'Prawn, king, raw', 'raw', 85, 19.5, 0.8, 0.2, 0, 0, 0, 0, 200, null, null, 'prawn raw'],
  ['tuna_canned', 'Tuna, canned in brine, drained', 'na', 110, 25, 1, 0.3, 0, 0, 0, 0, 300, null, null, 'tuna canned brine drained'],
  ['tofu_firm', 'Tofu, firm', 'na', 130, 13, 7.5, 1.1, 1.5, 0.5, 0, 1.2, 10, null, null, 'tofu firm'],
  ['greek_yoghurt', 'Yoghurt, Greek style, natural, low fat', 'na', 62, 9.5, 0.5, 0.3, 4, 4, 0, 0, 45, null, 1.03, 'yoghurt greek natural'],
  ['cottage_cheese', 'Cheese, cottage, low fat', 'na', 85, 12.5, 2, 1.3, 3, 3, 0, 0, 300, null, null, 'cheese cottage'],
  ['milk_skim', 'Milk, cow, fluid, skim', 'na', 35, 3.6, 0.1, 0.1, 5, 5, 0, 0, 45, null, 1.03, 'milk cow fluid skim'],
  ['feta', 'Cheese, feta, reduced fat', 'na', 230, 22, 15, 9.5, 0, 0, 0, 0, 1000, null, null, 'cheese feta'],
  ['parmesan', 'Cheese, parmesan', 'na', 400, 35, 28, 18, 0, 0, 0, 0, 1500, null, null, 'cheese parmesan'],
  ['cheddar_light', 'Cheese, cheddar, reduced fat', 'na', 310, 31, 20, 12.5, 0, 0, 0, 0, 750, null, null, 'cheese cheddar reduced fat'],
  ['whey', 'Protein powder, whey isolate', 'na', 370, 88, 1, 0.5, 3, 2, 0, 0, 200, null, null, 'protein powder whey'],
  ['rice_white', 'Rice, white, raw', 'raw', 355, 7, 0.6, 0.2, 79, 0.1, 0, 1, 2, null, null, 'rice white raw'],
  ['rice_brown', 'Rice, brown, raw', 'raw', 355, 7.8, 2.5, 0.6, 74, 0.5, 0, 3.2, 4, null, null, 'rice brown raw'],
  ['oats', 'Oats, rolled, raw', 'raw', 375, 11.5, 8.5, 1.5, 56, 1, 0, 10, 5, null, null, 'oats rolled raw'],
  ['pasta', 'Pasta, wheat, dry', 'raw', 355, 12.5, 1.5, 0.3, 70, 2.5, 0, 3.5, 5, null, null, 'pasta dry'],
  ['rice_noodles', 'Noodle, rice, dry', 'raw', 360, 6, 0.5, 0.1, 81, 0, 0, 1.5, 50, null, null, 'noodle rice dry'],
  ['soba', 'Noodle, soba (buckwheat), dry', 'raw', 340, 13, 1, 0.2, 68, 2, 0, 3.5, 800, null, null, 'noodle buckwheat'],
  ['bread_wholemeal', 'Bread, wholemeal', 'na', 240, 10, 3, 0.6, 39, 3, 1, 7, 400, 38, null, 'bread wholemeal'],
  ['wrap', 'Tortilla wrap, wholemeal', 'na', 290, 8.5, 6.5, 2.5, 45, 2, 1, 5.5, 500, 60, null, 'tortilla wholemeal'],
  ['sweet_potato', 'Sweet potato, orange, raw', 'raw', 80, 1.5, 0.1, 0, 16, 6, 0, 3, 40, null, null, 'sweet potato orange raw'],
  ['potato', 'Potato, white, unpeeled, raw', 'raw', 75, 2.3, 0.1, 0, 15, 0.6, 0, 2, 5, null, null, 'potato unpeeled raw'],
  ['quinoa', 'Quinoa, uncooked', 'raw', 360, 14, 6, 0.6, 58, 3, 0, 7, 5, null, null, 'quinoa uncooked'],
  ['lentils_red', 'Lentil, red, dried', 'raw', 330, 24, 1.5, 0.2, 48, 2, 0, 11, 10, null, null, 'lentil red dried'],
  ['chickpeas', 'Chickpea, canned, drained', 'na', 130, 7, 2.4, 0.3, 15, 0.5, 0, 6, 250, null, null, 'chickpea canned drained'],
  ['black_beans', 'Bean, black, canned, drained', 'na', 115, 7.5, 0.5, 0.1, 15, 0.3, 0, 7, 250, null, null, 'bean black'],
  ['corn', 'Sweet corn, kernels, frozen', 'raw', 95, 3, 1.5, 0.2, 16, 5, 0, 3, 5, null, null, 'sweet corn kernels'],
  ['broccoli', 'Broccoli, raw', 'raw', 30, 4, 0.4, 0.1, 1.5, 1.3, 0, 3.5, 15, null, null, 'broccoli raw'],
  ['spinach', 'Spinach, raw', 'raw', 23, 2.5, 0.4, 0.1, 0.8, 0.5, 0, 2.5, 60, null, null, 'spinach raw'],
  ['capsicum', 'Capsicum, red, raw', 'raw', 30, 1, 0.3, 0.1, 5, 4.5, 0, 1.5, 3, 150, null, 'capsicum red raw'],
  ['onion', 'Onion, brown, raw', 'raw', 35, 1.5, 0.1, 0, 5.5, 4.5, 0, 1.8, 3, 150, null, 'onion raw'],
  ['spring_onion', 'Spring onion, raw', 'raw', 30, 1.8, 0.3, 0, 4, 2.5, 0, 2.5, 10, 15, null, 'spring onion raw'],
  ['garlic', 'Garlic, raw', 'raw', 140, 6.5, 0.5, 0.1, 25, 1, 0, 4, 10, 4, null, 'garlic raw'],
  ['ginger', 'Ginger, raw', 'raw', 70, 1.8, 0.8, 0.2, 15, 1.7, 0, 2, 13, null, null, 'ginger raw'],
  ['chilli', 'Chilli, fresh, raw', 'raw', 40, 2, 0.4, 0, 7, 5, 0, 1.5, 9, 10, null, 'chilli raw'],
  ['tomato', 'Tomato, common, raw', 'raw', 18, 0.9, 0.2, 0, 2.5, 2.5, 0, 1.2, 5, 120, null, 'tomato common raw'],
  ['tomato_canned', 'Tomato, canned, no added salt', 'na', 22, 1.2, 0.2, 0, 3, 3, 0, 1.3, 20, null, null, 'tomato canned'],
  ['carrot', 'Carrot, raw', 'raw', 33, 0.8, 0.2, 0, 6, 5, 0, 3, 40, 120, null, 'carrot raw'],
  ['zucchini', 'Zucchini, raw', 'raw', 17, 1.5, 0.2, 0, 1.5, 1.5, 0, 1.2, 3, 200, null, 'zucchini raw'],
  ['mushroom', 'Mushroom, common, raw', 'raw', 25, 3.5, 0.3, 0, 0.3, 0.2, 0, 2, 5, null, null, 'mushroom common raw'],
  ['cucumber', 'Cucumber, raw', 'raw', 12, 0.6, 0.1, 0, 2, 2, 0, 0.7, 3, null, null, 'cucumber raw'],
  ['lettuce', 'Lettuce, cos, raw', 'raw', 14, 1.3, 0.2, 0, 1.2, 1.2, 0, 1.3, 10, null, null, 'lettuce cos raw'],
  ['cabbage', 'Cabbage, raw', 'raw', 22, 1.3, 0.1, 0, 3, 3, 0, 2.5, 15, null, null, 'cabbage raw'],
  ['green_beans', 'Bean, green, raw', 'raw', 25, 1.9, 0.2, 0, 2.5, 2, 0, 3, 3, null, null, 'bean green raw'],
  ['bok_choy', 'Bok choy, raw', 'raw', 13, 1.5, 0.2, 0, 1, 1, 0, 1.5, 60, null, null, 'bok choy raw'],
  ['cauliflower', 'Cauliflower, raw', 'raw', 25, 2.2, 0.2, 0, 2, 2, 0, 2.5, 15, null, null, 'cauliflower raw'],
  ['eggplant', 'Eggplant, raw', 'raw', 20, 1.2, 0.2, 0, 2.5, 2.3, 0, 2.5, 2, null, null, 'eggplant raw'],
  ['peas', 'Pea, green, frozen', 'raw', 70, 5.5, 0.4, 0.1, 9, 4, 0, 5, 3, null, null, 'pea green frozen'],
  ['banana', 'Banana, cavendish, peeled, raw', 'raw', 90, 1.3, 0.3, 0.1, 20, 17, 0, 2.4, 1, 120, null, 'banana cavendish raw'],
  ['berries', 'Berries, mixed, frozen', 'raw', 45, 1, 0.3, 0, 7, 6, 0, 4, 2, null, null, 'berry mixed frozen'],
  ['apple', 'Apple, red skin, unpeeled, raw', 'raw', 55, 0.3, 0.1, 0, 12, 11, 0, 2.3, 1, 150, null, 'apple red unpeeled raw'],
  ['lemon_juice', 'Lemon, juice, fresh', 'na', 25, 0.4, 0.2, 0, 2.5, 2.5, 0, 0, 1, null, 1.03, 'lemon juice'],
  ['lime_juice', 'Lime, juice, fresh', 'na', 25, 0.4, 0.1, 0, 2, 1.7, 0, 0, 1, null, 1.03, 'lime juice'],
  ['olive_oil', 'Oil, olive', 'na', 884, 0, 100, 14, 0, 0, 0, 0, 0, null, 0.92, 'oil olive'],
  ['sesame_oil', 'Oil, sesame', 'na', 884, 0, 100, 14.5, 0, 0, 0, 0, 0, null, 0.92, 'oil sesame'],
  ['peanut_butter', 'Peanut butter, smooth, no added salt', 'na', 620, 25, 51, 9, 10, 5, 2, 8, 10, null, null, 'peanut butter'],
  ['almonds', 'Almond, with skin, raw', 'raw', 600, 20, 53, 4, 5, 4.5, 0, 9, 2, null, null, 'almond raw'],
  ['walnuts', 'Walnut, raw', 'raw', 690, 15, 69, 6, 3, 2.5, 0, 6, 2, null, null, 'walnut raw'],
  ['chia', 'Chia seed, dried', 'raw', 490, 17, 31, 3.5, 2, 0, 0, 34, 15, null, null, 'chia seed'],
  ['honey', 'Honey', 'na', 310, 0.4, 0, 0, 80, 80, 80, 0, 10, null, 1.42, 'honey'],
  ['soy_sauce', 'Sauce, soy, reduced salt', 'na', 60, 8, 0, 0, 6, 3, 2, 0, 3500, null, 1.1, 'sauce soy reduced salt'],
  ['fish_sauce', 'Sauce, fish', 'na', 40, 5.5, 0, 0, 4, 4, 4, 0, 7800, null, 1.2, 'sauce fish'],
  ['curry_paste', 'Curry paste, red', 'na', 200, 3, 15, 2, 10, 5, 3, 4, 2500, null, null, 'curry paste'],
  ['coconut_milk_light', 'Coconut milk, reduced fat, canned', 'na', 110, 1, 10, 9, 2.5, 2, 0, 0, 15, null, 1.0, 'coconut milk reduced fat'],
  ['stock', 'Stock, chicken, liquid, reduced salt', 'na', 5, 0.7, 0.1, 0, 0.3, 0.3, 0, 0, 300, null, 1.0, 'stock chicken'],
  ['hummus', 'Dip, hummus', 'na', 270, 7.5, 21, 2.3, 10, 1, 0, 6, 400, null, null, 'hummus'],
  ['salsa', 'Sauce, salsa, tomato based', 'na', 35, 1.3, 0.2, 0, 6, 4.5, 1, 1.5, 450, null, null, 'salsa'],
  ['pesto', 'Sauce, pesto, basil', 'na', 450, 5, 45, 7, 4, 1.5, 0, 2, 700, null, null, 'pesto'],
  ['miso', 'Paste, miso', 'na', 200, 12, 6, 1, 22, 6, 0, 5, 3700, null, null, 'miso'],
  ['kimchi', 'Kimchi', 'na', 25, 1.5, 0.4, 0, 3, 2, 0, 2, 600, null, null, 'kimchi'],
  ['spice_mix', 'Spices, mixed, dried', 'na', 300, 12, 10, 1, 30, 5, 0, 25, 50, null, null, 'spice'],
  ['herbs', 'Herbs, fresh (coriander, parsley, basil)', 'raw', 30, 2.5, 0.5, 0, 1, 0.8, 0, 3, 30, null, null, 'coriander raw'],
  ['passata', 'Tomato, passata', 'na', 30, 1.5, 0.2, 0, 5, 4.5, 0, 1.5, 15, null, 1.03, 'tomato puree'],
  // Added 24 Nov 2026: cooking fats (no vegetable or seed oils), full-fat dairy, fattier cuts.
  ['coconut_oil', 'Oil, coconut', 'na', 892, 0, 99.1, 82.5, 0, 0, 0, 0, 0, null, 0.92, 'oil coconut'],
  ['cream', 'Cream, pure (35% fat)', 'na', 340, 2.2, 35, 23, 3, 3, 0, 0, 30, null, 1.0, 'cream pure'],
  ['milk_full', 'Milk, cow, fluid, regular fat', 'na', 65, 3.4, 3.5, 2.3, 4.7, 4.7, 0, 0, 40, null, 1.03, 'milk cow fluid regular fat'],
  ['greek_yoghurt_full', 'Yoghurt, Greek style, natural, full fat', 'na', 130, 6, 10, 6.6, 4.5, 4.5, 0, 0, 45, null, 1.03, 'yoghurt greek full fat'],
  ['cheddar', 'Cheese, cheddar, natural', 'na', 400, 25, 33, 21, 0, 0, 0, 0, 650, null, null, 'cheese cheddar natural'],
  ['beef_mince_regular', 'Beef, mince, regular fat, raw', 'raw', 220, 19, 16, 6.5, 0, 0, 0, 0, 70, null, null, 'beef mince regular raw'],
  ['chicken_thigh_skin', 'Chicken, thigh, flesh and skin, raw', 'raw', 210, 17.5, 15.5, 4.5, 0, 0, 0, 0, 80, null, null, 'chicken thigh flesh skin raw'],
  ['lamb_chop', 'Lamb, loin chop, lean and fat, raw', 'raw', 260, 17.5, 21, 9.5, 0, 0, 0, 0, 65, null, null, 'lamb loin chop lean fat raw'],
  ['pork_shoulder', 'Pork, shoulder, lean and fat, raw', 'raw', 215, 18, 16, 5.8, 0, 0, 0, 0, 65, null, null, 'pork shoulder lean fat raw'],
  ['coconut_milk', 'Coconut milk, canned', 'na', 200, 1.9, 20, 17.5, 3, 2.5, 0, 0, 15, null, 1.0, 'coconut milk canned'],
  ['macadamia', 'Macadamia nut, raw', 'raw', 740, 9, 76, 12, 4.5, 4, 0, 6.5, 2, null, null, 'macadamia raw'],
]

export const INTERIM_FOOD_ID = (key: string) => `food:${key}`

export interface InterimFood extends Food {
  key: string
  afcdSearch: string
}

export const INTERIM_FOODS: InterimFood[] = ROWS.map((r) => {
  const [key, name, state, kcal, protein, fat, sat, carbs, sugars, added, fibre, sodium, gpu, density, afcdSearch] = r
  return {
    id: INTERIM_FOOD_ID(key),
    key,
    afcdSearch,
    name,
    source: 'interim',
    state,
    ediblePortion: 1,
    per100g: {
      energyKcal: kcal,
      energyKj: Math.round(kcal * 4.184),
      proteinG: protein,
      fatG: fat,
      satFatG: sat,
      carbsG: carbs,
      sugarsG: sugars,
      addedSugarG: added,
      fibreG: fibre,
      sodiumMg: sodium,
    },
    gramsPerUnit: gpu ?? undefined,
    densityGPerMl: density ?? undefined,
    updatedAt: '2026-11-24T00:00:00.000Z',
  }
})

/** Raw-to-cooked weight factors (cooked weight / raw weight), approximate until checked against AFCD. */
export const INTERIM_YIELDS: Array<{ key: string; method: string; factor: number }> = [
  ['rice_white', 'boiled', 2.8],
  ['rice_brown', 'boiled', 2.5],
  ['pasta', 'boiled', 2.4],
  ['quinoa', 'boiled', 2.7],
  ['lentils_red', 'boiled', 2.5],
  ['rice_noodles', 'soaked', 2.4],
  ['chicken_breast', 'grilled', 0.75],
  ['beef_mince', 'pan-fried', 0.72],
  ['potato', 'baked', 0.85],
  ['sweet_potato', 'baked', 0.8],
].map(([key, method, factor]) => ({ key: key as string, method: method as string, factor: factor as number }))

/**
 * Foods that can stand in for each other in a recipe, grouped by the job they do. A substitute is
 * offered only from the same group, and only when it's in the pantry. Swaps are weight for weight.
 */
export const SUBSTITUTE_GROUPS: Record<string, string[]> = {
  'green vegetables': ['broccoli', 'green_beans', 'bok_choy', 'spinach', 'zucchini', 'peas', 'cabbage', 'cauliflower', 'capsicum', 'veg_mix_frozen'],
  'salad vegetables': ['lettuce', 'cucumber', 'tomato', 'spinach', 'capsicum', 'cabbage'],
  'root vegetables': ['potato', 'sweet_potato', 'carrot'],
  'rice and grains': ['rice_white', 'rice_brown', 'quinoa'],
  'noodles and pasta': ['pasta', 'rice_noodles', 'soba'],
  'bread and wraps': ['bread_wholemeal', 'wrap'],
  'lean poultry': ['chicken_breast', 'chicken_thigh', 'chicken_thigh_skin'],
  'red meat': ['beef_rump', 'lamb_leg', 'pork_fillet', 'beef_mince', 'beef_mince_regular'],
  mince: ['beef_mince', 'beef_mince_regular'],
  'white fish and seafood': ['barramundi', 'prawns', 'salmon'],
  'canned fish': ['tuna_canned', 'salmon_canned'],
  legumes: ['chickpeas', 'black_beans', 'lentils_red'],
  'soft cheese': ['cottage_cheese', 'ricotta', 'feta'],
  'hard cheese': ['cheddar', 'cheddar_light', 'parmesan', 'mozzarella'],
  yoghurt: ['greek_yoghurt', 'greek_yoghurt_full'],
  milk: ['milk_skim', 'milk_full'],
  'cooking oil': ['olive_oil', 'coconut_oil', 'ghee', 'butter'],
  citrus: ['lemon_juice', 'lime_juice'],
  alliums: ['onion', 'spring_onion'],
  nuts: ['almonds', 'walnuts', 'macadamia'],
  'tomato base': ['passata', 'tomato_canned'],
  'creamy coconut': ['coconut_milk', 'coconut_milk_light', 'coconut_cream'],
  'chilli heat': ['chilli', 'sriracha', 'gochujang', 'sweet_chilli'],
  vinegar: ['vinegar', 'balsamic'],
  fruit: ['banana', 'berries', 'apple'],
}

const groupsOf = new Map<string, string[]>()
for (const [g, keys] of Object.entries(SUBSTITUTE_GROUPS)) for (const k of keys) groupsOf.set(`food:${k}`, [...(groupsOf.get(`food:${k}`) ?? []), g])

/** Foods that can replace this one (same group), excluding itself. */
export function substitutesFor(foodId: string): Array<{ foodId: string; group: string }> {
  const out: Array<{ foodId: string; group: string }> = []
  const seen = new Set<string>([foodId])
  for (const g of groupsOf.get(foodId) ?? []) {
    for (const k of SUBSTITUTE_GROUPS[g]) {
      const id = `food:${k}`
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ foodId: id, group: g })
      }
    }
  }
  return out
}

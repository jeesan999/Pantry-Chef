/**
 * Type-ahead for entering groceries by hand: what you have bought before first, then the
 * food list (AFCD and interim foods). Matches the start of words, so "chick" finds chicken,
 * "soy" finds soy sauce and "ketch" finds tomato sauce.
 */
import type { Food, Product } from '../db/types'

// Food-name lead words that read better after the variety: "Sauce, soy" -> "Soy sauce".
const GROUP_WORDS = new Set(['sauce', 'oil', 'cheese', 'noodle', 'paste', 'vinegar', 'syrup', 'lentil', 'bean', 'nut', 'seed', 'cream', 'stock', 'dip', 'spices', 'herbs', 'jam', 'curry'])
const DESCRIPTORS = /^(raw|dry|dried|fresh|canned|fluid|uncooked|natural|peeled|unpeeled|lean|lean flesh|flesh|frozen|cow|common|liquid|with skin|whole|regular fat|reduced fat|low fat|full fat|drained|sliced)$/i

/** "Chicken, breast, lean flesh, raw" -> "Chicken breast"; "Sauce, soy, reduced salt" -> "Soy sauce, reduced salt". */
export function displayName(foodName: string): string {
  const parts = foodName.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 1) return parts[0]
  const [head, second, ...rest] = parts
  const keepRest = rest.filter((p) => !DESCRIPTORS.test(p) && !/\braw\b/i.test(p))
  let main: string
  if (/^egg$/i.test(head) && /^chicken$/i.test(second)) return 'Eggs'
  if (/^(salsa|pesto|hummus)$/i.test(second)) return second[0].toUpperCase() + second.slice(1)
  if (/^(white|brown|red|green|black|wholemeal|orange|yellow|purple)$/i.test(second)) {
    main = `${second} ${head.toLowerCase()}`
    main = main[0].toUpperCase() + main.slice(1)
  } else if (GROUP_WORDS.has(head.toLowerCase().replace(/s$/, '')) || GROUP_WORDS.has(head.toLowerCase())) {
    main = `${second.replace(/\s*\(.*\)/, '')} ${head.toLowerCase()}`
    main = main[0].toUpperCase() + main.slice(1)
  } else if (DESCRIPTORS.test(second)) {
    main = head
  } else {
    main = `${head} ${second.toLowerCase()}`
  }
  const extra = keepRest.filter((p) => /reduced salt|no added salt|full fat|light|wholemeal|brown|white|red|green/i.test(p))
  return extra.length ? `${main}, ${extra.join(', ').toLowerCase()}` : main
}

/** Everyday names, keyed by interim food key. */
export const ALIASES: Record<string, string[]> = {
  tomato_sauce: ['ketchup', 'sauce'],
  bbq_sauce: ['bbq', 'barbie'],
  mayonnaise: ['mayo'],
  sweet_chilli: ['sweet chili'],
  sriracha: ['hot sauce', 'chili sauce'],
  olive_oil: ['evoo', 'extra virgin'],
  beef_mince: ['mince', 'premium mince', '5 star mince'],
  beef_mince_regular: ['mince', '3 star mince'],
  sausage_beef: ['snags', 'sausages', 'bangers'],
  chicken_breast: ['chicken fillets'],
  chicken_thigh: ['thigh fillets'],
  chicken_thigh_skin: ['chicken thighs'],
  prawns: ['shrimp'],
  capsicum: ['pepper', 'bell pepper'],
  zucchini: ['courgette'],
  eggplant: ['aubergine'],
  spring_onion: ['shallots', 'scallions'],
  sweet_potato: ['kumara'],
  coriander: ['cilantro'],
  herbs: ['coriander', 'parsley', 'basil', 'mint', 'cilantro'],
  rice_white: ['jasmine', 'basmati', 'sushi rice', 'arborio'],
  rice_noodles: ['vermicelli', 'rice sticks'],
  greek_yoghurt: ['yogurt', 'chobani'],
  greek_yoghurt_full: ['yogurt'],
  milk_full: ['full cream milk'],
  milk_skim: ['skim milk', 'lite milk'],
  cream: ['thickened cream', 'pure cream'],
  whey: ['protein powder', 'wpi'],
  passata: ['tomato puree'],
  tomato_canned: ['diced tomatoes', 'tinned tomatoes'],
  chickpeas: ['garbanzo'],
  wrap: ['tortilla', 'pita', 'flatbread'],
  bread_wholemeal: ['bread', 'loaf'],
  veg_mix_frozen: ['frozen veg', 'stir fry mix'],
  dark_chocolate: ['chocolate'],
  stock: ['broth'],
  coconut_milk: ['coconut milk'],
  bok_choy: ['pak choy', 'buk choy'],
  oats: ['porridge', 'rolled oats'],
}

export type ItemHit =
  | { kind: 'product'; product: Product; label: string; score: number }
  | { kind: 'food'; food: Food; label: string; score: number }

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** Score one candidate. Every typed word must start a word in the candidate (or appear inside one, scored lower). */
function scoreText(query: string[], text: string[]): number {
  let score = 0
  for (const q of query) {
    let best = 0
    for (const w of text) {
      if (w === q) best = Math.max(best, 3)
      else if (w.startsWith(q)) best = Math.max(best, 2)
      else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 1)
    }
    if (best === 0) return 0
    score += best
  }
  return score
}

export function searchItems(query: string, products: Product[], foods: Food[], limit = 12): ItemHit[] {
  const q = words(query)
  if (q.length === 0) return []
  const hits: ItemHit[] = []
  const linkedFoods = new Set<string>()
  for (const p of products) {
    const s = scoreText(q, words(`${p.name} ${p.brand ?? ''}`))
    if (s > 0) {
      hits.push({ kind: 'product', product: p, label: p.name, score: s + 1.5 }) // what you buy comes first
      if (p.foodId) linkedFoods.add(p.foodId)
    }
  }
  for (const f of foods) {
    if (linkedFoods.has(f.id)) continue // already offered as one of your products
    const key = f.id.startsWith('food:') ? f.id.slice(5) : ''
    const label = displayName(f.name)
    const aliasText = (ALIASES[key] ?? []).join(' ')
    const s = Math.max(scoreText(q, words(label)) + 0.5, scoreText(q, words(`${f.name} ${aliasText}`)))
    if (s > 0.5) hits.push({ kind: 'food', food: f, label, score: s })
  }
  return hits
    .sort((a, b) => b.score - a.score || a.label.length - b.label.length)
    .slice(0, limit)
}

// Order matters: "fish sauce" is a sauce, "chicken stock" a stock, "coconut cream" a tin.
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\bsauce\b|\boil\b|vinegar|paste|mayonnaise|mustard|syrup|honey|\bjam\b|tahini|miso|stock|salsa|pesto|hummus|dip\b/i, 'Oils & sauces'],
  [/coconut (milk|cream)|canned|tinned|passata/i, 'Tins & jars'],
  [/chicken|beef|lamb|pork|mince|sausage|bacon|\bham\b|salmon|tuna|prawn|barramundi|fish|steak/i, 'Meat & seafood'],
  [/\begg|milk|yoghurt|cheese|cream|butter|ghee/i, 'Dairy & eggs'],
  [/rice|pasta|noodle|oats|bread|wrap|tortilla|quinoa|lentil|flour/i, 'Grains & bread'],
  [/canned|tinned|passata|chickpea|bean/i, 'Tins & jars'],
  [/nut|almond|walnut|macadamia|seed|chia/i, 'Nuts & seeds'],
  [/frozen/i, 'Frozen'],
  [/apple|banana|berr|lemon|lime|avocado|tomato|onion|garlic|ginger|chilli|capsicum|carrot|broccoli|spinach|lettuce|cabbage|cucumber|zucchini|mushroom|potato|cauliflower|eggplant|bean|pea|corn|herb|choy|vegetable/i, 'Fruit & veg'],
]

export function guessCategory(name: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat
  return 'Other'
}

export function guessStorage(category: string, name: string): Product['storage'] {
  if (/frozen/i.test(name) || category === 'Frozen') return 'freezer'
  if (category === 'Meat & seafood' && !/canned/i.test(name)) return 'fridge'
  if (category === 'Dairy & eggs' && !/ghee/i.test(name)) return 'fridge'
  if (category === 'Fruit & veg' && /spinach|lettuce|broccoli|mushroom|herb|choy|zucchini|capsicum|cucumber|berr/i.test(name)) return 'fridge'
  return 'pantry'
}

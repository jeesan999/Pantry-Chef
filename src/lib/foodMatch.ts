/**
 * Link a product name as bought ("Chicken Breast Fillets 1kg", "Macro Wholefoods Ghee") to the
 * food it is nutritionally. Token overlap with food names, plus a few everyday synonyms.
 * Anything unmatched still becomes a product; the link can be set or changed by hand.
 */
import type { Food } from '../db/types'

const STOP = new Set([
  'fresh', 'free', 'range', 'organic', 'australian', 'aus', 'premium', 'select', 'pack', 'packet', 'bag', 'tub', 'jar',
  'can', 'tin', 'bottle', 'kg', 'g', 'ml', 'l', 'pk', 'x', 'each', 'ea', 'large', 'small', 'medium', 'value', 'home',
  'brand', 'the', 'and', 'with', 'of', 'in', 'fillets', 'fillet', 'pieces', 'piece', 'portions', 'family', 'style', 'natural',
  'woolworths', 'coles', 'aldi', 'iga', 'macro', 'essentials', 'smart', 'buy', 'own', 'raw', 'whole',
  'washed', 'brushed', 'unwashed', 'loose', 'punnet', 'bunch', 'prepacked', 'prepack', 'gourmet', 'aust', 'australia', 'ww', 'est', 'per', 'net',
])

// everyday word -> words that appear in the food name
const SYNONYMS: Record<string, string[]> = {
  mince: ['mince'],
  chook: ['chicken'],
  snags: ['sausage'],
  spud: ['potato'],
  spuds: ['potato'],
  kumara: ['sweet', 'potato'],
  capsicums: ['capsicum'],
  shallots: ['spring', 'onion'],
  scallions: ['spring', 'onion'],
  courgette: ['zucchini'],
  aubergine: ['eggplant'],
  prawn: ['prawn'],
  yogurt: ['yoghurt'],
  evoo: ['oil', 'olive'],
  thickened: ['cream'],
  cream: ['cream'],
  pak: ['bok'],
  choy: ['choy'],
  vermicelli: ['noodle', 'rice'],
  oats: ['oats'],
  // rice varieties are all white rice nutritionally
  jasmine: ['white'],
  basmati: ['white'],
  arborio: ['white'],
  sushi: ['white'],
  calrose: ['white'],
  rolled: ['oats'],
  passata: ['passata'],
}

/** potatoes -> potato, tomatoes -> tomato, peaches -> peach, carrots -> carrot, berries -> berry. */
function singular(w: string): string {
  if (w.length <= 3) return w
  if (w.endsWith('oes')) return w.slice(0, -2)
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|pk|x)\b/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(singular)
}

export interface FoodMatch {
  food: Food
  score: number // 0..1, balanced word overlap between product and food names
}

export function bestFoodMatch(productName: string, foods: Food[]): FoodMatch | null {
  const want = tokens(productName).flatMap((w) => SYNONYMS[w] ?? [w])
  if (want.length === 0) return null
  let best: FoodMatch | null = null
  for (const f of foods) {
    const have = new Set(tokens(f.name.replace(/\(.*?\)/g, ' ')))
    // also match the bracketed words, e.g. "(5 star)"
    for (const w of tokens(f.name)) have.add(w)
    // AFCD-style names lead with the main food ("Egg, chicken, ..."): those words must all be on the
    // receipt, so "Chicken Twisties" never becomes an egg and "Potatoes" never a sweet potato.
    const head = tokens(f.name.split(',')[0].replace(/\(.*?\)/g, ' '))
    if (head.length === 0 || !head.every((w) => want.includes(w))) continue
    const hits = want.filter((w) => have.has(w)).length
    if (hits === 0) continue
    // balanced overlap (F1): brand words on the receipt and extra words in the food name both cost a little
    let score = (2 * hits) / (want.length + have.size)
    if (f.state === 'raw' || f.state === 'na') score += 0.01
    if (!best || score > best.score) best = { food: f, score }
  }
  return best && best.score >= 0.45 ? best : null
}

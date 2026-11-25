/**
 * Engine E (Chef): a rule-based interpreter. Text in, a structured intent out. No AI service,
 * no network, no database: the caller resolves names (recipes, foods) and acts on the intent.
 */
import type { QtyUnit, RatingFlag } from '../../db/types'
import type { SlotName } from '../contract'
import { normalise, stripFiller } from './normalise'
import { parseWhen } from './when'

export type Intent =
  | { type: 'help' }
  | { type: 'swap'; date: string; slot?: SlotName; withFood?: string }
  | { type: 'set'; date: string; slot?: SlotName; recipe: string }
  | { type: 'clear'; date: string; slot?: SlotName }
  | { type: 'dayType'; date: string; dayType: 'training' | 'rest'; start?: string }
  | { type: 'usual'; date: string }
  | { type: 'useUp' }
  | { type: 'cook'; foods: string[] }
  | { type: 'shopAdd'; item: string; qty?: number; unit?: QtyUnit }
  | { type: 'shopBuild'; week: 'this' | 'next' }
  | { type: 'discard'; item: string; fraction?: number; qty?: number; unit?: QtyUnit; spoiled: boolean }
  | { type: 'stock'; item?: string; location?: 'fridge' | 'freezer' | 'pantry' }
  | { type: 'weigh'; kg: number; timeOfDay: 'morning' | 'midday' | 'evening' }
  | { type: 'meals'; date: string; slot?: SlotName }
  | { type: 'nutritionLeft'; date: string }
  | { type: 'spent'; period: 'week' | 'month' }
  | { type: 'budget' }
  | { type: 'progress' }
  | { type: 'plan'; week: 'this' | 'next'; date?: string; replan: boolean }
  | { type: 'rate'; recipe?: string; date?: string; slot?: SlotName; flags: RatingFlag[]; stars?: 1 | 2 | 3 | 4 | 5 }
  | { type: 'ate'; date: string; slot: SlotName; fraction: number; recipe?: string }
  | { type: 'skipped'; date: string; slot: SlotName }
  | { type: 'quick'; date: string; item: string; qty?: number; unit?: QtyUnit }
  | { type: 'undoEaten'; date: string; slot?: SlotName; item?: string }
  | { type: 'eatenToday'; date: string }
  | { type: 'backup' }

export type Interpretation = { kind: 'intent'; intent: Intent } | { kind: 'unknown'; closest: string[] }

/** Example commands: shown as chips and used to suggest the closest when a command isn't understood. */
export const EXAMPLES = [
  'Swap tonight’s dinner',
  'Something with chicken for lunch tomorrow',
  'Have butter chicken for dinner on Friday',
  'Skip lunch tomorrow',
  'Make tomorrow a rest day',
  'Train Saturday at 6am',
  'Back to my usual week on Monday',
  'Use up what expires soon',
  'What can I make with chicken and rice?',
  'Add milk to the shopping list',
  'Build the shopping list for next week',
  'I threw out the spinach',
  'How much rice do I have?',
  'What’s in the fridge?',
  'I weigh 80.4 kg',
  'What’s for dinner?',
  'How much protein is left today?',
  'How much have I spent this week?',
  'How much budget is left?',
  'How’s my progress?',
  'Plan my week',
  'I loved the salmon don',
  'I ate lunch',
  'Had half my dinner',
  'I had a banana',
  'Skipped smoko',
  'What have I eaten today?',
  'Back up my data',
]

const has = (s: string, re: RegExp) => re.test(s)

/** "half", "a quarter of", "200 g", "2" -> amount. */
function amount(s: string): { fraction?: number; qty?: number; unit?: QtyUnit; rest: string } {
  let rest = s
  let fraction: number | undefined
  let qty: number | undefined
  let unit: QtyUnit | undefined
  const f = rest.match(/\b(half|a half|quarter|a quarter|third|a third|all|the rest|whole)\b(?: of)?/)
  if (f) {
    fraction = /half/.test(f[1]) ? 0.5 : /quarter/.test(f[1]) ? 0.25 : /third/.test(f[1]) ? 1 / 3 : 1
    rest = rest.replace(f[0], ' ')
  }
  const q = rest.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)?\b(?:\s*of\b)?/)
  if (q) {
    const n = Number(q[1])
    const u = q[2]
    if (u === 'kg') [qty, unit] = [n * 1000, 'g']
    else if (u === 'l') [qty, unit] = [n * 1000, 'ml']
    else if (u === 'g' || u === 'ml') [qty, unit] = [n, u]
    else [qty, unit] = [n, 'unit']
    rest = rest.replace(q[0], ' ')
  } else {
    const word = rest.match(/\b(a|an|one|two|three|four|five|six|a couple of|a dozen)\b/)
    const nums: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 'a couple of': 2, 'a dozen': 12 }
    if (word && !fraction) {
      qty = nums[word[1]]
      unit = 'unit'
      rest = rest.replace(word[0], ' ')
    }
  }
  return { fraction, qty, unit, rest: rest.replace(/\s+/g, ' ').trim() }
}

const cleanItem = (s: string) => stripFiller(s.replace(/\b(shopping list|list|shopping|pantry|fridge|freezer|please|today|now|again)\b/g, ' ')).replace(/\s+/g, ' ').trim()

function closest(text: string): string[] {
  const words = new Set(normalise(text).split(' '))
  const scored = EXAMPLES.map((e) => {
    const ew = new Set(normalise(e).split(' '))
    let common = 0
    for (const w of words) if (ew.has(w) && w.length > 2) common++
    return { e, s: common / Math.sqrt(ew.size + words.size) }
  })
  return scored.sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.e)
}

export function interpret(raw: string, today: string): Interpretation {
  const t = normalise(raw)
  const ok = (intent: Intent): Interpretation => ({ kind: 'intent', intent })
  if (!t) return { kind: 'unknown', closest: EXAMPLES.slice(0, 3) }
  const w = parseWhen(t, today)
  const date = w.date ?? today

  // help
  if (has(t, /^(help|\?|commands|what can you do|what do you do|how does this work|what can i (say|ask))\b/)) return ok({ type: 'help' })

  // weigh-in: needs a weigh word or a kg unit, and a believable number
  const kgM = t.match(/\b(\d{2,3}(?:\.\d+)?)\s*kg\b/) ?? (has(t, /\b(weigh|weighed|weighing|weight|scales?)\b/) ? t.match(/\b(\d{2,3}(?:\.\d+)?)\b/) : null)
  if (kgM && has(t, /\b(weigh|weighed|weighing|weight|scales?|im|i am|kg)\b/) && !has(t, /\b(list|buy|add|threw|throw|bin)\b/)) {
    const kg = Number(kgM[1])
    if (kg >= 30 && kg <= 300) {
      const timeOfDay = has(t, /\b(evening|tonight|night|pm)\b/) ? 'evening' : has(t, /\b(midday|lunch|noon|afternoon|arvo)\b/) ? 'midday' : 'morning'
      return ok({ type: 'weigh', kg, timeOfDay })
    }
  }

  // backup: "back up my data", "when did I last back up"
  if (has(t, /\b(back ?up|backed up|backups?|export (my )?data|save (a copy of )?my data)\b/) && !has(t, /\b(list|shopping)\b/)) return ok({ type: 'backup' })

  // eating: what have I eaten, undo a log, skipped, ate a meal
  if (has(t, /\b(what|how much|how many calories)\b.*\b(have i|did i|i have|i)\s+(eaten|eat|had|ate)\b/)) return ok({ type: 'eatenToday', date })
  const pastEat = /\b(ate|eaten|had|finished|scoffed|polished off)\b/
  if (has(t, /\bundo\b/) && (w.slot || pastEat.test(t)) || has(t, /\b(didnt|did not) (actually )?(eat|have)\b.*\b(after all|by mistake)\b|\b(logged|marked) .* by mistake\b/)) {
    const item = cleanItem(w.rest.replace(/\b(undo|didnt|did not|actually|eat|have|ate|had|after all|by mistake|logged|marked|eaten|the|my)\b/g, ' '))
    return ok({ type: 'undoEaten', date, slot: w.slot, item: w.slot ? undefined : item || undefined })
  }
  if (w.slot && has(t, /\b(skipped|missed|didnt have|didnt eat|did not have|did not eat|went without|no time for|never had)\b/)) return ok({ type: 'skipped', date, slot: w.slot })
  if (w.slot && pastEat.test(t) && !has(t, /\b(whats|what is|what did|what was)\b/)) {
    const f = t.match(/\b(half|a half|quarter|a quarter|three quarters|most|some|a bit|all|the whole|whole)\b/)
    const fraction = !f ? 1 : /three quarters|most/.test(f[1]) ? 0.75 : /quarter|a bit/.test(f[1]) ? 0.25 : /half|some/.test(f[1]) ? 0.5 : 1
    const recipe = stripFiller(w.rest.replace(/\b(i|ate|eaten|had|finished|scoffed|polished off|half|a half|quarter|a quarter|three quarters|most|some|a bit|all|the whole|whole|of|my|for|as|just|only|instead|today|already|meal)\b/g, ' ')).replace(/\s+/g, ' ').trim()
    return ok({ type: 'ate', date, slot: w.slot, fraction, recipe: recipe || undefined })
  }

  // meal planner: "plan my week", "plan next week", "fill the rest of the week", "replan friday"
  const replan = has(t, /\b(replan|re plan|start over|from scratch|redo)\b/)
  if (
    !has(t, /\b(list|shopping)\b/) &&
    !has(t, /^(whats|what is|what are|what|show|tell me)\b/) &&
    (has(t, /\b(plan|replan|re plan|fill|sort out|organise|organize|redo)\b.*\b(week|meals|days)\b/) || has(t, /\b(meal plan|plan my meals|plan meals)\b/) || (replan && !!w.date))
  ) {
    const onlyDay = !!w.date && !has(t, /\bweek\b/)
    return ok({ type: 'plan', week: has(t, /\bnext week\b/) ? 'next' : 'this', date: onlyDay ? w.date : undefined, replan: replan || onlyDay })
  }

  // ratings: "I loved the salmon don", "don't suggest tacos again", "that was too expensive", "4 stars"
  if (!has(t, /\b(swap|switch|change|replace|something else|different|instead)\b/)) {
    const flags: RatingFlag[] = []
    if (has(t, /\b(dont suggest|dont recommend|never again|didnt like|did not like|hated|hate|dont like|disliked|gross|awful|not again|never make)\b/)) flags.push('do_not_recommend')
    else if (has(t, /\b(loved|love|loving|favourite|favorite|delicious|amazing|so good|yum|yummy)\b/)) flags.push('favourite')
    if (has(t, /\btoo (expensive|pricey|dear)\b/)) flags.push('too_expensive')
    if (has(t, /\btoo (slow|long)\b|\btook (too long|ages|forever)\b/)) flags.push('too_slow')
    if (has(t, /\b(too often|too much of|had it too much|too repetitive)\b/)) flags.push('too_repetitive')
    if (has(t, /\b(cook again|make again|have again|again soon)\b/) && !flags.includes('do_not_recommend')) flags.push('cook_again')
    const st = t.match(/\b([1-5])\s*(?:stars?|out of 5)\b/)
    if (flags.length || st) {
      const recipe = stripFiller(
        w.rest.replace(/\b(dont suggest|dont recommend|never again|didnt like|did not like|hated|hate|dont like|disliked|gross|awful|not again|never make|loved|love|loving|favourite|favorite|delicious|amazing|so good|yummy|yum|too expensive|too pricey|too dear|too slow|too long|took too long|took ages|took forever|too often|too much of|had it too much|too repetitive|cook again|make again|have again|again soon|again|[1-5]\s*(?:stars?|out of 5)|rate|rated|give|gave|was|were|is|really|very|that|it|this|one|recipe|meal|im|i am|making|make|cook|have|had)\b/g, ' '),
      ).replace(/\s+/g, ' ').trim()
      return ok({ type: 'rate', recipe: recipe || undefined, date: w.date, slot: w.slot, flags, stars: st ? (Number(st[1]) as 1 | 2 | 3 | 4 | 5) : undefined })
    }
  }

  // quick food: "I had a banana", "ate 2 eggs", "had 250 ml milk"
  const quickM = t.match(/^(?:i |just |i just |ive |i have )?(?:ate|had|eaten|have had|snacked on|drank|drunk)\s+(.+)$/)
  if (quickM && !w.slot) {
    const a = amount(quickM[1])
    const item = cleanItem(a.rest.replace(/\b(as a snack|for a snack|snack|earlier|just now|before|after|this morning|this afternoon|tonight)\b/g, ' '))
    if (item) return ok({ type: 'quick', date, item, qty: a.qty, unit: a.unit })
  }

  // progress
  if (has(t, /\b(progress|my trend|weight trend|how am i (going|tracking|doing)|how much (have i|did i|weight have i) (lost|gained)|am i (losing|gaining)|on track)\b/) && !has(t, /\b(budget|spent|spend)\b/)) {
    return ok({ type: 'progress' })
  }

  // shopping list: build / update
  if (has(t, /\b(build|make|update|refresh|redo|create|do|start|write)\b.*\b(shopping list|list|shopping)\b/) && !has(t, /\badd\b/)) {
    return ok({ type: 'shopBuild', week: has(t, /\bnext week\b/) ? 'next' : 'this' })
  }
  // shopping list: add
  const addM =
    t.match(/^(?:can you |please )?(?:add|put|pop|stick|chuck|write)\s+(.+?)\s+(?:to|on|onto|in)\s+(?:the |my )?(?:shopping )?(?:list|shopping)\b/) ??
    t.match(/^(?:we |i )?(?:need to buy|need to get|have to buy|should buy|need)\s+(.+?)(?:\s+(?:from the shops|at the shops))?$/) ??
    t.match(/\b(?:were|im|we are|i am|run|ran|running|all)\s+out of\s+(.+)$/) ??
    t.match(/^buy\s+(.+)$/)
  if (addM) {
    const a = amount(addM[1])
    const item = cleanItem(a.rest)
    if (item) return ok({ type: 'shopAdd', item, qty: a.qty, unit: a.unit })
  }

  // throw out
  const spoiled = has(t, /\b(off|gone off|went off|bad|mouldy|moldy|rotten|spoiled|spoilt|expired|stale|slimy)\b/)
  const binM =
    t.match(/\b(?:threw|throw|thrown|throwing|chucked|chuck|binned|bin|tossed|toss|discard|discarded|dumped|dump)\s+(?:out|away)?\s*(.+?)(?:\s+(?:out|away))?(?:\s+(?:because|as|cause|cos|coz|since)\b.*|\s+(?:it|they)\s*(?:was|were|is|are|s|had|has)?\s*(?:gone )?(?:off|bad|mouldy|moldy|rotten|expired).*)?$/) ??
    t.match(/^(?:the |my |our )?(.+?)\s+(?:went|has gone|have gone|is|are|was|were)\s+(?:off|bad|mouldy|moldy|rotten|expired|spoiled|spoilt)\b/)
  if (binM) {
    const a = amount(binM[1])
    const item = cleanItem(a.rest)
    if (item) return ok({ type: 'discard', item, fraction: a.fraction, qty: a.qty, unit: a.unit, spoiled })
  }

  // training / rest / usual
  if (has(t, /\b(back to|go back to|reset|return to)\b.*\b(usual|normal|regular)\b/)) return ok({ type: 'usual', date })
  if (
    has(t, /\b(rest day|day off|recovery day|off day)\b/) ||
    has(t, /\b(not|no|skip|skipping|wont|cant|cannot|dont|not going to)\s+(?:be\s+)?(?:the |my |to the )?(train|training|gym|go to the gym|workout|work out|working out|lift|lifting)\b/)
  ) {
    return ok({ type: 'dayType', date, dayType: 'rest' })
  }
  if (
    has(t, /\b(training day|gym day|workout day)\b/) ||
    has(t, /^(?:ill |i will |im |i am |going to |gonna |)?(?:train|training|go to the gym|hit the gym|gym|work out|working out|workout|lift|lifting)\b/) ||
    has(t, /\b(move|moving|change|shift)\b.*\b(training|workout|gym|session)\b/)
  ) {
    return ok({ type: 'dayType', date, dayType: 'training', start: w.time })
  }

  // use up food dated soon
  if (has(t, /\b(use up|going off|go off|goes off|about to go|before it goes|use (it|them) up|dated soon|expir\w*|use by|close to (its|their) date|going bad|go bad|needs using|need using)\b/)) {
    return ok({ type: 'useUp' })
  }

  // money
  if (has(t, /\bbudget\b/)) return ok({ type: 'budget' })
  if (has(t, /\b(spent|spend|spending|cost me|paid)\b/)) return ok({ type: 'spent', period: has(t, /\bmonth\b/) ? 'month' : 'week' })

  // nutrition left today
  if (has(t, /\b(protein|calories|kcal|carbs|carb|fat|macros|energy)\b/) && has(t, /\b(left|remaining|to go|still|how much|how many|more|hit|reach)\b/)) {
    return ok({ type: 'nutritionLeft', date })
  }

  // what's planned
  if (
    has(t, /\b(whats|what is|what am i|what are we|whats on|what do i have|what have i got|what are we having|what am i having|what am i eating)\b.*\b(for|on|planned|having|eating|menu)\b/) &&
    (w.slot || w.date || has(t, /\b(planned|menu|on)\b/)) &&
    !has(t, /\b(fridge|freezer|pantry|in stock|left of)\b/)
  ) {
    return ok({ type: 'meals', date, slot: w.slot })
  }
  if (has(t, /\bmenu\b/) && !has(t, /\b(swap|change)\b/)) return ok({ type: 'meals', date, slot: w.slot })

  // pantry stock questions
  const loc = t.match(/\b(fridge|freezer|pantry|cupboard)\b/)
  const location = loc ? (loc[1] === 'cupboard' ? 'pantry' : (loc[1] as 'fridge' | 'freezer' | 'pantry')) : undefined
  const stockM = t.match(/\b(?:how much|how many|do i have|do we have|have i got|have we got|is there|are there|any|got any)\s+(.+?)(?:\s+(?:left|do i have|do we have|have i got|in stock|in the (?:fridge|freezer|pantry|cupboard)))*$/)
  if (stockM && !has(t, /\b(make|cook)\b/)) {
    const item = cleanItem(stockM[1].replace(/\b(left|do i have|do we have|have i got|in stock|is there|are there|got)\b/g, ' '))
    return ok({ type: 'stock', item: item || undefined, location })
  }
  if (has(t, /\b(whats|what is|show|list)\b.*\b(in the|in my|in stock)\b/) || (location && has(t, /\b(whats|what is|what have i got|whats left)\b/))) {
    return ok({ type: 'stock', location })
  }

  // what can I cook
  const cookM = t.match(/\b(?:what can i|what could i|what should i|what can we|what to|ideas? (?:for|to)|something to)\s+(?:make|cook|eat|have)\b(.*)$/) ?? t.match(/\b(?:recipes?|meals?|ideas?|cook|make)\s+(?:with|using|from)\s+(.+)$/)
  if (cookM && !w.slot) {
    const after = cookM[1] ?? ''
    const fromPantry = has(after, /\b(pantry|what i have|what ive got|whats here|fridge|stock)\b/)
    const withPart = after.replace(/^.*?\b(with|using|from)\b/, '')
    const foods = fromPantry || !/\b(with|using)\b/.test(after) && !cookM[0].match(/\b(with|using)\b/)
      ? []
      : withPart.split(/,|\band\b|&|\bplus\b/).map(cleanItem).filter(Boolean)
    return ok({ type: 'cook', foods })
  }

  // meal changes
  const mealRef = !!w.slot || has(t, /\b(meal|tonight)\b/)
  if (mealRef || has(t, /\b(swap|switch|replace)\b/)) {
    // clear
    if (has(t, /\b(skip|skipping|cancel|clear|remove|drop|delete|no|not having|wont (?:have|need|eat)|dont need|eating out|going out|out for|empty)\b/) && !has(t, /\bsomething\b/)) {
      return ok({ type: 'clear', date, slot: w.slot })
    }
    // swap, maybe "for something with X"
    const withM = w.rest.match(/\b(?:something|anything|one|a meal|a recipe|meal)?\s*(?:with|using|that has|containing)\s+(.+)$/)
    const swapWord = has(t, /\b(swap|switch|change|replace|something else|different|another|other|ideas?|suggest\w*|recommend\w*|options?|dont (?:want|feel like|fancy)|not feeling|over it|sick of)\b/)
    // "swap friday dinner for butter chicken" / "have butter chicken for dinner"
    const forM = w.rest.match(/\b(?:for|to|with|into)\s+(?!something|anything|a different|another)(.+)$/)
    const verbM = w.rest.match(/^(?:id like|i would like|i want to have|i want|lets have|let us have|ill have|i will have|can i have|could i have|have|make|cook|put|plan|eat|do)\s+(.+)$/)
    if (withM && (swapWord || /\bsomething\b/.test(t))) {
      return ok({ type: 'swap', date, slot: w.slot, withFood: cleanItem(withM[1]) || undefined })
    }
    if (swapWord && forM && !/\bsomething\b/.test(t)) {
      const recipe = stripFiller(forM[1].replace(/\b(swap|switch|change|replace|meal)\b/g, ' ')).trim()
      if (recipe) return ok({ type: 'set', date, slot: w.slot, recipe })
    }
    if (swapWord) return ok({ type: 'swap', date, slot: w.slot })
    if (verbM) {
      const recipe = stripFiller(verbM[1].replace(/\b(meal|for|on)\b/g, ' ')).trim()
      if (recipe) return ok({ type: 'set', date, slot: w.slot, recipe })
    }
    if (has(t, /\bsomething\b/)) return ok({ type: 'swap', date, slot: w.slot })
  }

  return { kind: 'unknown', closest: closest(raw) }
}


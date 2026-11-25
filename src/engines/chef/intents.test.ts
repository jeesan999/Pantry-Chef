import { describe, expect, it } from 'vitest'
import { interpret, type Intent } from './intents'
import { normalise } from './normalise'
import { parseWhen } from './when'

const TODAY = '2026-11-26' // a Thursday

describe('normalise', () => {
  it('lower-cases, drops apostrophes and punctuation, maps everyday spellings', () => {
    expect(normalise("What's for brekkie tmrw?")).toBe('whats for breakfast tomorrow')
    expect(normalise('I weigh 80,4 kilos.')).toBe('i weigh 80.4 kg')
    expect(normalise('Train Sat @ 17:30!')).toBe('train saturday 17:30')
  })
})

describe('parseWhen', () => {
  const cases: Array<[string, Partial<ReturnType<typeof parseWhen>>]> = [
    ['tonight', { date: '2026-11-26', slot: 'dinner' }],
    ['tonights dinner', { date: '2026-11-26', slot: 'dinner' }],
    ['tomorrow lunch', { date: '2026-11-27', slot: 'lunch' }],
    ['the day after tomorrow', { date: '2026-11-28' }],
    ['yesterday', { date: '2026-11-25' }],
    ['thursday', { date: '2026-11-26' }], // today is Thursday
    ['friday', { date: '2026-11-27' }],
    ['monday', { date: '2026-11-30' }], // across the week boundary
    ['wednesday', { date: '2026-12-02' }],
    ['next friday', { date: '2026-12-04' }],
    ['on the 28th', { date: '2026-11-28' }],
    ['on the 3rd', { date: '2026-12-03' }], // already past this month
    ['30/11', { date: '2026-11-30' }],
    ['1/1', { date: '2027-01-01' }],
    ['saturday at 6am', { date: '2026-11-28', time: '06:00' }],
    ['at 6', { time: '06:00' }],
    ['at 5:30pm', { time: '17:30' }],
    ['17:30', { time: '17:30' }],
    ['at 3', { time: '15:00' }],
    ['morning tea', { slot: 'smoko' }],
  ]
  for (const [text, want] of cases) it(text, () => expect(parseWhen(normalise(text), TODAY)).toMatchObject(want))

  it('"tonight" late on a Sunday stays on Sunday', () => {
    expect(parseWhen('tonight', '2026-11-29')).toMatchObject({ date: '2026-11-29', slot: 'dinner' })
  })
})

const I = (text: string) => {
  const r = interpret(text, TODAY)
  return r.kind === 'intent' ? r.intent : r
}

describe('interpret', () => {
  const cases: Array<[string, Partial<Intent> | { kind: 'unknown' }]> = [
    // help
    ['help', { type: 'help' }],
    ['What can you do?', { type: 'help' }],
    // swap
    ["Swap tonight's dinner", { type: 'swap', date: '2026-11-26', slot: 'dinner' }],
    ['swap dinner', { type: 'swap', date: '2026-11-26', slot: 'dinner' }],
    ['something else for lunch tomorrow', { type: 'swap', date: '2026-11-27', slot: 'lunch' }],
    ["I don't feel like tonight's dinner", { type: 'swap', slot: 'dinner' }],
    ['change friday dinner', { type: 'swap', date: '2026-11-27', slot: 'dinner' }],
    ['swap friday dinner for something with chicken', { type: 'swap', date: '2026-11-27', slot: 'dinner', withFood: 'chicken' }],
    ['something with salmon for dinner', { type: 'swap', slot: 'dinner', withFood: 'salmon' }],
    ['different lunch', { type: 'swap', slot: 'lunch' }],
    ['swap my meal tonight', { type: 'swap', date: '2026-11-26', slot: 'dinner' }],
    // set
    ['Have butter chicken for dinner on Friday', { type: 'set', date: '2026-11-27', slot: 'dinner', recipe: 'butter chicken' }],
    ['put the salmon don on saturday lunch', { type: 'set', date: '2026-11-28', slot: 'lunch', recipe: 'salmon don' }],
    ['swap friday dinner for butter chicken', { type: 'set', date: '2026-11-27', slot: 'dinner', recipe: 'butter chicken' }],
    ['lets have tacos tonight', { type: 'set', date: '2026-11-26', slot: 'dinner', recipe: 'tacos' }],
    ['make prawn risotto for dinner tomorrow', { type: 'set', date: '2026-11-27', slot: 'dinner', recipe: 'prawn risotto' }],
    ['change lunch to the chicken rice bowl', { type: 'set', slot: 'lunch', recipe: 'chicken rice bowl' }],
    // clear
    ['skip lunch tomorrow', { type: 'clear', date: '2026-11-27', slot: 'lunch' }],
    ['no dinner on sunday', { type: 'clear', date: '2026-11-29', slot: 'dinner' }],
    ['eating out tonight', { type: 'clear', date: '2026-11-26', slot: 'dinner' }],
    ['cancel smoko', { type: 'clear', slot: 'smoko' }],
    ['clear saturday dinner', { type: 'clear', date: '2026-11-28', slot: 'dinner' }],
    // day type
    ['Make tomorrow a rest day', { type: 'dayType', date: '2026-11-27', dayType: 'rest' }],
    ['rest day on saturday', { type: 'dayType', date: '2026-11-28', dayType: 'rest' }],
    ['not training tomorrow', { type: 'dayType', date: '2026-11-27', dayType: 'rest' }],
    ['skip the gym today', { type: 'dayType', date: '2026-11-26', dayType: 'rest' }],
    ["I can't train on monday", { type: 'dayType', date: '2026-11-30', dayType: 'rest' }],
    ['Train Saturday at 6am', { type: 'dayType', date: '2026-11-28', dayType: 'training', start: '06:00' }],
    ['make sunday a training day', { type: 'dayType', date: '2026-11-29', dayType: 'training' }],
    ['gym tomorrow at 5:30pm', { type: 'dayType', date: '2026-11-27', dayType: 'training', start: '17:30' }],
    ["i'll train friday", { type: 'dayType', date: '2026-11-27', dayType: 'training' }],
    ['move training to 7am tomorrow', { type: 'dayType', date: '2026-11-27', dayType: 'training', start: '07:00' }],
    ['Back to my usual week on Monday', { type: 'usual', date: '2026-11-30' }],
    ['reset tomorrow to normal', { type: 'usual', date: '2026-11-27' }],
    // use up
    ['Use up what expires soon', { type: 'useUp' }],
    ["what's going off?", { type: 'useUp' }],
    ['anything about to go off', { type: 'useUp' }],
    ['what needs using', { type: 'useUp' }],
    // cook
    ['What can I make with chicken and rice?', { type: 'cook', foods: ['chicken', 'rice'] }],
    ['what can i cook', { type: 'cook', foods: [] }],
    ['what can I make from the pantry', { type: 'cook', foods: [] }],
    ['recipes with salmon, broccoli & rice', { type: 'cook', foods: ['salmon', 'broccoli', 'rice'] }],
    ['ideas for dinner', { type: 'swap', slot: 'dinner' }],
    // shopping
    ['Add milk to the shopping list', { type: 'shopAdd', item: 'milk' }],
    ['add 2 avocados to the list', { type: 'shopAdd', item: 'avocados', qty: 2, unit: 'unit' }],
    ['put 1kg of rice on my list', { type: 'shopAdd', item: 'rice', qty: 1000, unit: 'g' }],
    ["we're out of eggs", { type: 'shopAdd', item: 'eggs' }],
    ['ran out of olive oil', { type: 'shopAdd', item: 'olive oil' }],
    ['need dish liquid', { type: 'shopAdd', item: 'dish liquid' }],
    ['buy bananas', { type: 'shopAdd', item: 'bananas' }],
    ['Build the shopping list for next week', { type: 'shopBuild', week: 'next' }],
    ['update my list', { type: 'shopBuild', week: 'this' }],
    ['make a shopping list', { type: 'shopBuild', week: 'this' }],
    // discard
    ['I threw out the spinach', { type: 'discard', item: 'spinach' }],
    ['bin half the milk', { type: 'discard', item: 'milk', fraction: 0.5 }],
    ['the milk went off', { type: 'discard', item: 'milk', spoiled: true }],
    ['tossed 200g of chicken because it was off', { type: 'discard', item: 'chicken', qty: 200, unit: 'g', spoiled: true }],
    ['chucked the avocados away', { type: 'discard', item: 'avocados' }],
    // stock
    ['How much rice do I have?', { type: 'stock', item: 'rice' }],
    ['do we have any eggs', { type: 'stock', item: 'eggs' }],
    ['any chicken left', { type: 'stock', item: 'chicken' }],
    ["What's in the fridge?", { type: 'stock', location: 'fridge' }],
    ['whats in the freezer', { type: 'stock', location: 'freezer' }],
    // weigh
    ['I weigh 80.4 kg', { type: 'weigh', kg: 80.4, timeOfDay: 'morning' }],
    ['weighed 79.9 this morning', { type: 'weigh', kg: 79.9 }],
    ['80 kg tonight', { type: 'weigh', kg: 80, timeOfDay: 'evening' }],
    ['my weight is 81.2', { type: 'weigh', kg: 81.2 }],
    ['scales say 80,6', { type: 'weigh', kg: 80.6 }],
    // questions
    ["What's for dinner?", { type: 'meals', date: '2026-11-26', slot: 'dinner' }],
    ["what's on tomorrow", { type: 'meals', date: '2026-11-27' }],
    ['what am i having for lunch on saturday', { type: 'meals', date: '2026-11-28', slot: 'lunch' }],
    ['show me the menu', { type: 'meals' }],
    ['what is on the meal plan for friday', { type: 'meals', date: '2026-11-27' }],
    ['How much protein is left today?', { type: 'nutritionLeft', date: '2026-11-26' }],
    ['how many calories do i have left', { type: 'nutritionLeft' }],
    ['How much have I spent this week?', { type: 'spent', period: 'week' }],
    ['spending this month', { type: 'spent', period: 'month' }],
    ['How much budget is left?', { type: 'budget' }],
    ["How's my progress?", { type: 'progress' }],
    ['what is my weight trend', { type: 'progress' }],
    ['how much have i lost', { type: 'progress' }],
    ['am i on track', { type: 'progress' }],
    // planner
    ['Plan my week', { type: 'plan', week: 'this', replan: false }],
    ['plan next week', { type: 'plan', week: 'next', replan: false }],
    ['fill the rest of the week', { type: 'plan', week: 'this' }],
    ['make me a meal plan', { type: 'plan', week: 'this' }],
    ['replan the week from scratch', { type: 'plan', week: 'this', replan: true }],
    ['replan friday', { type: 'plan', date: '2026-11-27', replan: true }],
    ['plan meals for saturday', { type: 'plan', date: '2026-11-28', replan: true }],
    // backup
    ['back up my data', { type: 'backup' }],
    ['when did I last back up?', { type: 'backup' }],
    ['make a backup', { type: 'backup' }],
    // eating
    ['I ate lunch', { type: 'ate', date: '2026-11-26', slot: 'lunch', fraction: 1, recipe: undefined }],
    ['had half my dinner', { type: 'ate', slot: 'dinner', fraction: 0.5 }],
    ['ate breakfast', { type: 'ate', slot: 'breakfast', fraction: 1 }],
    ['ate the salmon don for lunch', { type: 'ate', slot: 'lunch', recipe: 'salmon don' }],
    ['had most of tonights dinner', { type: 'ate', slot: 'dinner', fraction: 0.75 }],
    ['I had dinner yesterday', { type: 'ate', date: '2026-11-25', slot: 'dinner' }],
    ['skipped smoko', { type: 'skipped', slot: 'smoko' }],
    ["didn't have lunch", { type: 'skipped', slot: 'lunch' }],
    ['I had a banana', { type: 'quick', item: 'banana', qty: 1, unit: 'unit' }],
    ['ate 2 eggs', { type: 'quick', item: 'eggs', qty: 2, unit: 'unit' }],
    ['had 250 ml milk', { type: 'quick', item: 'milk', qty: 250, unit: 'ml' }],
    ['just had a flat white', { type: 'quick', item: 'flat white', qty: 1 }],
    ['snacked on 30g of almonds', { type: 'quick', item: 'almonds', qty: 30, unit: 'g' }],
    ['undo lunch', { type: 'undoEaten', slot: 'lunch' }],
    ["I didn't eat dinner after all", { type: 'undoEaten', slot: 'dinner' }],
    ['undo the banana I had', { type: 'undoEaten', item: 'banana' }],
    ['What have I eaten today?', { type: 'eatenToday', date: '2026-11-26' }],
    ['how many calories have i had', { type: 'eatenToday' }],
    // planning stays planning
    ['skip lunch tomorrow', { type: 'clear', date: '2026-11-27', slot: 'lunch' }],
    ['have butter chicken for dinner on friday', { type: 'set', recipe: 'butter chicken' }],
    // ratings
    ['I loved the salmon don', { type: 'rate', recipe: 'salmon don', flags: ['favourite'] }],
    ["don't suggest tacos again", { type: 'rate', recipe: 'tacos', flags: ['do_not_recommend'] }],
    ['that was too expensive', { type: 'rate', recipe: undefined, flags: ['too_expensive'] }],
    ["tonight's dinner was delicious", { type: 'rate', date: '2026-11-26', slot: 'dinner', flags: ['favourite'] }],
    ['butter chicken 5 stars', { type: 'rate', recipe: 'butter chicken', stars: 5 }],
    ['the risotto took too long', { type: 'rate', recipe: 'risotto', flags: ['too_slow'] }],
    ['make the gimbap again soon', { type: 'rate', recipe: 'gimbap', flags: ['cook_again'] }],
    // not understood
    ['chicken', { kind: 'unknown' }],
    ['hello there', { kind: 'unknown' }],
    ['', { kind: 'unknown' }],
  ]
  for (const [text, want] of cases) it(JSON.stringify(text), () => expect(I(text)).toMatchObject(want))

  it('unknown commands offer the three closest examples', () => {
    const r = interpret('rest tomorow pls', TODAY)
    // "rest" alone isn't enough to act on; the closest examples include the rest-day one
    if (r.kind === 'unknown') expect(r.closest).toContain('Make tomorrow a rest day')
    else expect(r.intent.type).toBe('dayType')
  })
})

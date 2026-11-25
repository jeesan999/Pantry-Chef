/** Text clean-up for the Chef interpreter: lower case, no apostrophes or stray punctuation, everyday spellings mapped. */

const WORDS: Record<string, string> = {
  brekkie: 'breakfast', brekky: 'breakfast', brekfast: 'breakfast', breakfas: 'breakfast',
  tmrw: 'tomorrow', tmr: 'tomorrow', tomoz: 'tomorrow', tomorow: 'tomorrow', tommorow: 'tomorrow', tommorrow: 'tomorrow', tomorro: 'tomorrow', '2moro': 'tomorrow',
  tonite: 'tonight', '2nite': 'tonight', tonigh: 'tonight',
  diner: 'dinner', dinnner: 'dinner', luch: 'lunch', lunh: 'lunch',
  wanna: 'want to', gonna: 'going to', gotta: 'have to',
  pls: 'please', plz: 'please', u: 'you', r: 'are',
  kilos: 'kg', kilo: 'kg', kgs: 'kg', grams: 'g', gram: 'g', gm: 'g', litres: 'l', litre: 'l', liters: 'l', liter: 'l',
  mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', weds: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday',
  fri: 'friday', sat: 'saturday', sun: 'sunday',
  shoping: 'shopping', shoppinglist: 'shopping list', lst: 'list',
  avo: 'avocado', avos: 'avocados', brocolli: 'broccoli', brocoli: 'broccoli',
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '')
    .replace(/(\d),(\d)/g, '$1.$2') // 80,4 kg
    .replace(/\s*(?:,|&|\+)\s*/g, ' and ') // lists: "salmon, broccoli & rice"
    .replace(/[^a-z0-9.:/\s-]/g, ' ')
    .replace(/(^|\s)[.-]+|[.-]+(\s|$)/g, ' ') // stray dots and dashes, keeping 80.4 and 17:30
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(' ')
    .trim()
}

/** Words that carry no meaning for matching item and recipe names. */
export const FILLER = new Set(['the', 'a', 'an', 'my', 'some', 'of', 'for', 'on', 'at', 'to', 'please', 'i', 'we', 'me', 'our', 'it', 'is', 'and', 'with', 'this', 'that', 'in', 'from', 'can', 'you', 'just', 'any'])

export const stripFiller = (s: string) => s.split(' ').filter((w) => w && !FILLER.has(w)).join(' ')

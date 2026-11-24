/**
 * Turns OCR'd receipt lines into store, date, total and items. Pure and offline.
 *
 * Handles common Australian layouts:
 *  - name and price on one line                     "WW Full Cream Milk 3L   4.65"
 *  - weighed produce, weight on the next line       "Bananas Cavendish" / "0.854 kg NET @ $3.90/kg  3.33"
 *  - weight on the same line                        "Tomatoes Gourmet  0.75kg  3.74"
 *  - quantity line above or below the item          "Qty 2 @ $2.50 each" / "2 x 1.89  3.78"
 *  - discounts under an item                        "Price Reduced  -2.60", "Promotional Price Saving -$1.00"
 *  - GST markers and tax-code letters               "^Fairy Dish Liquid", "6.29 B"
 * Anything it is unsure of gets a lower confidence, and the check screen shows it for review.
 */

export interface InputLine {
  text: string
  confidence?: number // 0..100 from OCR
}

export interface ParsedItem {
  raw: string[] // the receipt line(s) this item came from
  name: string
  priceCents: number // line total before any discount on it
  discountCents: number // positive
  quantity?: number // how many, from a "2 @ $2.50" line
  unitPriceCents?: number
  weightKg?: number
  pricePerKgCents?: number
  pack?: { amount: number; unit: 'g' | 'ml' } // from the name: 1kg, 750ml, 2L
  confidence: number // 0..1
  nonFood: boolean
  notes: string[]
  priceOptions?: number[] // when the decimal point was unreadable: the possible prices
}

export interface ParsedReceipt {
  store?: string
  storeKey?: string
  date?: string // YYYY-MM-DD
  totalCents?: number
  items: ParsedItem[]
  unassignedDiscountCents: number
  itemsNetCents: number // sum of (price − discount)
  warnings: string[]
}

export const STORES: Array<{ key: string; name: string; re: RegExp }> = [
  { key: 'woolworths', name: 'Woolworths', re: /woolworths|woolies/i },
  { key: 'coles', name: 'Coles', re: /\bcoles\b/i },
  { key: 'aldi', name: 'ALDI', re: /\baldi\b/i },
  { key: 'iga', name: 'IGA', re: /\biga\b/i },
  { key: 'costco', name: 'Costco', re: /costco/i },
  { key: 'spudshed', name: 'Spudshed', re: /spud\s*shed/i },
  { key: 'farmerjacks', name: "Farmer Jack's", re: /farmer\s*jack/i },
  { key: 'dewsons', name: 'Dewsons', re: /dewsons/i },
  { key: 'harrisfarm', name: 'Harris Farm', re: /harris\s*farm/i },
  { key: 'foodworks', name: 'FoodWorks', re: /food\s*works/i },
]

const NON_FOOD =
  /\b(dish|dishwash\w*|detergent|laundry|toilet|tissues?|paper towel|towels?|garbage|bin liners?|bags?|foil|cling|soap|shampoo|conditioner|toothpaste|toothbrush|deodorant|razors?|batter(y|ies)|cleaner|bleach|sponges?|napkins?|serviettes?|nappies|wipes|cat food|dog food|kitty litter|light ?bulb|candles?)\b/i

// Lines that are never items. Checked before anything else.
const IGNORE =
  /^(test receipt|sub\s*-?\s*total|total\s+savings|you saved|savings|gst|eftpos|visa|master\s*card|amex|debit|credit|card\b|change|cash\b|tender|rounding|points?\b|flybuys|everyday rewards|rewards|balance|abn\b|tax invoice|description|qty\s+description|\d+\s+items?\b|items?\b|store\b|lane\b|terminal|approved|auth|ref\b|account|operator|cashier|thank|www\.|ph\b|phone|date\b|time\b|member)/i
const TOTAL = /^(total(\s+aud)?|sum(\s+aud)?|amount due|balance due|to pay)\b/i
const DISCOUNT_WORDS = /price reduced|saving|discount|promo|special|\bless\b|markdown|multi\s*buy|member price|coupon|voucher|price drop/i

/** Fix the usual OCR slips in prices: "S4.20" -> "$4.20", "4,20" -> "4.20", "4. 20" -> "4.20", "1O.50" -> "10.50". */
export function normaliseLine(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/\bS(?=\d+[.,]\d{2}\b)/g, '$')
    .replace(/(\d)\s*[,]\s*(\d{2})\b/g, '$1.$2')
    .replace(/(\d)\.\s+(\d{2})\b/g, '$1.$2')
    .replace(/(?<=\d)[Oo](?=\d|\.\d)|(?<=\d\.)[Oo]|(?<=\.\d)[Oo]/g, '0')
    .replace(/\b(\d*)[lI|]{1,2}(?=kg\b)/gi, (_x, d) => (d ? d : '1')) // "lkg" / "1lkg" -> "1kg"
    .replace(/\b0(?=[a-z]{2,}\b)/g, 'O') // "0il" -> "Oil"
    .replace(/[ \t]{2,}/g, '   ') // a wide gap (name ... price) is kept as three spaces
    .trim()
}

// After the cents: an optional tax/GST code (A, B, T, *, ^), which OCR sometimes reads as a digit ("3.498", "4.99 8B").
const PRICE_AT_END = /(-?)\s*\$?\s*(-?)\s*(\d{1,4})\.(\d{2})(?:\d|\s*[A-Z0-9*^#]{1,2})?\s*$/
const WEIGHT_AT = /(\d{1,3}\.\d{1,3})\s*kg\s*(?:net\s*)?(?:@|x|at)\s*\$?\s*(\d{1,4}\.\d{2})\s*(?:\/\s*kg|per\s*kg)?/i
const QTY = /^(?:qty\s*)?(\d{1,3})\s*(?:@|x)\s*\$?\s*(\d{1,4}\.\d{2})\s*(?:each|ea)?/i
const INLINE_WEIGHT = /(?:^|\s)(\d{1,2}\.\d{2,3})\s*kg\b/i

const cents = (whole: string, frac: string) => parseInt(whole, 10) * 100 + parseInt(frac, 10)

// A price whose decimal point was lost or misread: "$5950" (5.50), "$2523" (25.23), "J299" (1.99).
// Needs a "$" or a wide gap before it, so numbers inside names are left alone.
const UNCLEAR_PRICE_AT_END = /(?:\$|\s{3})\s*(-?)([0-9OoIlJ|SZBGh]{3,6})\s*(?:[A-Z*^#]{1,2})?\s*$/
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', J: '1', '|': '1', S: '5', Z: '2', B: '8', G: '6', h: '5' }

/** Possible prices for an unclear amount: all digits as cents, or one misread decimal-point character dropped. */
export function unclearPriceOptions(token: string): number[] {
  const d = token.replace(/./g, (c) => DIGIT_LOOKALIKES[c] ?? c)
  if (!/^\d+$/.test(d) || d.length < 3 || (token.match(/\d/g) ?? []).length < 2) return []
  const opts = new Set<number>()
  opts.add(parseInt(d, 10)) // decimal point dropped: 2523 -> 25.23
  if (d.length >= 4) opts.add(parseInt(d.slice(0, -3) + d.slice(-2), 10)) // read as a digit: 5950 -> 5.50
  return [...opts].filter((c) => c > 0 && c < 100000)
}

function readPrice(text: string): { cents: number; negative: boolean; index: number; match: string; options?: number[] } | null {
  const p = text.match(PRICE_AT_END)
  if (p) return { cents: cents(p[3], p[4]), negative: p[1] === '-' || p[2] === '-', index: p.index!, match: p[0] }
  const u = text.match(UNCLEAR_PRICE_AT_END)
  if (u) {
    const options = unclearPriceOptions(u[2])
    if (options.length) return { cents: options[0], negative: u[1] === '-', index: u.index!, match: u[0], options }
  }
  return null
}
const letters = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length

export function parseDate(text: string): string | undefined {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return undefined
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const num = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/)
  if (num) return iso(+num[3], +num[2], +num[1]) // Australian order: day / month / year
  const named = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{2}|\d{4})\b/i)
  if (named) return iso(+named[3], MONTHS.indexOf(named[2].toLowerCase()) + 1, +named[1])
  return undefined
}

export function packFromName(name: string): ParsedItem['pack'] {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|lt|litre|litres)\b/i)
  if (!m) return undefined
  const v = parseFloat(m[1])
  const u = m[2].toLowerCase()
  if (u === 'kg') return { amount: v * 1000, unit: 'g' }
  if (u === 'g') return { amount: v, unit: 'g' }
  if (u === 'ml') return { amount: v, unit: 'ml' }
  return { amount: v * 1000, unit: 'ml' }
}

/** "^WW FULL CREAM MILK 3L" -> "WW Full Cream Milk 3L" */
export function cleanName(s: string): string {
  let n = s.replace(/^[#*^~+\s]+/, '').replace(/\s+/g, ' ').trim()
  if (n === n.toUpperCase() && /[A-Z]{3}/.test(n)) {
    n = n
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
      .replace(/\b(\d+(?:\.\d+)?)(kg|g|ml|l|pk|lt)\b/gi, (_x, d, u) => d + (u.toLowerCase() === 'l' || u.toLowerCase() === 'lt' ? 'L' : u.toLowerCase()))
      .replace(/\b([B-DF-HJ-NP-TV-Z]{2,3})\b/gi, (w) => (/[aeiou]/i.test(w) ? w : w.toUpperCase())) // WW, BBQ
  }
  return n
}

export function parseReceipt(input: InputLine[]): ParsedReceipt {
  const lines = input.map((l) => ({ text: normaliseLine(l.text), conf: (l.confidence ?? 90) / 100 })).filter((l) => l.text)
  const warnings: string[] = []
  const out: ParsedReceipt = { items: [], unassignedDiscountCents: 0, itemsNetCents: 0, warnings }

  const all = lines.map((l) => l.text).join('\n')
  for (const s of STORES) {
    if (s.re.test(all)) {
      out.store = s.name
      out.storeKey = s.key
      break
    }
  }
  if (!out.store) {
    const first = lines.find((l) => letters(l.text) >= 3 && !/test receipt/i.test(l.text))
    if (first) out.store = cleanName(first.text)
  }
  for (const l of lines) {
    const d = parseDate(l.text)
    if (d) out.date = d
  }

  // Total: the TOTAL line, cross-checked with subtotal and payment lines (often read more cleanly)
  const totalCands: Array<{ cents: number; clear: boolean; source: 'total' | 'other' }> = []
  for (const { text } of lines) {
    const lower = text.toLowerCase()
    const isTotal = TOTAL.test(lower) && !/sub\s*-?\s*total|savings/.test(lower)
    const isOther = /^(sub\s*-?\s*total|eftpos|visa|master\s*card|amex|debit|credit|card\b|paywave|payment|amount)\b/i.test(text)
    if (!isTotal && !isOther) continue
    const p = readPrice(text)
    if (!p) continue
    for (const c of p.options ?? [p.cents]) totalCands.push({ cents: c, clear: !p.options, source: isTotal ? 'total' : 'other' })
  }
  const clearTotal = totalCands.find((c) => c.clear && c.source === 'total') ?? (() => {
    const clear = totalCands.filter((c) => c.clear)
    const counts = new Map<number, number>()
    for (const c of clear) counts.set(c.cents, (counts.get(c.cents) ?? 0) + 1)
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    return best ? { cents: best[0], clear: true, source: 'other' as const } : undefined
  })()
  if (clearTotal) out.totalCents = clearTotal.cents
  let totalUnclear = !clearTotal && totalCands.length > 0

  let pendingName: { text: string; conf: number } | null = null
  let pendingQty: { qty: number; unit: number; total: number; raw: string } | null = null
  let afterTotal = false
  let seenItem = false

  const pushItem = (it: ParsedItem) => {
    if (pendingQty) {
      // a quantity line printed ABOVE this item
      if (Math.abs(pendingQty.total - it.priceCents) <= 1) {
        it.quantity = pendingQty.qty
        it.unitPriceCents = pendingQty.unit
        it.raw.unshift(pendingQty.raw)
      } else warnings.push(`Quantity line “${pendingQty.raw}” did not match the item after it.`)
      pendingQty = null
    }
    out.items.push(it)
    seenItem = true
  }

  for (const { text, conf } of lines) {
    if (afterTotal) continue
    const lower = text.toLowerCase()
    if (TOTAL.test(lower) && !/sub\s*-?\s*total|savings/.test(lower)) {
      afterTotal = true
      continue
    }
    if (IGNORE.test(text) || STORES.some((s) => s.re.test(text) && !readPrice(text))) continue

    const rp = readPrice(text)
    const price = rp ? [rp.match] : null
    const negative = !!rp?.negative
    const priceCents = rp?.cents
    const beforePrice = rp ? text.slice(0, rp.index).trim() : text

    // Discount under the previous item
    if (rp && (negative || DISCOUNT_WORDS.test(text))) {
      const last = out.items[out.items.length - 1]
      if (last) {
        last.discountCents += priceCents!
        last.raw.push(text)
        last.notes.push(`discount −$${(priceCents! / 100).toFixed(2)}`)
      } else out.unassignedDiscountCents += priceCents!
      continue
    }

    // Weighed: "0.854 kg NET @ $3.90/kg  3.33", with or without the name before it
    const w = text.match(WEIGHT_AT)
    if (w) {
      const weightKg = parseFloat(w[1])
      const perKg = Math.round(parseFloat(w[2]) * 100)
      const computed = Math.round(weightKg * perKg)
      const nameHere = cleanName(text.slice(0, w.index).trim())
      const name = letters(nameHere) >= 3 ? nameHere : pendingName?.text
      const readOnLine = rp && rp.index >= (w.index ?? 0) + w[0].length - 1 ? rp : undefined
      // an unclear price on a weighed line: take the option closest to weight x price per kg
      const readPrice = readOnLine ? (readOnLine.options ? [...readOnLine.options].sort((a, b) => Math.abs(a - computed) - Math.abs(b - computed))[0] : readOnLine.cents) : undefined
      const it: ParsedItem = {
        raw: [...(pendingName && name === pendingName.text ? [pendingName.text] : []), text],
        name: name ?? 'Unnamed weighed item',
        priceCents: readPrice ?? computed,
        discountCents: 0,
        weightKg,
        pricePerKgCents: perKg,
        confidence: Math.min(conf, pendingName?.conf ?? 1),
        nonFood: false,
        notes: [],
      }
      if (!name) it.confidence -= 0.4
      if (readOnLine?.options) {
        it.confidence -= 0.2
        it.notes.push('decimal point unclear; matched to weight × price per kg')
      }
      if (readPrice === undefined) {
        it.confidence -= 0.2
        it.notes.push('price worked out from weight × price per kg')
      } else if (Math.abs(readPrice - computed) > 2) {
        it.confidence -= 0.3
        it.notes.push(`weight × price per kg is $${(computed / 100).toFixed(2)}, receipt says $${(readPrice / 100).toFixed(2)}`)
      }
      pendingName = null
      pushItem(it)
      continue
    }

    // Quantity: "Qty 2 @ $2.50 each", "2 x 1.89  3.78"
    const q = text.match(QTY)
    if (q && letters(text.replace(/qty|each|ea\b/gi, '').replace(/[A-Z]$/, '')) <= 1) {
      const qty = parseInt(q[1], 10)
      const unit = Math.round(parseFloat(q[2]) * 100)
      const lineTotal = rp && !rp.options && rp.index > (q.index ?? 0) + q[0].length - 2 && rp.cents !== unit ? rp.cents : qty * unit
      if (pendingName) {
        pushItem({
          raw: [pendingName.text, text],
          name: pendingName.text,
          priceCents: lineTotal,
          discountCents: 0,
          quantity: qty,
          unitPriceCents: unit,
          confidence: Math.min(conf, pendingName.conf),
          nonFood: false,
          notes: [],
        })
        pendingName = null
      } else {
        const last = out.items[out.items.length - 1]
        if (last && last.quantity === undefined && Math.abs(last.priceCents - lineTotal) <= 1) {
          // printed BELOW its item
          last.quantity = qty
          last.unitPriceCents = unit
          last.raw.push(text)
        } else pendingQty = { qty, unit, total: lineTotal, raw: text }
      }
      continue
    }

    // Ordinary item: a name and a price
    if (price && letters(beforePrice) >= 2) {
      let name = cleanName(beforePrice)
      let weightKg: number | undefined
      const iw = name.match(INLINE_WEIGHT)
      if (iw) {
        weightKg = parseFloat(iw[1])
        name = name.replace(iw[0], ' ').replace(/\s+/g, ' ').trim()
      }
      if (pendingName && seenItem) warnings.push(`No price found for “${pendingName.text}”: add it on the check screen if it was an item.`)
      pendingName = null
      pushItem({
        raw: [text],
        name,
        priceCents: priceCents!,
        discountCents: 0,
        weightKg,
        pricePerKgCents: weightKg ? Math.round(priceCents! / weightKg) : undefined,
        confidence: conf - (letters(name) < 4 ? 0.2 : 0) - (rp!.options ? 0.35 : 0),
        nonFood: false,
        notes: [],
        priceOptions: rp!.options && rp!.options.length > 1 ? rp!.options : undefined,
      })
      continue
    }

    // Text with no price: probably an item whose weight or quantity is on the next line
    if (letters(text) >= 3) {
      if (pendingName && seenItem) warnings.push(`No price found for “${pendingName.text}”: add it on the check screen if it was an item.`)
      pendingName = { text: cleanName(text), conf }
    }
  }
  if (pendingQty) warnings.push(`Quantity line “${pendingQty.raw}” has no item.`)

  for (const it of out.items) {
    it.pack = packFromName(it.name)
    it.nonFood = NON_FOOD.test(it.name)
    it.confidence = Math.max(0, Math.min(1, it.confidence))
  }
  // Unclear decimal points: pick the prices that make the items add up to the total.
  const unclear = out.items.filter((it) => it.priceOptions)
  const net = () => out.items.reduce((s, it) => s + it.priceCents - it.discountCents, 0) - out.unassignedDiscountCents
  if (unclear.length > 0 && unclear.length <= 10) {
    const totals = out.totalCents !== undefined ? [out.totalCents] : [...new Set(totalCands.map((c) => c.cents))]
    let solved = false
    const combos = 1 << unclear.length
    search: for (const target of totals) {
      for (let mask = 0; mask < combos; mask++) {
        unclear.forEach((it, i) => (it.priceCents = it.priceOptions![(mask >> i) & 1] ?? it.priceOptions![0]))
        if (Math.abs(net() - target) <= 1) {
          if (out.totalCents === undefined) {
            out.totalCents = target
            totalUnclear = false
          }
          solved = true
          break search
        }
      }
    }
    if (!solved) unclear.forEach((it) => (it.priceCents = Math.min(...it.priceOptions!)))
    for (const it of unclear) it.notes.push(solved ? `decimal point unclear: read as $${(it.priceCents / 100).toFixed(2)} so the receipt adds up` : 'decimal point unclear: please check the price')
  }
  if (totalUnclear && out.totalCents === undefined) {
    const t = totalCands.find((c) => c.source === 'total') ?? totalCands[0]
    out.totalCents = t.cents
    warnings.push('The total was hard to read: please check it.')
  }
  out.itemsNetCents = net()
  if (out.totalCents === undefined) warnings.push('No total found on the receipt.')
  else if (Math.abs(out.itemsNetCents - out.totalCents) > 1) {
    warnings.push(`Items add up to $${(out.itemsNetCents / 100).toFixed(2)} but the receipt total is $${(out.totalCents / 100).toFixed(2)}: check the lines marked for review.`)
  }
  if (!out.date) warnings.push('No date found on the receipt.')
  return out
}

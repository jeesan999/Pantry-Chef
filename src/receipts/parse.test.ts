import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cleanName, normaliseLine, packFromName, parseDate, parseReceipt, unclearPriceOptions } from './parse'

const load = (name: string) =>
  parseReceipt(readFileSync(`src/receipts/fixtures/${name}.txt`, 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
const brief = (r: ReturnType<typeof parseReceipt>) =>
  r.items.map((i) => [i.name, i.priceCents, i.discountCents, i.quantity ?? null, i.weightKg ?? null, i.nonFood])

describe('Woolworths-style receipt (test data)', () => {
  const r = load('woolworths')
  it('store, date, total', () => {
    expect(r.storeKey).toBe('woolworths')
    expect(r.date).toBe('2026-11-25')
    expect(r.totalCents).toBe(4988)
  })
  it('items: weighed bananas, discount, quantity above its item, non-food flagged', () => {
    expect(brief(r)).toEqual([
      ['Bananas Cavendish', 333, 0, null, 0.854, false], // 0.854 kg x $3.90 = $3.33
      ['WW Full Cream Milk 3L', 465, 0, null, null, false],
      ['Chicken Breast Fillets 1kg', 1300, 260, null, null, false], // Price Reduced -2.60
      ['Cobram Est EVOO 750ml', 1500, 0, null, null, false],
      ['Avocado Hass', 500, 0, 2, null, false], // Qty 2 @ $2.50
      ['Fairy Dish Liquid 900ml', 650, 0, null, null, true],
      ['Jasmine Rice 2kg', 500, 0, null, null, false],
    ])
  })
  it('items add up to the total: 3.33 + 4.65 + 13.00 − 2.60 + 15.00 + 5.00 + 6.50 + 5.00 = 49.88', () => {
    expect(r.itemsNetCents).toBe(4988)
    expect(r.warnings).toEqual([])
  })
  it('pack sizes from names', () => {
    expect(r.items[1].pack).toEqual({ amount: 3000, unit: 'ml' })
    expect(r.items[2].pack).toEqual({ amount: 1000, unit: 'g' })
  })
})

describe('Coles-style receipt (test data)', () => {
  const r = load('coles')
  it('store, 2-digit-year date, total', () => {
    expect(r.storeKey).toBe('coles')
    expect(r.date).toBe('2026-11-24')
    expect(r.totalCents).toBe(2523)
  })
  it('items: quantity line above, promo saving, weight on next line, GST marker, bags flagged non-food', () => {
    expect(brief(r)).toEqual([
      ['Coles Beef Mince 3 Star 500g', 700, 0, null, null, false],
      ['Coles Lebanese Cucumber', 360, 0, 2, null, false], // 2 @ $1.80
      ['Kikkoman Soy Sauce 250ml', 420, 0, null, null, false],
      ['Coles Garbage Bags 50pk', 350, 0, null, null, true],
      ['Coles Greek Yoghurt 1kg', 550, 100, null, null, false],
      ['Broccoli loose', 243, 0, null, 0.412, false], // 0.412 kg x $5.90 = $2.43
    ])
    expect(r.itemsNetCents).toBe(2523)
    expect(r.warnings).toEqual([])
  })
})

describe('ALDI-style receipt (test data)', () => {
  const r = load('aldi')
  it('dotted date, "SUM AUD" total, tax-code letters ignored', () => {
    expect(r.storeKey).toBe('aldi')
    expect(r.date).toBe('2026-11-23')
    expect(r.totalCents).toBe(2853)
  })
  it('items, with "2 x 1.89  3.78" under its name', () => {
    expect(brief(r)).toEqual([
      ['Free Range Eggs 12pk', 629, 0, null, null, false],
      ['Sweet Potato 1kg', 349, 0, null, null, false],
      ['Greek Style Yoghurt 1kg', 499, 0, null, null, false],
      ['Coconut Oil 300ml', 549, 0, null, null, false],
      ['Rolled Oats 750g', 378, 0, 2, null, false],
      ['Paper Towel 4pk', 449, 0, null, null, true],
    ])
    expect(r.itemsNetCents).toBe(2853)
    expect(r.warnings).toEqual([])
  })
})

describe('Perth independent (Spudshed-style, test data)', () => {
  const r = load('spudshed')
  it('store from the header, weight on the same line, pack size vs weight', () => {
    expect(r.storeKey).toBe('spudshed')
    expect(r.date).toBe('2026-11-22')
    expect(r.totalCents).toBe(2576)
    expect(brief(r)).toEqual([
      ['Potatoes Washed 4kg', 299, 0, null, null, false],
      ['Tomatoes Gourmet', 374, 0, null, 0.75, false],
      ['Onions Brown 2kg', 199, 0, null, null, false],
      ['Garlic Aust', 120, 0, null, null, false],
      ['Carrots 1kg', 99, 0, null, null, false],
      ['Lamb Loin Chops', 1485, 0, null, null, false],
    ])
    expect(r.items[0].pack).toEqual({ amount: 4000, unit: 'g' })
    expect(r.items[1].pricePerKgCents).toBe(499) // 374 / 0.75
    expect(r.warnings).toEqual([])
  })
})

describe('OCR slips and messy input', () => {
  it('fixes common misreads in prices', () => {
    expect(normaliseLine('Soy Sauce   S4.20')).toBe('Soy Sauce   $4.20') // wide gap kept
    expect(normaliseLine('Milk 4,65')).toBe('Milk 4.65')
    expect(normaliseLine('Milk 4. 65')).toBe('Milk 4.65')
    expect(normaliseLine('Steak 1O.50')).toBe('Steak 10.50')
    expect(normaliseLine('Bread — 3.50')).toBe('Bread - 3.50')
    expect(normaliseLine('Carrots 1lkg  0.99')).toBe('Carrots 1kg   0.99')
    expect(normaliseLine('Coffee lkg')).toBe('Coffee 1kg')
    expect(normaliseLine('Coconut 0il 300ml')).toBe('Coconut Oil 300ml')
  })
  it('dates: day first (Australian), named months, invalid rejected', () => {
    expect(parseDate('05/01/2026')).toBe('2026-01-05')
    expect(parseDate('Tue 25 Nov 2026 14:32')).toBe('2026-11-25')
    expect(parseDate('31/13/2026')).toBeUndefined()
  })
  it('cleans names: markers off, ALL CAPS to title case, units kept small', () => {
    expect(cleanName('^WW FULL CREAM MILK 3L')).toBe('WW Full Cream Milk 3L')
    expect(cleanName('BBQ SAUCE 500ML')).toBe('BBQ Sauce 500ml')
    expect(cleanName('BEEF MINCE 1KG')).toBe('Beef Mince 1kg')
    expect(cleanName('#Bananas Cavendish')).toBe('Bananas Cavendish')
    expect(packFromName('Coconut Oil 300ml')).toEqual({ amount: 300, unit: 'ml' })
    expect(packFromName('Lamb Loin Chops')).toBeUndefined()
  })
  it('a total that does not match the items is flagged, not hidden', () => {
    const r = parseReceipt([{ text: 'Coles' }, { text: 'Milk 2L  3.10' }, { text: 'Bread  4.00' }, { text: 'TOTAL  9.10' }, { text: '24/11/2026' }])
    expect(r.itemsNetCents).toBe(710)
    expect(r.warnings.join()).toMatch(/add up to \$7.10 but the receipt total is \$9.10/)
  })
  it('a weighed line whose price disagrees with weight x price is marked for review', () => {
    const r = parseReceipt([{ text: 'Woolworths' }, { text: 'Bananas' }, { text: '1.000 kg NET @ $3.90/kg   4.90' }, { text: 'TOTAL 4.90' }, { text: '1/12/2026' }])
    expect(r.items[0].confidence).toBeLessThan(0.7)
    expect(r.items[0].notes.join()).toMatch(/weight × price per kg is \$3.90/)
  })
  it('a tax code misread as a digit does not change the price', () => {
    const r = parseReceipt(['ALDI', 'Sweet Potato 1kg            3.498', 'Greek Style Yoghurt 1kg      4.99 8B', 'Rolled Oats 750g', '2 x 1.89                3.78 8', 'SUM AUD 12.26'].map((text) => ({ text })))
    expect(r.items.map((i) => [i.name, i.priceCents, i.quantity ?? null])).toEqual([
      ['Sweet Potato 1kg', 349, null], ['Greek Style Yoghurt 1kg', 499, null], ['Rolled Oats 750g', 378, 2],
    ])
    expect(r.warnings).toEqual(['No date found on the receipt.'])
  })
  it('low OCR confidence carries through to the item', () => {
    const r = parseReceipt([{ text: 'IGA' }, { text: 'Butter 250g  4.50', confidence: 40 }, { text: 'TOTAL 4.50' }])
    expect(r.items[0].confidence).toBeCloseTo(0.4)
  })
})

describe('unreadable decimal points are recovered from the receipt arithmetic', () => {
  it('options for an unclear amount', () => {
    expect(unclearPriceOptions('5950')).toEqual([5950, 550]) // $59.50 or $5.50
    expect(unclearPriceOptions('2523')).toEqual([2523, 223])
    expect(unclearPriceOptions('25823')).toEqual([25823, 2523])
    expect(unclearPriceOptions('J299')).toEqual([1299, 199]) // J is a misread 1
    expect(unclearPriceOptions('12')).toEqual([])
  })
  it('the Coles sample as actually read by OCR: $5950, $25823, $2523', () => {
    const ocr = [
      'Coles Supermarkets', 'Coles Beef Mince 3 Star 500g     $7.00', '2 @ $1.80', 'Coles Lebanese Cucumber          $3.60',
      'Kikkoman Soy Sauce 250ml        $4.20', '~Coles Garbage Bags 50pk         $3.50', 'Coles Greek Yoghurt 1kg          $5950',
      'Promotional Price Saving       -$1.00', 'Broccoli loose', '0.412kg @ $5.90/kg               $2.43', 'Subtotal                        $25823',
      'Total savings                     $1.00', 'TOTAL                          $2523', 'Mastercard                      $25823', 'Date 24/11/26 Time 18:05',
    ].map((text) => ({ text, confidence: 90 }))
    const r = parseReceipt(ocr)
    expect(r.totalCents).toBe(2523) // subtotal and card lines agree on 25.23
    expect(r.items.find((i) => i.name.startsWith('Coles Greek'))!.priceCents).toBe(550)
    expect(r.items.find((i) => i.name.startsWith('Coles Greek'))!.notes.join()).toMatch(/read as \$5.50 so the receipt adds up/)
    expect(r.items.find((i) => i.name.startsWith('Coles Garbage'))!.nonFood).toBe(true)
    expect(r.itemsNetCents).toBe(2523)
    expect(r.warnings).toEqual([])
  })
  it('the Spudshed sample as read: "J299" and a garbled TOTAL, rescued by the EFTPOS line', () => {
    const ocr = [
      'SPUDSHED JANDAKOT', 'Tax Invoice', 'Potatoes Washed 4kg            2.99', 'Tomatoes Gourmet      0.75kg 3.74', 'Onions Brown 2Kg               J299',
      'Garlic Aust                    1.20', 'Carrots 1lkg                    0.99', 'Lamb Loin Chops               14.85', 'Total                        2h076',
      'EFTPOS                       25.76', '22/11/2026',
    ].map((text) => ({ text, confidence: 85 }))
    const r = parseReceipt(ocr)
    expect(r.totalCents).toBe(2576)
    expect(r.items.map((i) => [i.name, i.priceCents])).toEqual([
      ['Potatoes Washed 4kg', 299], ['Tomatoes Gourmet', 374], ['Onions Brown 2Kg', 199], ['Garlic Aust', 120], ['Carrots 1kg', 99], ['Lamb Loin Chops', 1485],
    ])
    expect(r.items[2].confidence).toBeLessThan(0.6) // flagged for a look
  })
})

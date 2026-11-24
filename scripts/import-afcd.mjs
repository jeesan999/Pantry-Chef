#!/usr/bin/env node
/**
 * Build-time AFCD import. Converts the FSANZ AFCD Release 3 nutrient spreadsheet into the
 * compact JSON bundled with the app, and matches each interim food to its AFCD food.
 *
 *   node scripts/import-afcd.mjs "path/to/AFCD Release 3 - Nutrient profiles.xlsx"
 *
 * Writes src/data/afcd.json and src/data/afcdMap.json, and prints a match report.
 * The spreadsheet parser runs only here, never in the app.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import * as XLSX from 'xlsx'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'src', 'data')

// Column header patterns (AFCD headers contain line breaks and units; we normalise spaces).
const COLS = {
  key: [/^public food key/i],
  name: [/^food name/i],
  kj: [/energy with dietary fibre, equated.*kj/i, /energy with dietary fibre.*kj/i, /^energy.*\(kj\)/i],
  protein: [/^protein/i],
  fat: [/^fat,? total/i, /^total fat/i],
  sat: [/total saturated fatty acids/i, /saturated fat/i],
  carbs: [/available carbohydrate, with sugar alcohols/i, /available carbohydrate/i],
  sugars: [/^total sugars/i],
  added: [/^added sugars/i],
  fibre: [/total dietary fibre/i, /dietary fibre/i],
  sodium: [/^sodium/i],
}
const REQUIRED = ['key', 'name', 'kj', 'protein', 'fat', 'sat', 'carbs', 'fibre', 'sodium']

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

export function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  let best = null
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
    const h = rows.findIndex((r) => r.some((c) => /^public food key/i.test(norm(c))))
    if (h < 0) continue
    const header = rows[h].map(norm)
    const idx = {}
    for (const [k, pats] of Object.entries(COLS)) {
      for (const p of pats) {
        const i = header.findIndex((c) => p.test(c))
        if (i >= 0) { idx[k] = i; break }
      }
    }
    const missing = REQUIRED.filter((k) => idx[k] === undefined)
    const score = rows.length - h - missing.length * 10000
    if (!best || score > best.score) best = { sheetName, rows, h, idx, missing, header, score }
  }
  if (!best) throw new Error('No sheet with a "Public Food Key" column found')
  if (best.missing.length) throw new Error(`Sheet "${best.sheetName}" is missing columns: ${best.missing.join(', ')}`)

  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0
    if (typeof v === 'string' && /^\s*(<|tr\b|trace)/i.test(v)) return 0 // below detection limit
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const foods = []
  for (const r of best.rows.slice(best.h + 1)) {
    const key = norm(r[best.idx.key])
    const name = norm(r[best.idx.name])
    if (!key || !name) continue
    const g = (k) => (best.idx[k] === undefined ? 0 : num(r[best.idx[k]]))
    // [key, name, kJ, protein, fat, satFat, carbs, sugars, addedSugars, fibre, sodiumMg]
    foods.push([key, name, g('kj'), g('protein'), g('fat'), g('sat'), g('carbs'), g('sugars'), g('added'), g('fibre'), g('sodium')])
  }
  return { sheet: best.sheetName, columns: Object.fromEntries(Object.entries(best.idx).map(([k, i]) => [k, best.header[i]])), foods }
}

/** Pick the AFCD food whose name contains every search word; prefer raw, then the shortest name. */
export function matchFood(search, foods) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = foods.filter(([, name]) => {
    const n = name.toLowerCase()
    return words.every((w) => n.includes(w))
  })
  hits.sort((a, b) => a[1].length - b[1].length)
  return hits
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node scripts/import-afcd.mjs <AFCD nutrient file.xlsx>')
    process.exit(1)
  }
  const parsed = parseWorkbook(readFileSync(file))
  const { INTERIM_FOODS: interim } = await import('../src/data/interimFoods.ts')
  const map = {}
  const report = []
  for (const { key, afcdSearch } of interim) {
    const hits = matchFood(afcdSearch, parsed.foods)
    map[key] = hits[0] ? { afcdKey: hits[0][0], afcdName: hits[0][1], alternatives: hits.slice(1, 6).map((h) => `${h[0]} ${h[1]}`) } : null
    report.push(`${key.padEnd(20)} ${hits[0] ? `${hits[0][0]}  ${hits[0][1]}  (${hits.length} candidates)` : 'NO MATCH'}`)
  }
  const out = { release: 'AFCD Release 3', source: basename(file), sheet: parsed.sheet, columns: parsed.columns, importedAt: new Date().toISOString(), foods: parsed.foods }
  writeFileSync(join(dataDir, 'afcd.json'), JSON.stringify(out))
  writeFileSync(join(dataDir, 'afcdMap.json'), JSON.stringify(map, null, 2))
  console.log(`Sheet "${parsed.sheet}": ${parsed.foods.length} foods`)
  console.log('Columns used:', parsed.columns)
  console.log(report.join('\n'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()

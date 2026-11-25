/**
 * The backup file format and its checks. Pure apart from hashing (Web Crypto).
 * A backup is a zip: manifest.json, data/<table>.json for every table, images/<table>/<id>.<ext>.
 * Older plain-JSON exports ({ app, schema, exportedAt, tables }) are accepted too.
 */
import { FOREIGN_KEYS, SCHEMA_VERSION, STORES, migrateTables, type TableName } from '../../db/schema'
import { SCHEMAS } from '../../db/validation'

export const APP = 'personal-chef'

export interface ImageRef { table: 'recipes' | 'receipts'; id: string; field: 'photo' | 'image'; path: string; type: string }
export interface Manifest {
  app: string
  schema: number
  createdAt: string
  counts: Record<string, number>
  checksums: Record<string, string> // data/<table>.json -> sha-256 hex
  images: ImageRef[]
}
export type Rows = Record<string, Array<Record<string, unknown>>>

/** Where each kind of image lives on its row. */
export const IMAGE_FIELDS: Array<{ table: 'recipes' | 'receipts'; field: 'photo' | 'image' }> = [
  { table: 'recipes', field: 'photo' },
  { table: 'receipts', field: 'image' },
]

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const extFor = (type: string) => (/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg')

export interface Checked { tables: Rows; schema: number; createdAt: string; problems: string[]; counts: Record<string, number> }

/**
 * Check a parsed backup: app, version, checksums, every row against the app's rules, and that
 * every link between rows points at something in the same backup. Older versions are upgraded first.
 */
export async function checkBackup(input: { app?: unknown; schema?: unknown; createdAt?: string; tables: Rows; checksums?: Record<string, string>; rawFiles?: Record<string, string> }): Promise<Checked> {
  const problems: string[] = []
  if (input.app !== APP) problems.push('This isn’t a backup from this app.')
  const schema = Number(input.schema)
  if (!Number.isInteger(schema) || schema < 1) problems.push('The backup has no valid version number.')
  else if (schema > SCHEMA_VERSION) problems.push(`This backup was made by a newer version of the app (data version ${schema}; this app reads up to ${SCHEMA_VERSION}). Update the app first.`)

  if (input.checksums && input.rawFiles) {
    for (const [path, want] of Object.entries(input.checksums)) {
      const raw = input.rawFiles[path]
      if (raw === undefined) problems.push(`${path} is missing from the backup.`)
      else if ((await sha256(raw)) !== want) problems.push(`${path} is damaged (its checksum doesn’t match).`)
    }
  }
  if (problems.length) return { tables: {}, schema, createdAt: input.createdAt ?? '', problems, counts: {} }

  const known = new Set(Object.keys(STORES))
  for (const t of Object.keys(input.tables)) if (!known.has(t)) problems.push(`Unknown table “${t}”.`)
  const tables = migrateTables(input.tables, schema)

  // rows
  const MAX_SHOWN = 8
  let rowProblems = 0
  for (const name of Object.keys(STORES) as TableName[]) {
    const rows = tables[name] ?? []
    const ids = new Set<unknown>()
    for (const r of rows) {
      if (typeof r?.id !== 'string' || !r.id) {
        if (rowProblems++ < MAX_SHOWN) problems.push(`${name}: a row has no id.`)
        continue
      }
      if (ids.has(r.id) && rowProblems++ < MAX_SHOWN) problems.push(`${name}: id ${r.id} appears twice.`)
      ids.add(r.id)
      const schemaFor = SCHEMAS[name]
      if (!schemaFor) continue
      const res = schemaFor.safeParse(r)
      if (!res.success && rowProblems++ < MAX_SHOWN) problems.push(`${name} ${r.id}: ${res.error.issues.map((i) => `${i.path.join('.') || 'row'} ${i.message}`).join('; ')}`)
    }
  }
  // links between rows
  const idSets = new Map<string, Set<unknown>>(Object.keys(STORES).map((t) => [t, new Set((tables[t] ?? []).map((r) => r.id))]))
  for (const fk of FOREIGN_KEYS) {
    for (const r of tables[fk.table] ?? []) {
      const v = r[fk.field]
      if (v === undefined || v === null) {
        if (!fk.optional && rowProblems++ < MAX_SHOWN) problems.push(`${fk.table} ${String(r.id)}: ${fk.field} is missing.`)
        continue
      }
      if (!idSets.get(fk.ref)!.has(v) && rowProblems++ < MAX_SHOWN) problems.push(`${fk.table} ${String(r.id)} points at a missing ${fk.ref} (${String(v)}).`)
    }
  }
  if (rowProblems > MAX_SHOWN) problems.push(`…and ${rowProblems - MAX_SHOWN} more problems.`)
  const counts = Object.fromEntries(Object.keys(STORES).map((t) => [t, (tables[t] ?? []).length]))
  return { tables, schema, createdAt: input.createdAt ?? '', problems, counts }
}

/** The tables people care about, for the preview. */
export const PREVIEW_TABLES: Array<[TableName, string]> = [
  ['recipes', 'Recipes'],
  ['inventory_lots', 'Pantry items'],
  ['receipts', 'Receipts'],
  ['expenses', 'Expenses'],
  ['planned_meals', 'Planned meals'],
  ['meal_consumption', 'Meals and foods logged'],
  ['weight_measurements', 'Weigh-ins'],
  ['shopping_list_items', 'Shopping list items'],
  ['recipe_ratings', 'Recipe ratings'],
]

/**
 * Backup and restore, all on the device. A backup is a zip of every table plus recipe photos and
 * receipt images. Restoring replaces everything, after checking the file and saving a safety copy of
 * what was there, which "Undo restore" brings back.
 */
import Dexie from 'dexie'
import JSZip from 'jszip'
import { IntegrityError, nowIso, type Repo } from '../db/repo'
import { SCHEMA_VERSION, STORES, type TableName } from '../db/schema'
import { SETTINGS_ID } from '../db/seed'
import { APP, IMAGE_FIELDS, checkBackup, extFor, sha256, type Checked, type ImageRef, type Manifest, type Rows } from '../engines/backup/format'
import { emit } from './events'

// ---------- building ----------

/** Every table as plain rows (images taken out and listed separately). */
async function collect(repo: Repo, withImages: boolean): Promise<{ rows: Rows; images: Array<{ ref: ImageRef; blob: Blob }> }> {
  const rows: Rows = {}
  const images: Array<{ ref: ImageRef; blob: Blob }> = []
  for (const name of Object.keys(STORES) as TableName[]) {
    const all = (await repo.db[name].toArray()) as unknown as Array<Record<string, unknown>>
    rows[name] = all.map((r) => {
      const out = { ...r }
      for (const f of IMAGE_FIELDS) {
        if (f.table !== name || !(f.field in out)) continue
        const v = out[f.field]
        delete out[f.field]
        if (withImages && v instanceof Blob && v.size > 0) {
          const type = v.type || 'image/jpeg'
          images.push({ ref: { table: f.table, id: String(r.id), field: f.field, path: `images/${f.table}/${String(r.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.${extFor(type)}`, type }, blob: v })
        }
      }
      return out
    })
  }
  return { rows, images }
}

export async function buildBackup(repo: Repo, opts: { images: boolean; stamp?: boolean } = { images: true }): Promise<{ bytes: Uint8Array; manifest: Manifest }> {
  const { rows, images } = await collect(repo, opts.images)
  const createdAt = nowIso()
  // a backup you keep records itself as the last backup, so restoring it doesn't bring back an older date
  if (opts.stamp) rows.settings = rows.settings.map((r) => (r.id === SETTINGS_ID ? { ...r, lastBackupAt: createdAt } : r))
  const zip = new JSZip()
  const checksums: Record<string, string> = {}
  for (const [name, list] of Object.entries(rows)) {
    const text = JSON.stringify(list)
    const path = `data/${name}.json`
    zip.file(path, text)
    checksums[path] = await sha256(text)
  }
  for (const im of images) zip.file(im.ref.path, new Uint8Array(await im.blob.arrayBuffer()))
  const manifest: Manifest = {
    app: APP,
    schema: SCHEMA_VERSION,
    createdAt,
    counts: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])),
    checksums,
    images: images.map((i) => i.ref),
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }), manifest }
}

const fileName = (kind: 'zip' | 'json') => `personal-chef-backup-${nowIso().slice(0, 10)}.${kind}`

function download(bytes: Uint8Array | string, name: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

/** Save a full backup (with photos) to the device and record the time. */
export async function exportBackup(repo: Repo): Promise<{ name: string; bytes: number }> {
  const { bytes } = await buildBackup(repo, { images: true, stamp: true })
  const name = fileName('zip')
  download(bytes, name, 'application/zip')
  await repo.update('settings', SETTINGS_ID, { lastBackupAt: nowIso() })
  return { name, bytes: bytes.length }
}

/** Data only, as one JSON file (smaller; no photos). */
export async function exportJson(repo: Repo): Promise<void> {
  const { rows } = await collect(repo, false)
  const at = nowIso()
  rows.settings = rows.settings.map((r) => (r.id === SETTINGS_ID ? { ...r, lastBackupAt: at } : r))
  download(JSON.stringify({ app: APP, schema: SCHEMA_VERSION, exportedAt: nowIso(), tables: rows }), fileName('json'), 'application/json')
  await repo.update('settings', SETTINGS_ID, { lastBackupAt: nowIso() })
}

/** Share a full backup through the phone's share sheet (to a drive or another app), where supported. */
export async function shareBackup(repo: Repo): Promise<boolean> {
  const { bytes } = await buildBackup(repo, { images: true, stamp: true })
  const file = new File([bytes as BlobPart], fileName('zip'), { type: 'application/zip' })
  if (!navigator.canShare?.({ files: [file] })) return false
  await navigator.share({ files: [file], title: 'Personal Chef backup' })
  await repo.update('settings', SETTINGS_ID, { lastBackupAt: nowIso() })
  return true
}

// ---------- reading ----------

export interface ParsedBackup extends Checked {
  kind: 'zip' | 'json'
  images: Array<{ ref: ImageRef; blob: Blob }>
  current: Record<string, number> // rows on this phone now, per table
}

/** Read and check a backup file. Writes nothing. */
export async function readBackup(repo: Repo, data: Uint8Array | ArrayBuffer): Promise<ParsedBackup> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const current = Object.fromEntries(await Promise.all(Object.keys(STORES).map(async (t) => [t, await repo.db[t as TableName].count()])))
  const fail = (msg: string): ParsedBackup => ({ kind: 'zip', tables: {}, schema: 0, createdAt: '', problems: [msg], counts: {}, images: [], current })
  const looksZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!looksZip) {
    let json: { app?: unknown; schema?: unknown; exportedAt?: string; tables?: Rows }
    try {
      json = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      return fail('This file isn’t a backup (it’s neither a backup zip nor a backup JSON file).')
    }
    if (!json || typeof json !== 'object' || !json.tables) return fail('This file isn’t a backup from this app.')
    const checked = await checkBackup({ app: json.app, schema: json.schema, createdAt: json.exportedAt, tables: json.tables })
    return { ...checked, kind: 'json', images: [], current }
  }
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
  } catch {
    return fail('The backup file is damaged and can’t be opened.')
  }
  const mf = zip.file('manifest.json')
  if (!mf) return fail('This zip isn’t a backup from this app (no manifest).')
  let manifest: Manifest
  try {
    manifest = JSON.parse(await mf.async('string'))
  } catch {
    return fail('The backup’s manifest is damaged.')
  }
  const rawFiles: Record<string, string> = {}
  const tables: Rows = {}
  for (const path of Object.keys(manifest.checksums ?? {})) {
    const f = zip.file(path)
    if (!f) continue
    rawFiles[path] = await f.async('string')
  }
  const checkedRaw = await checkBackup({ app: manifest.app, schema: manifest.schema, createdAt: manifest.createdAt, tables: {}, checksums: manifest.checksums, rawFiles })
  if (checkedRaw.problems.length) return { ...checkedRaw, kind: 'zip', images: [], current }
  for (const [path, raw] of Object.entries(rawFiles)) {
    try {
      tables[path.replace(/^data\//, '').replace(/\.json$/, '')] = JSON.parse(raw)
    } catch {
      return fail(`${path} can’t be read.`)
    }
  }
  const images: Array<{ ref: ImageRef; blob: Blob }> = []
  const problems: string[] = []
  for (const ref of manifest.images ?? []) {
    const f = zip.file(ref.path)
    if (!f) problems.push(`Image ${ref.path} is missing.`)
    else images.push({ ref, blob: new Blob([(await f.async('uint8array')) as BlobPart], { type: ref.type }) })
  }
  const checked = await checkBackup({ app: manifest.app, schema: manifest.schema, createdAt: manifest.createdAt, tables })
  return { ...checked, problems: [...checked.problems, ...problems], kind: 'zip', images, current }
}

// ---------- safety copy ----------

class SafetyDB extends Dexie {
  snapshots!: Dexie.Table<{ id: string; createdAt: string; bytes: Uint8Array }, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({ snapshots: 'id' })
  }
}
const safetyDbs = new Map<string, SafetyDB>()
const safety = (repo: Repo) => {
  const name = `${repo.db.name}-safety`
  if (!safetyDbs.has(name)) safetyDbs.set(name, new SafetyDB(name))
  return safetyDbs.get(name)!
}

export async function safetySnapshot(repo: Repo): Promise<{ createdAt: string } | null> {
  const s = await safety(repo).snapshots.get('latest')
  return s ? { createdAt: s.createdAt } : null
}

// ---------- restoring ----------

/** Replace every table with the backup's rows in one transaction; any problem rolls it all back. */
async function replaceAll(repo: Repo, parsed: ParsedBackup): Promise<void> {
  const imageBy = new Map(parsed.images.map((i) => [`${i.ref.table}|${i.ref.id}`, i]))
  await repo.tx(async () => {
    for (const name of Object.keys(STORES) as TableName[]) await repo.db[name].clear()
    for (const name of Object.keys(STORES) as TableName[]) {
      const rows = (parsed.tables[name] ?? []).map((r) => {
        const im = imageBy.get(`${name}|${String(r.id)}`)
        return im ? { ...r, [im.ref.field]: im.blob } : r
      })
      if (rows.length) await (repo.db[name] as unknown as Dexie.Table<Record<string, unknown>, string>).bulkAdd(rows)
    }
    const issues = await repo.checkIntegrity()
    if (issues.length) throw new IntegrityError(`The backup’s data doesn’t fit together (${issues.length} problem${issues.length === 1 ? '' : 's'}); nothing was changed.`)
  })
  try {
    sessionStorage.removeItem('chef-thread')
    sessionStorage.removeItem('plan-draft')
  } catch {
    // storage unavailable: nothing to clear
  }
  emit('data-replaced', {})
}

/** Save what's on the phone now as the safety copy, then replace it with the backup. */
export async function restoreBackup(repo: Repo, parsed: ParsedBackup): Promise<void> {
  if (parsed.problems.length) throw new IntegrityError('This backup has problems and can’t be restored.')
  const { bytes } = await buildBackup(repo, { images: true })
  await safety(repo).snapshots.put({ id: 'latest', createdAt: nowIso(), bytes })
  await replaceAll(repo, parsed)
}

/** Put back the data from just before the last restore. */
export async function undoRestore(repo: Repo): Promise<void> {
  const s = await safety(repo).snapshots.get('latest')
  if (!s) throw new IntegrityError('There’s no earlier data to go back to.')
  const parsed = await readBackup(repo, s.bytes)
  if (parsed.problems.length) throw new IntegrityError(`The safety copy can’t be read: ${parsed.problems[0]}`)
  await replaceAll(repo, parsed)
  await safety(repo).snapshots.delete('latest')
}

// ---------- reminder ----------

/** Days since the last backup, if a reminder is due; null when not due. */
export function backupDue(lastBackupAt: string | undefined, reminderDays: number, today: string, since: string | undefined): number | null {
  const days = (from: string) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000)
  if (lastBackupAt) {
    const d = days(lastBackupAt)
    return d >= reminderDays ? d : null
  }
  // never backed up: remind once the app has been in use for a week
  return since && days(since) >= 7 ? Infinity : null
}

import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, STORES, type TableName } from '../db/schema'
import { newId, Repo } from '../db/repo'
import { Pantry } from '../db/pantry'
import { PROFILE_ID, seedIfEmpty } from '../db/seed'
import { approveTargets, proposeTargets } from '../engines/nutrition/service'
import { parseReceipt } from '../receipts/parse'
import { saveReceipt, toCheckedLines } from '../receipts/save'
import { assignMeal } from './day'
import { eatMeal } from './eating'
import { backupDue, buildBackup, readBackup, restoreBackup, safetySnapshot, undoRestore } from './backup'
import { APP } from '../engines/backup/format'

const TODAY = '2026-11-26'
let repo: Repo

async function filled(name = `bk-${newId()}`): Promise<Repo> {
  const db = openDb(name)
  await db.open()
  const r = new Repo(db)
  const pantry = new Pantry(r)
  await seedIfEmpty(r, '2026-11-20')
  const { record } = await proposeTargets(r, TODAY)
  const t = await approveTargets(r, record.id)
  await assignMeal(r, { date: TODAY, slot: 'lunch', time: '14:00', recipeId: 'recipe:au-chicken-rice-bowl', portionScale: 1, targetsId: t.id, targetsVersion: t.version! })
  const p = parseReceipt(readFileSync('src/receipts/fixtures/woolworths.txt', 'utf8').split('\n').map((text) => ({ text, confidence: 92 })))
  await saveReceipt(r, pantry, { store: p.store!, date: p.date!, totalCents: p.totalCents!, lines: await toCheckedLines(r, p, await r.db.foods.toArray()), imageHash: 'h' })
  await eatMeal(r, pantry, (await r.db.planned_meals.toArray())[0].id, 0.5, TODAY)
  await r.insert('weight_measurements', { id: newId(), profileId: PROFILE_ID, date: TODAY, weightKg: 80.4, timeOfDay: 'morning' })
  return r
}
const snapshot = async (r: Repo) => Object.fromEntries(await Promise.all(Object.keys(STORES).map(async (t) => [t, (await r.db[t as TableName].toArray()).sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)))])))

beforeEach(async () => {
  repo = await filled()
})

describe('backup round trip', () => {
  it('back up, wipe, restore: every table matches row for row', async () => {
    const before = await snapshot(repo)
    const { bytes, manifest } = await buildBackup(repo)
    expect(manifest.counts.meal_consumption).toBe(1)
    expect(Object.keys(manifest.checksums)).toHaveLength(30)
    // a different, emptier phone
    const other = new Repo(openDb(`bk2-${newId()}`))
    await other.db.open()
    await seedIfEmpty(other, '2026-11-20')
    const parsed = await readBackup(other, bytes)
    expect(parsed.problems).toEqual([])
    expect(parsed.counts.weight_measurements).toBe(1)
    expect(parsed.current.weight_measurements).toBe(0)
    await restoreBackup(other, parsed)
    expect(await snapshot(other)).toEqual(before)
    expect(await other.checkIntegrity()).toEqual([])
  })

  it('images go into the zip and come back as blobs', async () => {
    const zip = new JSZip()
    const { bytes } = await buildBackup(repo)
    const z = await JSZip.loadAsync(bytes)
    // add a photo to the backup by hand (the test database can't hold blobs) and read it back
    const manifest = JSON.parse(await z.file('manifest.json')!.async('string'))
    manifest.images = [{ table: 'recipes', id: 'recipe:au-chicken-rice-bowl', field: 'photo', path: 'images/recipes/bowl.jpg', type: 'image/jpeg' }]
    for (const name of Object.keys(z.files)) if (!z.files[name].dir && name !== 'manifest.json') zip.file(name, await z.file(name)!.async('uint8array'))
    zip.file('images/recipes/bowl.jpg', new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]))
    zip.file('manifest.json', JSON.stringify(manifest))
    const parsed = await readBackup(repo, await zip.generateAsync({ type: 'uint8array' }))
    expect(parsed.problems).toEqual([])
    expect(parsed.images).toHaveLength(1)
    expect(new Uint8Array(await parsed.images[0].blob.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]))
  })

  it('an old JSON export restores (no photos)', async () => {
    const rows: Record<string, unknown[]> = {}
    for (const t of Object.keys(STORES)) rows[t] = await repo.db[t as TableName].toArray()
    const json = new TextEncoder().encode(JSON.stringify({ app: APP, schema: 2, exportedAt: '2026-11-26T00:00:00Z', tables: rows }))
    const parsed = await readBackup(repo, json)
    expect(parsed).toMatchObject({ kind: 'json', problems: [] })
    await restoreBackup(repo, parsed)
    expect(await repo.db.weight_measurements.count()).toBe(1)
  })

  it('a version 1 backup is upgraded on the way in', async () => {
    const rows: Record<string, unknown[]> = {}
    for (const t of Object.keys(STORES)) rows[t] = await repo.db[t as TableName].toArray()
    rows.meal_consumption = (rows.meal_consumption as Array<Record<string, unknown>>).map(({ date: _d, time: _t, slot: _s, ...c }) => c)
    const parsed = await readBackup(repo, new TextEncoder().encode(JSON.stringify({ app: APP, schema: 1, tables: rows })))
    expect(parsed.problems).toEqual([])
    expect(parsed.tables.meal_consumption[0]).toMatchObject({ date: TODAY, time: '14:00', slot: 'lunch' })
  })
})

describe('refusals leave the data untouched', () => {
  const unchanged = async (bytes: Uint8Array, problem: RegExp) => {
    const before = await snapshot(repo)
    const parsed = await readBackup(repo, bytes)
    expect(parsed.problems.join('\n')).toMatch(problem)
    await expect(restoreBackup(repo, parsed)).rejects.toThrow(/problems/)
    expect(await snapshot(repo)).toEqual(before)
  }
  const edit = async (fn: (z: JSZip, m: Record<string, unknown>) => Promise<void> | void) => {
    const z = await JSZip.loadAsync((await buildBackup(repo)).bytes)
    const m = JSON.parse(await z.file('manifest.json')!.async('string'))
    await fn(z, m)
    z.file('manifest.json', JSON.stringify(m))
    return z.generateAsync({ type: 'uint8array' })
  }

  it('not a backup', async () => {
    await unchanged(new TextEncoder().encode('hello'), /isn’t a backup/)
    await unchanged(new TextEncoder().encode('{"tables":{}}'), /isn’t a backup from this app/)
  })
  it('a newer version', async () => unchanged(await edit((_z, m) => { m.schema = 99 }), /newer version of the app/))
  it('a damaged data file', async () => unchanged(await edit((z) => { z.file('data/recipes.json', '[]') }), /recipes\.json is damaged/))
  it('an invalid row', async () => {
    const bad = await edit(async (z, m) => {
      const rows = JSON.parse(await z.file('data/weight_measurements.json')!.async('string'))
      rows[0].weightKg = 5
      const text = JSON.stringify(rows)
      z.file('data/weight_measurements.json', text)
      ;(m.checksums as Record<string, string>)['data/weight_measurements.json'] = await (await import('../engines/backup/format')).sha256(text)
    })
    await unchanged(bad, /weight_measurements .*weightKg/)
  })
  it('a broken link between rows', async () => {
    const bad = await edit(async (z, m) => {
      const text = '[]'
      z.file('data/recipes.json', text) // planned meals and ingredients now point at nothing
      ;(m.checksums as Record<string, string>)['data/recipes.json'] = await (await import('../engines/backup/format')).sha256(text)
    })
    await unchanged(bad, /points at a missing recipes/)
  })
})

describe('rollback', () => {
  it('if the data fails the final integrity check inside the restore, nothing changes', async () => {
    const before = await snapshot(repo)
    const parsed = await readBackup(repo, (await buildBackup(repo)).bytes)
    parsed.tables = { ...parsed.tables, recipes: [] } // forced past the checks: links now dangle
    await expect(restoreBackup(repo, parsed)).rejects.toThrow(/doesn’t fit together/)
    expect(await snapshot(repo)).toEqual(before)
  })
})

describe('safety copy', () => {
  it('restoring keeps a copy of what was there; undo restore brings it back', async () => {
    const before = await snapshot(repo)
    const empty = new Repo(openDb(`bk3-${newId()}`))
    await empty.db.open()
    await seedIfEmpty(empty, '2026-11-20')
    const parsed = await readBackup(repo, (await buildBackup(empty)).bytes)
    expect(await safetySnapshot(repo)).toBeNull()
    await restoreBackup(repo, parsed)
    expect(await repo.db.weight_measurements.count()).toBe(0)
    expect(await safetySnapshot(repo)).not.toBeNull()
    await undoRestore(repo)
    expect(await snapshot(repo)).toEqual(before)
    expect(await safetySnapshot(repo)).toBeNull()
  })
})

describe('the backup remembers itself', () => {
  it('a kept backup records its own time as the last backup', async () => {
    const { bytes, manifest } = await buildBackup(repo, { images: true, stamp: true })
    const parsed = await readBackup(repo, bytes)
    expect(parsed.tables.settings[0].lastBackupAt).toBe(manifest.createdAt)
    const plain = await readBackup(repo, (await buildBackup(repo)).bytes)
    expect(plain.tables.settings[0].lastBackupAt).toBeUndefined()
  })
})

describe('reminder', () => {
  it('due after the set number of days; never-backed-up reminds after a week of use', () => {
    expect(backupDue('2026-11-20T10:00:00Z', 7, '2026-11-26', undefined)).toBeNull()
    expect(backupDue('2026-11-18T10:00:00Z', 7, '2026-11-26', undefined)).toBe(8)
    expect(backupDue(undefined, 7, '2026-11-26', '2026-11-22')).toBeNull()
    expect(backupDue(undefined, 7, '2026-11-26', '2026-11-19')).toBe(Infinity)
  })
})

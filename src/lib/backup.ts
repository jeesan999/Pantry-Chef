import { db } from '../db/instance'
import { repo } from '../db/instance'
import { nowIso } from '../db/repo'
import { SETTINGS_ID } from '../db/seed'

/**
 * Quick JSON backup of every table (photos and receipt images are left out; the full zip
 * backup with images and restore arrive in Phase 8). The file is saved to the device.
 */
export async function exportBackup(): Promise<void> {
  const out: Record<string, unknown[]> = {}
  for (const t of db.tables) {
    out[t.name] = (await t.toArray()).map((r) => {
      const { photo: _p, image: _i, ...rest } = r as Record<string, unknown>
      return rest
    })
  }
  const blob = new Blob([JSON.stringify({ app: 'personal-chef', schema: 1, exportedAt: nowIso(), tables: out })], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `personal-chef-backup-${nowIso().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  await repo.update('settings', SETTINGS_ID, { lastBackupAt: nowIso() })
}

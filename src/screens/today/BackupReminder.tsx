import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Notice } from '../../components/ui'
import { db, repo, today } from '../../db/instance'
import { backupDue, exportBackup } from '../../lib/backup'
import { useSettings } from '../../lib/hooks'

/** "Last backup 9 days ago. Back up now" on Today, when a backup is due. */
export function BackupReminder() {
  const settings = useSettings()
  const since = useLiveQuery(async () => (await db.nutrition_targets.orderBy('id').toArray()).map((t) => t.createdAt).sort()[0])
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle')
  if (!settings) return null
  const due = backupDue(settings.lastBackupAt, settings.backupReminderDays, today(), since)
  if (state === 'done') return <Notice tone="leaf">Backup saved to your downloads. Keep a copy off this phone.</Notice>
  if (due === null) return null
  const go = async () => {
    setState('busy')
    try {
      await exportBackup(repo)
      setState('done')
    } catch (e) {
      setState((e as Error).message)
    }
  }
  return (
    <Notice tone="stone">
      {due === Infinity ? 'You haven’t backed up yet. Your data lives only on this phone.' : `Last backup ${due} days ago.`}{' '}
      <button type="button" className="font-medium underline" disabled={state === 'busy'} onClick={go}>{state === 'busy' ? 'Backing up…' : 'Back up now'}</button>
      {' · '}<Link to="/settings" className="underline">Settings</Link>
      {state !== 'idle' && state !== 'busy' && <span className="block text-red-700">{state}</span>}
    </Notice>
  )
}

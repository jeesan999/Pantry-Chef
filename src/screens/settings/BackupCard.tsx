import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, Notice, Sheet } from '../../components/ui'
import { repo } from '../../db/instance'
import { SETTINGS_ID } from '../../db/seed'
import { PREVIEW_TABLES } from '../../engines/backup/format'
import { exportBackup, exportJson, readBackup, restoreBackup, safetySnapshot, shareBackup, undoRestore, type ParsedBackup } from '../../lib/backup'
import { useSettings } from '../../lib/hooks'

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never')

export function BackupCard() {
  const settings = useSettings()
  const snap = useLiveQuery(() => safetySnapshot(repo))
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'red'; text: string } | null>(null)
  const [parsed, setParsed] = useState<ParsedBackup | null>(null)
  const [days, setDays] = useState<string | null>(null)
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setMsg(null)
    try {
      const text = await fn()
      if (text) setMsg({ tone: 'leaf', text })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const onFile = (f?: File) => {
    if (!f) return
    void run('reading', async () => {
      setParsed(await readBackup(repo, await f.arrayBuffer()))
    })
  }
  const saveDays = () =>
    run('days', async () => {
      const n = Number(days)
      if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error('Choose 1 to 60 days.')
      await repo.update('settings', SETTINGS_ID, { backupReminderDays: n })
      setDays(null)
      return `You’ll be reminded every ${n} day${n === 1 ? '' : 's'}.`
    })

  return (
    <Card title="Backup & restore">
      <div className="space-y-3 text-sm">
        <p className="text-stone-600">
          Your data lives only on this phone. Last backup: <b data-testid="last-backup">{when(settings?.lastBackupAt)}</b>.
        </p>
        <p className="text-stone-600">
          Storage: {persisted === null ? 'unknown' : persisted ? 'protected from automatic clearing' : 'not protected yet'}.{' '}
          {persisted === false && (
            <button type="button" className="font-medium text-leaf-700 underline" onClick={() => navigator.storage?.persist?.().then(setPersisted)}>Ask to protect it</button>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button className="col-span-2" disabled={!!busy} onClick={() => run('backup', async () => {
            const r = await exportBackup(repo)
            return `Saved ${r.name} (${(r.bytes / 1024).toFixed(0)} KB) to your downloads. Keep a copy off this phone.`
          })}>{busy === 'backup' ? 'Making backup…' : 'Back up now (with photos)'}</Button>
          {canShare && (
            <Button variant="secondary" disabled={!!busy} onClick={() => run('share', async () => ((await shareBackup(repo)) ? 'Backup shared.' : 'Sharing files isn’t supported here; use Back up now.'))}>Share backup…</Button>
          )}
          <Button variant="secondary" className={canShare ? '' : 'col-span-2'} disabled={!!busy} onClick={() => run('json', async () => { await exportJson(repo); return 'Saved the data-only file (no photos).' })}>Data only (JSON)</Button>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone-300 px-3 text-center font-medium text-stone-700 hover:bg-stone-50">
          {busy === 'reading' ? 'Checking the file…' : 'Restore from a backup file…'}
          <input type="file" accept=".zip,.json,application/zip,application/json" className="sr-only" aria-label="Choose a backup file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>

        {snap && (
          <Notice tone="stone">
            A safety copy from before your last restore is kept ({when(snap.createdAt)}).{' '}
            <button type="button" className="font-medium underline" disabled={!!busy} onClick={() => run('undo', async () => { await undoRestore(repo); return 'Your data is back as it was before the restore.' })}>Undo restore</button>
          </Notice>
        )}

        {days === null ? (
          <p className="text-stone-600">
            Reminder every {settings?.backupReminderDays ?? 7} days.{' '}
            <button type="button" className="font-medium text-leaf-700 underline" onClick={() => setDays(String(settings?.backupReminderDays ?? 7))}>Change</button>
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Field label="Remind me every (days)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            <Button onClick={saveDays}>Save</Button>
          </div>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
      {parsed && <RestoreSheet parsed={parsed} onClose={() => setParsed(null)} onDone={(text) => { setParsed(null); setMsg({ tone: 'leaf', text }) }} />}
    </Card>
  )
}

function RestoreSheet({ parsed, onClose, onDone }: { parsed: ParsedBackup; onClose: () => void; onDone: (text: string) => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ok = parsed.problems.length === 0
  const restore = async () => {
    setBusy(true)
    setErr('')
    try {
      await restoreBackup(repo, parsed)
      onDone('Restored. Your previous data is kept as a safety copy: use “Undo restore” if this wasn’t what you wanted.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()} title={ok ? 'Restore this backup?' : 'This backup can’t be restored'}>
      {ok ? (
        <div className="space-y-3 text-sm">
          <p className="text-stone-700">
            Made {parsed.createdAt ? when(parsed.createdAt) : 'at an unknown time'}{parsed.kind === 'json' ? ' (data only, no photos)' : `, ${parsed.images.length} photo${parsed.images.length === 1 ? '' : 's'}`}.
          </p>
          <table className="tabular w-full text-left">
            <thead className="text-xs text-stone-500"><tr><th className="py-1 font-normal" /><th className="py-1 pl-3 text-right font-normal">Backup</th><th className="py-1 pl-3 text-right font-normal">This phone</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {PREVIEW_TABLES.map(([t, label]) => (
                <tr key={t}><td className="py-1 text-stone-700">{label}</td><td className="py-1 pl-3 text-right">{parsed.counts[t] ?? 0}</td><td className="py-1 pl-3 text-right text-stone-500">{parsed.current[t] ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
          <Notice>Everything on this phone is <b>replaced</b> by the backup (not merged). A safety copy of what’s here now is kept, so you can undo.</Notice>
          <Field label="Type REPLACE to confirm"><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
          {err && <Notice tone="red">{err}</Notice>}
          <Button variant="danger" className="w-full" disabled={busy || typed.trim().toUpperCase() !== 'REPLACE'} onClick={restore}>{busy ? 'Restoring…' : 'Replace all data on this phone'}</Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-red-800">{parsed.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          <p className="text-stone-600">Nothing on this phone was changed.</p>
          <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
        </div>
      )}
    </Sheet>
  )
}

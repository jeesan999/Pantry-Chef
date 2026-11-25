import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button, Notice } from '../../components/ui'
import { repo, today } from '../../db/instance'
import { reportion, staleTargets } from '../../lib/planner'
import { on } from '../../lib/events'

// Kept outside the component so Undo survives switching screens.
let lastUndo: { undo: () => Promise<void>; count: number } | null = null
on('data-replaced', () => { lastUndo = null })

/** "Targets changed: re-portion upcoming meals?" Shown on Today and Plan after new targets are approved. */
export function StaleTargets() {
  const now = today()
  const stale = useLiveQuery(() => staleTargets(repo, now), [now])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [, rerender] = useState(0)

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await reportion(repo, now)
      const undo = await r.apply()
      lastUndo = { undo, count: r.changes.length }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      rerender((x) => x + 1)
    }
  }
  const undo = async () => {
    if (!lastUndo) return
    setBusy(true)
    try {
      await lastUndo.undo()
    } finally {
      lastUndo = null
      setBusy(false)
      rerender((x) => x + 1)
    }
  }

  if (stale) {
    return (
      <Notice tone="ember">
        <p>Your targets changed (now v{stale.version}). {stale.meals} upcoming meal{stale.meals === 1 ? ' was' : 's were'} portioned for the old ones.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button className="min-h-9" onClick={run} disabled={busy}>Re-portion upcoming meals</Button>
        </div>
        <p className="mt-1.5 text-xs">Keeps the same recipes and resizes each portion to the new protein targets. Or replan the week below.</p>
        {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      </Notice>
    )
  }
  if (lastUndo) {
    return (
      <Notice tone="leaf">
        Re-portioned {lastUndo.count} meal{lastUndo.count === 1 ? '' : 's'} for your new targets.{' '}
        <button type="button" className="font-medium underline" onClick={undo} disabled={busy}>Undo</button>
      </Notice>
    )
  }
  return null
}

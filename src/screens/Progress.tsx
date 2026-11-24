import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, ComingInPhase, Field, Input, Notice, Page, Select, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import { newId } from '../db/repo'
import { PROFILE_ID } from '../db/seed'
import type { WeightMeasurement } from '../db/types'

export default function ProgressScreen() {
  const weights = useLiveQuery(() => db.weight_measurements.orderBy('date').reverse().toArray())
  const waists = useLiveQuery(() => db.waist_measurements.orderBy('date').reverse().toArray())
  const [date, setDate] = useState(today())
  const [kg, setKg] = useState('')
  const [tod, setTod] = useState<WeightMeasurement['timeOfDay']>('morning')
  const [waist, setWaist] = useState('')
  const [bf, setBf] = useState('')
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'red'; text: string }>()

  const save = async () => {
    setMsg(undefined)
    try {
      if (!kg && !waist) throw new Error('Enter a weight or a waist measurement.')
      await repo.tx(async () => {
        if (kg) await repo.insert('weight_measurements', { id: newId(), profileId: PROFILE_ID, date, weightKg: Number(kg), timeOfDay: tod })
        if (waist) await repo.insert('waist_measurements', { id: newId(), profileId: PROFILE_ID, date, waistCm: Number(waist), bodyFatPct: bf ? Number(bf) : undefined })
      })
      setKg(''); setWaist(''); setBf('')
      setMsg({ tone: 'leaf', text: 'Saved.' })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }

  return (
    <Page title="Progress">
      <Card title="Log a measurement">
        <div className="space-y-3">
          {msg && <Notice tone={msg.tone}>{msg.text}{msg.tone === 'leaf' && kg === '' && <> Your latest weight is used next time targets are calculated. <Link className="underline" to="/goals">Recalculate</Link></>}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Time of day"><Select value={tod} onChange={(e) => setTod(e.target.value as WeightMeasurement['timeOfDay'])}><option value="morning">Morning</option><option value="midday">Midday</option><option value="evening">Evening</option></Select></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Weight (kg)"><Input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
            <Field label="Waist (cm)"><Input inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
            <Field label="Body fat %" hint="optional"><Input inputMode="decimal" value={bf} onChange={(e) => setBf(e.target.value)} /></Field>
          </div>
          <Button className="w-full" onClick={save}>Save</Button>
        </div>
      </Card>
      <Card title="Recent">
        {!weights?.length && !waists?.length ? (
          <p className="text-sm text-stone-500">No measurements yet. Weigh in on the same scale, in the morning, for the most useful trend.</p>
        ) : (
          <ul className="tabular divide-y divide-stone-100 text-sm">
            {(weights ?? []).slice(0, 14).map((w) => <li key={w.id} className="flex justify-between py-2"><span>{fmt.date(w.date)} · {w.timeOfDay}</span><span>{w.weightKg} kg</span></li>)}
            {(waists ?? []).slice(0, 6).map((w) => <li key={w.id} className="flex justify-between py-2 text-stone-600"><span>{fmt.date(w.date)} · waist</span><span>{w.waistCm} cm{w.bodyFatPct ? ` · ${w.bodyFatPct}% fat` : ''}</span></li>)}
          </ul>
        )}
      </Card>
      <ComingInPhase phase={7} what="7-day rolling averages, monthly trends, goal progress, and suggested target adjustments from your real weight trend, for you to approve." />
    </Page>
  )
}

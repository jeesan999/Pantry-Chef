import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Field, Input, Notice, Page, Select, cx, fmt } from '../components/ui'
import { repo, today } from '../db/instance'
import { newId } from '../db/repo'
import { PROFILE_ID } from '../db/seed'
import type { WeightMeasurement } from '../db/types'
import { addDays } from '../engines/nutrition/engine'
import { fmtRate, hasRate } from '../engines/progress/engine'
import { deleteWaist, deleteWeight, loadProgress, proposeCalibration, setGoalTargets, type ProgressData } from '../lib/progress'
import { WaistChart, WeightChart } from './progress/charts'

const RANGES: Array<[string, number | null]> = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', null]]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)} ${unit}`

export default function ProgressScreen() {
  const now = today()
  const data = useLiveQuery(() => loadProgress(repo, now), [now])
  if (!data) return <Page title="Progress">{null}</Page>
  return (
    <Page title="Progress">
      <Summary d={data} />
      <WeightCard d={data} />
      <GoalCard d={data} />
      <AdjustCard d={data} />
      <LogCard />
      {data.months.length > 0 && <MonthsCard d={data} />}
      <HistoryCard d={data} />
    </Page>
  )
}

function Summary({ d }: { d: ProgressData }) {
  const change = d.latestAvg !== null && d.weekAgoAvg !== null ? d.latestAvg - d.weekAgoAvg : null
  const waist = d.waists[d.waists.length - 1]
  return (
    <Card>
      <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-stone-500">7-day average</dt>
          <dd className="text-2xl font-semibold text-stone-900" data-testid="avg-weight">{d.latestAvg !== null ? `${d.latestAvg.toFixed(1)} kg` : '—'}</dd>
          <dd className="text-xs text-stone-500">{change !== null ? `${signed(change, 'kg')} on a week before` : d.latestKg !== null ? `Latest ${d.latestKg.toFixed(1)} kg · needs 3 weigh-ins in 7 days` : 'No weigh-ins yet'}</dd>
        </div>
        <div>
          <dt className="text-stone-500">4-week trend</dt>
          <dd className="text-lg font-semibold text-stone-900" data-testid="trend">{hasRate(d.rate) ? fmtRate(d.rate.kgPerWeek) : '—'}</dd>
          <dd className="text-xs text-stone-500">{hasRate(d.rate) ? `${signed(d.rate.kgPerWeek, 'kg')}/week from ${d.rate.points} weigh-ins` : d.rate.why}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Waist</dt>
          <dd className="text-lg font-semibold text-stone-900">{waist ? `${waist.waistCm} cm` : '—'}</dd>
          <dd className="text-xs text-stone-500">{waist ? fmt.date(waist.date) : 'Not measured yet'}</dd>
        </div>
      </dl>
    </Card>
  )
}

function WeightCard({ d }: { d: ProgressData }) {
  const [range, setRange] = useState<number | null>(91)
  const from = range ? addDays(today(), -range) : '0000'
  const rows = d.daily.filter((r) => r.date >= from)
  const waists = d.waists.filter((w) => w.date >= from).map((w) => ({ date: w.date, cm: w.waistCm }))
  if (!d.daily.length) return null
  return (
    <Card title="Weight">
      <div role="radiogroup" aria-label="Chart range" className="mb-3 grid grid-cols-5 rounded-xl bg-stone-100 p-1">
        {RANGES.map(([l, v]) => (
          <button key={l} role="radio" aria-checked={range === v} onClick={() => setRange(v)}
            className={cx('min-h-9 rounded-lg text-sm font-medium transition', range === v ? 'bg-white text-leaf-700 shadow-sm' : 'text-stone-600')}>{l}</button>
        ))}
      </div>
      {rows.length ? <WeightChart rows={rows} targetKg={d.goal.targetWeightKg} /> : <p className="text-sm text-stone-500">No weigh-ins in this range.</p>}
      {waists.length > 1 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium text-stone-700">Waist</h3>
          <WaistChart rows={waists} targetCm={d.goal.targetWaistCm} />
        </div>
      )}
    </Card>
  )
}

function GoalCard({ d }: { d: ProgressData }) {
  const [editing, setEditing] = useState(false)
  const [kg, setKg] = useState('')
  const [cm, setCm] = useState('')
  const [err, setErr] = useState('')
  const p = d.progress
  const open = () => {
    setKg(d.goal.targetWeightKg ? String(d.goal.targetWeightKg) : '')
    setCm(d.goal.targetWaistCm ? String(d.goal.targetWaistCm) : '')
    setErr('')
    setEditing(true)
  }
  const save = async () => {
    setErr('')
    const w = kg.trim() ? Number(kg) : null
    const c = cm.trim() ? Number(cm) : null
    if ((w !== null && !(w >= 30 && w <= 300)) || (c !== null && !(c >= 40 && c <= 200))) return setErr('Enter a weight of 30–300 kg and a waist of 40–200 cm, or leave them empty.')
    try {
      await setGoalTargets(repo, { targetWeightKg: w, targetWaistCm: c })
      setEditing(false)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Card title="Goal progress" action={!editing && <Button variant="ghost" onClick={open}>{d.goal.targetWeightKg || d.goal.targetWaistCm ? 'Change' : 'Set a target'}</Button>}>
      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target weight (kg)"><Input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="None" /></Field>
            <Field label="Target waist (cm)"><Input inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} placeholder="None" /></Field>
          </div>
          {err && <Notice tone="red">{err}</Notice>}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={save}>Save targets</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          <p className="text-xs text-stone-500">These are for tracking only. Your calories follow your goal type on the Goals screen.</p>
        </div>
      ) : p ? (
        <div className="tabular space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-stone-600">Start {p.startKg.toFixed(1)} kg</span><span className="font-medium">Target {p.targetKg} kg</span></div>
          <div className="h-2.5 rounded-full bg-stone-100" role="meter" aria-label="Progress to target weight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}>
            <div className="h-2.5 rounded-full bg-leaf-600" style={{ width: `${p.pct}%` }} />
          </div>
          <p className="text-stone-700">
            {p.reached ? <>Target reached <Badge tone="leaf">done</Badge></> : <>{p.pct}% of the way · <b>{p.toGoKg.toFixed(1)} kg</b> to go</>}
          </p>
          {!p.reached && <p className="text-stone-600">{p.eta ? `At your current trend: about ${fmt.date(p.eta)}${p.eta.slice(0, 4) !== today().slice(0, 4) ? ` ${p.eta.slice(0, 4)}` : ''}.` : hasRate(d.rate) ? 'Your trend isn’t heading towards the target yet.' : 'A finish date appears once there’s a 4-week trend.'}</p>}
          {d.goal.targetWaistCm && <p className="text-stone-600">Waist target {d.goal.targetWaistCm} cm{d.waists.length ? ` · now ${d.waists[d.waists.length - 1].waistCm} cm` : ''}</p>}
        </div>
      ) : (
        <p className="text-sm text-stone-600">{d.goal.targetWaistCm ? `Waist target ${d.goal.targetWaistCm} cm. ` : ''}Set a target weight to see how far along you are and when you might get there.</p>
      )}
    </Card>
  )
}

function AdjustCard({ d }: { d: ProgressData }) {
  const [state, setState] = useState<{ tone: 'leaf' | 'red'; text: string } | null>(null)
  const a = d.adjustment
  const propose = async () => {
    if (a.kind !== 'suggest') return
    setState(null)
    try {
      await proposeCalibration(repo, today(), a)
      setState({ tone: 'leaf', text: 'Proposed.' })
    } catch (e) {
      setState({ tone: 'red', text: (e as Error).message })
    }
  }
  return (
    <Card title="Targets check">
      {a.kind === 'suggest' ? (
        <div className="space-y-3 text-sm">
          <p className="text-stone-700">{a.reason}</p>
          <p className="tabular text-stone-600">Calories would go {a.kcalChange < 0 ? 'down' : 'up'} by about {Math.abs(a.kcalChange)} kcal a day. Your goal stays the same.</p>
          {state?.tone === 'leaf' ? (
            <Notice tone="leaf">New targets proposed. <Link to="/goals" className="font-medium underline">Review and approve them on Goals</Link>.</Notice>
          ) : (
            <Button className="w-full" onClick={propose}>Propose new targets</Button>
          )}
          {state?.tone === 'red' && <Notice tone="red">{state.text} <Link to="/goals" className="underline">Open Goals</Link></Notice>}
        </div>
      ) : (
        <p className="text-sm text-stone-600">{a.why}</p>
      )}
      <p className="mt-2 text-xs text-stone-500">Compares your weight trend with what your targets expect, assuming you ate to plan. Nothing changes until you approve it.</p>
    </Card>
  )
}

function LogCard() {
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
    <Card title="Log a measurement">
      <div className="space-y-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
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
        <p className="text-xs text-stone-500">For the clearest trend, weigh in each morning after the bathroom, before eating. Morning weigh-ins are used over others on the same day.</p>
      </div>
    </Card>
  )
}

function MonthsCard({ d }: { d: ProgressData }) {
  return (
    <Card title="Monthly">
      <table className="tabular w-full text-left text-sm">
        <thead className="text-xs text-stone-500">
          <tr><th className="py-1 font-normal">Month</th><th className="py-1 text-right font-normal">Average</th><th className="py-1 text-right font-normal">Change</th><th className="py-1 text-right font-normal">Waist</th><th className="py-1 text-right font-normal">Weigh-ins</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {d.months.map((m) => (
            <tr key={m.month}>
              <td className="py-1.5 text-stone-700">{monthName(m.month)}</td>
              <td className="py-1.5 text-right">{m.avgKg !== null ? `${m.avgKg.toFixed(1)} kg` : '—'}</td>
              <td className="py-1.5 text-right text-stone-600">{m.changeKg !== null ? signed(m.changeKg, 'kg') : '—'}</td>
              <td className="py-1.5 text-right text-stone-600">{m.avgWaistCm !== null ? `${m.avgWaistCm} cm` : '—'}</td>
              <td className="py-1.5 text-right text-stone-600">{m.weighIns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function HistoryCard({ d }: { d: ProgressData }) {
  const [all, setAll] = useState(false)
  const entries = [
    ...d.weights.map((w) => ({ id: w.id, date: w.date, kind: 'weight' as const, text: `${w.weightKg} kg`, sub: w.timeOfDay })),
    ...d.waists.map((w) => ({ id: w.id, date: w.date, kind: 'waist' as const, text: `${w.waistCm} cm waist`, sub: w.bodyFatPct ? `${w.bodyFatPct}% body fat` : '' })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const shown = all ? entries : entries.slice(0, 10)
  return (
    <Card title="History">
      {!entries.length ? (
        <p className="text-sm text-stone-500">No measurements yet. Weigh in on the same scale, in the morning, for the most useful trend.</p>
      ) : (
        <>
          <ul className="tabular divide-y divide-stone-100 text-sm">
            {shown.map((e) => (
              <li key={e.id} className="flex min-h-11 items-center justify-between gap-2">
                <span className="text-stone-600">{fmt.date(e.date)}{e.sub ? ` · ${e.sub}` : ''}</span>
                <span className="flex items-center gap-1">
                  <span className="font-medium text-stone-800">{e.text}</span>
                  <Button variant="ghost" className="px-2 text-stone-500" aria-label={`Delete ${e.text} on ${fmt.date(e.date)}`}
                    onClick={() => (e.kind === 'weight' ? deleteWeight(repo, e.id) : deleteWaist(repo, e.id))}>✕</Button>
                </span>
              </li>
            ))}
          </ul>
          {entries.length > 10 && <Button variant="ghost" className="mt-1 w-full" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${entries.length}`}</Button>}
        </>
      )}
    </Card>
  )
}

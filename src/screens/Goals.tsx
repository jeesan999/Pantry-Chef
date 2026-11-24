import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Field, Notice, Page, Select, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import type { NutritionTargetRecord } from '../db/types'
import type { GoalType } from '../engines/contract'
import { ACTIVITY_LEVELS, GOAL_RULES, computeTargets } from '../engines/nutrition/engine'
import { approveTargets, buildInputs, changeGoal, proposeTargets, rejectTargets } from '../engines/nutrition/service'
import { SLOT_LABEL } from '../lib/day'
import { useApprovedTargets, useProposedTargets } from '../lib/hooks'
import { SLOTS } from '../engines/contract'

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function GoalsScreen() {
  const approved = useApprovedTargets()
  const proposed = useProposedTargets()
  const goal = useLiveQuery(async () => (await db.body_goals.toArray()).filter((g) => !g.endDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  const history = useLiveQuery(() => db.nutrition_targets.where('status').anyOf('approved', 'superseded').reverse().sortBy('version'))
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // First visit with nothing proposed or approved: calculate a proposal automatically.
  useEffect(() => {
    if (approved === null && proposed === null) proposeTargets(repo, today()).catch((e) => setError(String(e)))
  }, [approved, proposed])

  // Warnings are not stored; recompute them for the record on screen.
  const shown = proposed ?? approved
  useEffect(() => {
    if (!shown) return
    buildInputs(repo, shown.weekStart).then((i) => setWarnings(computeTargets(i).warnings)).catch(() => setWarnings([]))
  }, [shown])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Goals & Targets" subtitle="Targets are proposed, then approved by you. Only approval changes your plan.">
      {error && <Notice tone="red">{error}</Notice>}
      {goal && <GoalCard goalType={goal.type} adjust={goal.energyAdjustPct} busy={busy} onChange={(t, p) => run(() => changeGoal(repo, t, p, today()))} />}

      {proposed && (
        <Card title={<span className="flex items-center gap-2">Proposed targets <Badge tone="ember">awaiting approval</Badge></span>}>
          <TargetsView rec={proposed} compareTo={approved ?? undefined} />
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {warnings.map((w) => <li key={w}><Notice>{w}</Notice></li>)}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Button disabled={busy} onClick={() => run(() => approveTargets(repo, proposed.id))} className="flex-1">Approve</Button>
            <Button disabled={busy} variant="secondary" onClick={() => run(() => rejectTargets(repo, proposed.id))}>Reject</Button>
          </div>
        </Card>
      )}

      {approved && (
        <Card title={<span className="flex items-center gap-2">Current targets <Badge tone="leaf">v{approved.version}</Badge></span>}
          action={!proposed && <Button variant="ghost" disabled={busy} onClick={() => run(() => proposeTargets(repo, today()))}>Recalculate</Button>}>
          <TargetsView rec={approved} />
          {!proposed && warnings.length > 0 && <ul className="mt-3 space-y-1.5">{warnings.map((w) => <li key={w}><Notice tone="stone">{w}</Notice></li>)}</ul>}
        </Card>
      )}

      {history && history.length > 1 && (
        <Card title="History">
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="tabular flex justify-between text-stone-600">
                <span>v{h.version} · {GOAL_RULES[h.targetSet.goal].label}</span>
                <span>{fmt.kcal(h.targetSet.days[2].energyKcal)} rest · approved {h.approvedAt?.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  )
}

function GoalCard({ goalType, adjust, busy, onChange }: { goalType: GoalType; adjust: number; busy: boolean; onChange: (t: GoalType, pct: number) => void }) {
  const [type, setType] = useState<GoalType>(goalType)
  const [pct, setPct] = useState(adjust)
  useEffect(() => { setType(goalType); setPct(adjust) }, [goalType, adjust])
  const rule = GOAL_RULES[type]
  const dirty = type !== goalType || pct !== adjust
  return (
    <Card title="Goal">
      <div className="space-y-3">
        <Field label="Goal type">
          <Select value={type} onChange={(e) => { const t = e.target.value as GoalType; setType(t); setPct(GOAL_RULES[t].defaultPct) }}>
            {(Object.keys(GOAL_RULES) as GoalType[]).map((g) => <option key={g} value={g}>{GOAL_RULES[g].label}</option>)}
          </Select>
        </Field>
        {rule.minPct !== rule.maxPct && (
          <Field label={`Energy adjustment: ${pct > 0 ? '+' : ''}${pct}%`} hint={`Allowed ${rule.minPct}% to ${rule.maxPct > 0 ? '+' : ''}${rule.maxPct}%`}>
            <input type="range" className="w-full accent-leaf-700" min={rule.minPct} max={rule.maxPct} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          </Field>
        )}
        <Button disabled={!dirty || busy} onClick={() => onChange(type, pct)} className="w-full">Propose new targets for this goal</Button>
        <p className="text-xs text-stone-500">Your previous goal is kept in history. Meals already eaten keep the targets they were planned under.</p>
      </div>
    </Card>
  )
}

function TargetsView({ rec, compareTo }: { rec: NutritionTargetRecord; compareTo?: NutritionTargetRecord }) {
  const i = rec.inputs
  const days = rec.targetSet.days
  const train = days.find((d) => d.dayType === 'training')
  const rest = days.find((d) => d.dayType === 'rest')
  const act = ACTIVITY_LEVELS.find((a) => a.factor === i.activityFactor)
  const prevRest = compareTo?.targetSet.days.find((d) => d.dayType === 'rest')
  const d0 = train ?? rest!
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl bg-stone-50 p-3 text-stone-700">
        <p className="tabular">
          BMR {Math.round(i.bmrKcal).toLocaleString()} kcal (Mifflin–St Jeor: {i.weightKg} kg, {i.heightCm} cm, age {i.ageYears})
          {' '}× {i.activityFactor} {act ? `(${act.label.toLowerCase()})` : ''} = <b>{i.maintenanceKcal.toLocaleString()} kcal</b> maintenance
          {i.goalAdjustPct !== 0 && <> {i.goalAdjustPct > 0 ? '+' : '−'} {Math.abs(i.goalAdjustPct)}% for {GOAL_RULES[rec.targetSet.goal].label.toLowerCase()}</>}
        </p>
      </div>
      <table className="tabular w-full">
        <thead className="text-left text-xs text-stone-500">
          <tr><th className="py-1 font-medium">Per day</th><th className="font-medium">Training</th><th className="font-medium">Rest</th>{prevRest && <th className="font-medium">Was (rest)</th>}</tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          <TRow label="Energy" a={train?.energyKcal} b={rest?.energyKcal} c={prevRest?.energyKcal} unit="kcal" />
          <TRow label="Protein (preferred)" a={train?.proteinG.preferred} b={rest?.proteinG.preferred} c={prevRest?.proteinG.preferred} unit="g" />
          <TRow label="Protein floor" a={train?.proteinG.min} b={rest?.proteinG.min} c={prevRest?.proteinG.min} unit="g" />
          <TRow label="Carbohydrate" a={train?.carbsG} b={rest?.carbsG} c={prevRest?.carbsG} unit="g" />
          <TRow label="Fat" a={train?.fatG} b={rest?.fatG} c={prevRest?.fatG} unit="g" />
          <TRow label="Saturated fat max" a={train?.satFatMaxG} b={rest?.satFatMaxG} c={prevRest?.satFatMaxG} unit="g" />
          <TRow label="Fibre min" a={train?.fibreMinG} b={rest?.fibreMinG} c={prevRest?.fibreMinG} unit="g" />
          <TRow label="Added sugar max" a={train?.addedSugarMaxG} b={rest?.addedSugarMaxG} c={prevRest?.addedSugarMaxG} unit="g" />
        </tbody>
      </table>
      <div>
        <p className="mb-1 text-xs font-medium text-stone-500">Meals on a {train ? 'training' : 'rest'} day</p>
        <table className="tabular w-full">
          <thead className="text-left text-xs text-stone-500">
            <tr><th className="py-1 font-medium">Meal</th><th className="font-medium">Protein (g)</th><th className="font-medium">Carbs (g)</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {SLOTS.map((s) => {
              const st = d0.slots[s]
              const rng = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`)
              return (
                <tr key={s}>
                  <td className="py-1.5">{SLOT_LABEL[s]} <span className="text-stone-400">{st.time}</span></td>
                  <td>{rng(st.proteinG)}</td>
                  <td>{rng(st.carbsG)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        Training days: {days.flatMap((d, k) => (d.dayType === 'training' ? [WEEKDAY[k]] : [])).join(', ') || 'none'}
      </p>
    </div>
  )
}

function TRow({ label, a, b, c, unit }: { label: string; a?: number; b?: number; c?: number; unit: string }) {
  const show = (v?: number) => (v === undefined ? '—' : `${v.toLocaleString()} ${unit}`)
  return (
    <tr>
      <td className="py-1.5 text-stone-600">{label}</td>
      <td>{show(a)}</td>
      <td>{show(b)}</td>
      {c !== undefined && <td className="text-stone-400">{show(c)}</td>}
    </tr>
  )
}

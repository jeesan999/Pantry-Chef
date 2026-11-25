import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Field, Input, Notice, Page, Select } from '../components/ui'
import { db, repo, today } from '../db/instance'
import { nowIso } from '../db/repo'
import { PROFILE_ID, SETTINGS_ID, updateBreakfast } from '../db/seed'
import type { Profile, Settings, TrainingScheduleEntry } from '../db/types'
import { AFCD_ATTRIBUTION } from '../data/afcd'
import { SLOTS, type WorkoutType } from '../engines/contract'
import { ACTIVITY_LEVELS, ageOn } from '../engines/nutrition/engine'
import { fixedBreakfastNutrition } from '../engines/nutrition/service'
import { SLOT_LABEL } from '../lib/day'
import { BackupCard } from './settings/BackupCard'
import { AppearanceCard } from './settings/AppearanceCard'
import { useProfile, useSettings } from '../lib/hooks'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function useSaver() {
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'red'; text: ReactNode }>()
  const save = async (fn: () => Promise<unknown>) => {
    setMsg(undefined)
    try {
      await fn()
      setMsg({ tone: 'leaf', text: <>Saved. Targets change only when you <Link to="/goals" className="underline">recalculate and approve</Link> them.</> })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    }
  }
  return { msg: msg && <Notice tone={msg.tone}>{msg.text}</Notice>, save }
}

export default function SettingsScreen() {
  const profile = useProfile()
  const settings = useSettings()
  if (!profile || !settings) return <Page title="Settings">{null}</Page>
  return (
    <Page title="Settings">
      <ProfileCard profile={profile} />
      <TrainingCard />
      <NutritionCard settings={settings} />
      <BreakfastCard settings={settings} />
      <AppearanceCard />
      <BackupCard />
      <DataCard />
    </Page>
  )
}

function ProfileCard({ profile }: { profile: Profile }) {
  const [p, setP] = useState(profile)
  const { msg, save } = useSaver()
  useEffect(() => setP(profile), [profile])
  const ft = Math.floor(p.heightCm / 30.48)
  const inch = Math.round((p.heightCm - ft * 30.48) / 2.54)
  return (
    <Card title="Profile" action={!profile.confirmed && <Badge tone="ember">please check</Badge>}>
      <div className="space-y-3">
        {msg}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sex"><Select value={p.sex} onChange={(e) => setP({ ...p, sex: e.target.value as Profile['sex'] })}><option value="male">Male</option><option value="female">Female</option></Select></Field>
          <Field label="Birth date" hint={`Age ${ageOn(p.birthDate, today())}`}><Input type="date" value={p.birthDate} onChange={(e) => setP({ ...p, birthDate: e.target.value })} /></Field>
          <Field label="Height (cm)" hint={`${ft} ft ${inch} in`}><Input inputMode="decimal" value={p.heightCm} onChange={(e) => setP({ ...p, heightCm: Number(e.target.value) })} /></Field>
          <Field label="Starting weight (kg)" hint="Used until your first weigh-in"><Input inputMode="decimal" value={p.startingWeightKg} onChange={(e) => setP({ ...p, startingWeightKg: Number(e.target.value) })} /></Field>
        </div>
        <p className="text-sm font-medium text-stone-700">Meal times</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SLOTS.map((s) => (
            <Field key={s} label={SLOT_LABEL[s]}><Input type="time" value={p.mealTimes[s]} onChange={(e) => setP({ ...p, mealTimes: { ...p.mealTimes, [s]: e.target.value } })} /></Field>
          ))}
        </div>
        <Button className="w-full" onClick={() => save(() => repo.update('profile', PROFILE_ID, { ...p, confirmed: true, updatedAt: nowIso() }))}>
          {profile.confirmed ? 'Save profile' : 'Confirm and save profile'}
        </Button>
      </div>
    </Card>
  )
}

function TrainingCard() {
  const rows = useLiveQuery(() => db.training_schedule.toArray())
  const { msg, save } = useSaver()
  const byDay = new Map((rows ?? []).map((r) => [r.weekday, r]))
  const toggle = (weekday: number, on: boolean) =>
    save(async () => {
      const r = byDay.get(weekday)
      if (r) await repo.update('training_schedule', r.id, { active: on })
      else if (on) await repo.insert('training_schedule', { id: `training:${weekday}`, profileId: PROFILE_ID, weekday, type: 'strength', start: '12:15', durationMin: 60, intensity: 2, active: true })
    })
  const patch = (r: TrainingScheduleEntry, p: Partial<TrainingScheduleEntry>) => save(() => repo.update('training_schedule', r.id, p))
  return (
    <Card title="Usual week">
      <p className="mb-2 text-sm text-stone-600">Only a starting point. Switch any day between training and rest on the Plan or Today screen.</p>
      {msg}
      <ul className="divide-y divide-stone-100">
        {WEEKDAYS.map((d, i) => {
          const r = byDay.get(i)
          const on = !!r?.active
          return (
            <li key={d} className="py-2">
              <label className="flex min-h-10 items-center justify-between">
                <span className="font-medium text-stone-700">{d}</span>
                <input type="checkbox" className="h-5 w-5 accent-leaf-700" checked={on} onChange={(e) => toggle(i, e.target.checked)} aria-label={`Train on ${d}`} />
              </label>
              {on && r && (
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <Input type="time" defaultValue={r.start} onBlur={(e) => e.target.value !== r.start && patch(r, { start: e.target.value })} aria-label="Start" />
                  <Input inputMode="numeric" defaultValue={r.durationMin} onBlur={(e) => Number(e.target.value) !== r.durationMin && patch(r, { durationMin: Number(e.target.value) })} aria-label="Minutes" />
                  <Select value={r.type} onChange={(e) => patch(r, { type: e.target.value as WorkoutType })} aria-label="Type">
                    {['strength', 'cardio', 'hiit', 'sport', 'mobility', 'other'].map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-stone-500">Start time, minutes, type. Training within 2 hours after smoko makes smoko easy to digest; lunch becomes the post-workout meal.</p>
    </Card>
  )
}

function NutritionCard({ settings }: { settings: Settings }) {
  const [s, setS] = useState(settings)
  const { msg, save } = useSaver()
  useEffect(() => setS(settings), [settings])
  const num = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) })
  return (
    <Card title="Nutrition settings">
      <div className="space-y-3">
        {msg}
        <Field label="Activity level">
          <Select value={s.activityFactor} onChange={(e) => setS({ ...s, activityFactor: Number(e.target.value) })}>
            {ACTIVITY_LEVELS.map((a) => <option key={a.factor} value={a.factor}>{a.label} ({a.factor}): {a.detail}</option>)}
          </Select>
        </Field>
        <Field label="How carbohydrate is set">
          <Select value={s.carbMode} onChange={(e) => setS({ ...s, carbMode: e.target.value as Settings['carbMode'] })}>
            <option value="fixed">Fixed grams a day; fat fills the rest of the energy</option>
            <option value="percent">Fat as % of energy; carbohydrate fills the rest</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {s.carbMode === 'fixed' ? (
            <Field label="Carbs per day (g)" hint="Split across smoko, lunch, dinner"><Input inputMode="numeric" value={s.carbsPerDayG} onChange={num('carbsPerDayG')} /></Field>
          ) : (
            <Field label="Fat (% energy)"><Input inputMode="numeric" value={s.fatPctEnergy} onChange={num('fatPctEnergy')} /></Field>
          )}
          <Field label="Rest-day carb cut (%)" hint="Moved to training days; 0 = same every day"><Input inputMode="numeric" value={s.restDayCarbReductionPct} onChange={num('restDayCarbReductionPct')} /></Field>
          <Field label="Protein floor (g/day)"><Input inputMode="numeric" value={s.proteinMinG} onChange={num('proteinMinG')} /></Field>
          <Field label="Protein ceiling (g/kg)"><Input inputMode="decimal" value={s.proteinMaxGPerKg} onChange={num('proteinMaxGPerKg')} /></Field>
          <Field label="Fibre min (g)"><Input inputMode="numeric" value={s.fibreMinG} onChange={num('fibreMinG')} /></Field>
          <Field label="Added sugar flag (% energy)"><Input inputMode="numeric" value={s.addedSugarPctEnergy} onChange={num('addedSugarPctEnergy')} /></Field>
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-stone-700">
          <span>Saturated fat limit <span className="block text-xs text-stone-500">Off: tracked and shown, never a target</span></span>
          <input type="checkbox" className="h-5 w-5 accent-leaf-700" checked={s.satFatLimitEnabled} onChange={(e) => setS({ ...s, satFatLimitEnabled: e.target.checked })} />
        </label>
        {s.satFatLimitEnabled && <Field label="Sat fat max (% energy)"><Input inputMode="numeric" value={s.satFatPctEnergy} onChange={num('satFatPctEnergy')} /></Field>}
        <p className="text-sm font-medium text-stone-700">Protein per meal (min / preferred / max g)</p>
        {SLOTS.filter((x) => x !== 'breakfast').map((slot) => (
          <div key={slot} className="grid grid-cols-[5rem_1fr_1fr_1fr] items-center gap-2">
            <span className="text-sm text-stone-600">{SLOT_LABEL[slot]}</span>
            {(['min', 'preferred', 'max'] as const).map((k) => (
              <Input key={k} inputMode="numeric" aria-label={`${slot} ${k}`} value={s.slotProtein[slot][k]}
                onChange={(e) => setS({ ...s, slotProtein: { ...s.slotProtein, [slot]: { ...s.slotProtein[slot], [k]: Number(e.target.value) } } })} />
            ))}
          </div>
        ))}
        <Button className="w-full" onClick={() => save(async () => {
          for (const slot of SLOTS) {
            const p = s.slotProtein[slot]
            if (!(p.min <= p.preferred && p.preferred <= p.max)) throw new Error(`${SLOT_LABEL[slot]}: protein must be min ≤ preferred ≤ max.`)
          }
          await repo.update('settings', SETTINGS_ID, { ...s, updatedAt: nowIso() })
        })}>Save nutrition settings</Button>
      </div>
    </Card>
  )
}

function BreakfastCard({ settings }: { settings: Settings }) {
  const [b, setB] = useState(settings.breakfast)
  const { msg, save } = useSaver()
  const n = useLiveQuery(() => fixedBreakfastNutrition(repo), [settings.breakfast])
  useEffect(() => setB(settings.breakfast), [settings.breakfast])
  const fields: Array<[keyof Settings['breakfast'], string]> = [['eggs', 'Large eggs'], ['avocadoHalves', 'Avocado halves'], ['baconRashers', 'Bacon rashers'], ['gheeG', 'Ghee (g)']]
  return (
    <Card title="Fixed breakfast" action={n && <Badge tone={n.approximate ? 'ember' : 'leaf'}>{n.approximate ? 'approximate' : 'AFCD'}</Badge>}>
      {msg}
      <div className="grid grid-cols-4 gap-2">
        {fields.map(([k, label]) => <Field key={k} label={label}><Input inputMode="decimal" value={b[k]} onChange={(e) => setB({ ...b, [k]: Number(e.target.value) })} /></Field>)}
      </div>
      {n && (
        <p className="tabular mt-2 text-sm text-stone-600">
          {Math.round(n.total.energyKcal)} kcal · {Math.round(n.total.proteinG)} g protein · {Math.round(n.total.fatG)} g fat ({Math.round(n.total.satFatG * 10) / 10} g saturated) · {Math.round(n.total.carbsG * 10) / 10} g carbs
        </p>
      )}
      <Button className="mt-3 w-full" onClick={() => save(() => updateBreakfast(repo, b))}>Save breakfast</Button>
    </Card>
  )
}

function DataCard() {
  const counts = useLiveQuery(async () => ({
    afcd: await db.foods.where('source').equals('afcd').count(),
    interim: await db.foods.where('source').equals('interim').count(),
    label: await db.foods.where('source').equals('label').count(),
  }))
  const [problems, setProblems] = useState<string[] | null>(null)
  return (
    <Card title="Data">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone="leaf">{counts?.afcd ?? 0} AFCD foods</Badge>
          <Badge tone="ember">{counts?.interim ?? 0} interim foods</Badge>
          <Badge tone="blue">{counts?.label ?? 0} from labels</Badge>
        </div>
        {counts && counts.afcd === 0 && <Notice>AFCD Release 3 has not been imported yet; recipes use interim values marked “approximate”.</Notice>}
        <Button variant="secondary" className="w-full" onClick={async () => setProblems(await repo.checkIntegrity())}>Check data integrity</Button>
        {problems && (problems.length === 0 ? <Notice tone="leaf">All links between records are sound.</Notice> : <Notice tone="red">{problems.length} problem(s): {problems.slice(0, 5).join('; ')}</Notice>)}
        <p className="text-xs text-stone-500">{AFCD_ATTRIBUTION}</p>
      </div>
    </Card>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DayTypeSwitch } from '../components/DayTypeSwitch'
import { Badge, Button, Card, Notice, Page, Select, cx, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import { SLOTS } from '../engines/contract'
import { addDays } from '../engines/nutrition/engine'
import type { PlanSlot } from '../engines/planner/engine'
import { SLOT_LABEL, targetsForDate, weekDates } from '../lib/day'
import { useApprovedTargets, useDayChoices } from '../lib/hooks'
import { acceptDraft, buildDraft, slotKey, type Draft, type DraftParams } from '../lib/planner'
import { currentList, generateList } from '../lib/shopping'
import { on } from '../lib/events'
import { StaleTargets } from './plan/StaleTargets'

const STORE = 'plan-draft'
const nowHHMM = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function loadParams(): DraftParams | null {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as DraftParams | null
  } catch {
    return null
  }
}
function saveParams(p: DraftParams | null) {
  try {
    if (p) sessionStorage.setItem(STORE, JSON.stringify(p))
    else sessionStorage.removeItem(STORE)
  } catch {
    // storage unavailable: the draft just won't survive leaving the screen
  }
}

// The last accepted plan, kept outside the component so Undo survives switching screens.
let lastAccepted: { undo: () => Promise<void>; written: number; from: string; to: string } | null = null
on('data-replaced', () => { lastAccepted = null })

export default function PlanScreen() {
  const now = today()
  // a restored draft opens on its own week
  const [offset, setOffset] = useState(() => {
    const p = loadParams()
    return p ? Math.max(0, Math.round((Date.parse(p.to) - Date.parse(now)) / 6048e5 - 0.5)) : 0
  })
  const dates = weekDates(addDays(now, offset * 7))
  const approved = useApprovedTargets()
  const choices = useDayChoices(dates)
  const planned = useLiveQuery(() => db.planned_meals.where('date').between(dates[0], dates[6], true, true).toArray(), [dates[0]])
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const rname = new Map((recipes ?? []).map((r) => [r.id, r.name]))
  const nTrain = choices?.filter((c) => c.dayType === 'training').length

  const [params, setParamsState] = useState<DraftParams | null>(loadParams)
  const setParams = (p: DraftParams | null) => {
    saveParams(p)
    setParamsState(p)
  }
  const [mode, setMode] = useState<DraftParams['mode']>(params?.mode ?? 'empty')
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'red'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [, rerender] = useState(0)

  const draftQ = useLiveQuery(
    async (): Promise<{ draft: Draft | null; error?: string }> => {
      if (!params) return { draft: null }
      try {
        return { draft: await buildDraft(repo, params, now, nowHHMM()) }
      } catch (e) {
        return { draft: null, error: (e as Error).message }
      }
    },
    [JSON.stringify(params), now],
  )
  const draft = draftQ?.draft ?? null

  const weekFrom = dates[0] < now ? now : dates[0]
  const weekOver = dates[6] < now
  const start = (m: DraftParams['mode'], seed = 0) => {
    setMsg(null)
    setParams({ from: weekFrom, to: dates[6], mode: m, seed, locks: [], skips: [], exclude: {} })
  }
  const edit = (fn: (p: DraftParams) => DraftParams) => params && setParams(fn(params))

  const accept = async () => {
    if (!draft) return
    setBusy(true)
    setMsg(null)
    try {
      const a = await acceptDraft(repo, draft)
      lastAccepted = { undo: a.undo, written: a.written, from: draft.params.from, to: draft.params.to }
      setParams(null)
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const undoAccepted = async () => {
    if (!lastAccepted) return
    setBusy(true)
    try {
      await lastAccepted.undo()
      setMsg({ tone: 'leaf', text: 'Undone: the week is as it was.' })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      lastAccepted = null
      setBusy(false)
    }
  }
  const updateList = async () => {
    if (!lastAccepted) return
    setBusy(true)
    try {
      const list = await currentList(repo)
      const r = await generateList(repo, { from: lastAccepted.from, to: lastAccepted.to }, list?.id)
      setMsg({ tone: 'leaf', text: `Shopping list updated: ${r.toBuy} item${r.toBuy === 1 ? '' : 's'} to buy.` })
      lastAccepted = null
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(false)
      rerender((x) => x + 1)
    }
  }

  const dayCheck = new Map((draft?.result.days ?? []).map((d) => [d.date, d]))
  const draftMeal = new Map((draft?.result.meals ?? []).map((m) => [slotKey(m), m]))
  const lockedBy = new Map((params?.locks ?? []).map((m) => [slotKey(m), m]))
  const skipped = new Set(params?.skips ?? [])
  const inDraft = (d: string) => !!draft && d >= draft.params.from && d <= draft.params.to

  return (
    <Page
      title={offset === 0 ? 'This week' : offset === 1 ? 'Next week' : 'Week'}
      subtitle={`${fmt.date(dates[0])} – ${fmt.date(dates[6])}${nTrain === undefined ? '' : ` · ${nTrain} training, ${7 - nTrain} rest`}`}
      action={
        <div className="flex gap-1">
          <Button variant="secondary" aria-label="Previous week" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}>‹</Button>
          <Button variant="secondary" aria-label="Next week" onClick={() => setOffset(offset + 1)}>›</Button>
        </div>
      }
    >
      <StaleTargets />
      {!approved && (
        <Card><Link to="/goals"><Button>Review targets first</Button></Link></Card>
      )}

      {approved && !params && !weekOver && (
        <Card title="Meal planner">
          <p className="text-sm text-stone-600">Picks meals to fit your targets, uses food dated soon first, and keeps the week varied. You see a draft first; nothing changes until you accept it.</p>
          <div className="mt-3 flex gap-2">
            <Select aria-label="What to plan" value={mode} onChange={(e) => setMode(e.target.value as DraftParams['mode'])} className="flex-1">
              <option value="empty">Fill empty meals</option>
              <option value="unlocked">Replan every meal</option>
            </Select>
            <Button onClick={() => start(mode)}>{offset === 0 ? 'Plan this week' : offset === 1 ? 'Plan next week' : 'Plan this week'}</Button>
          </div>
          {offset === 0 && <p className="mt-2 text-xs text-stone-500">Plans from now to Sunday; meals already past are left alone.</p>}
        </Card>
      )}

      {lastAccepted && !params && (
        <Notice tone="leaf">
          Plan saved: {lastAccepted.written} meal{lastAccepted.written === 1 ? '' : 's'}.
          <span className="mt-2 flex flex-wrap gap-2">
            <Button className="min-h-9" onClick={updateList} disabled={busy}>Update shopping list</Button>
            <Button variant="secondary" className="min-h-9" onClick={undoAccepted} disabled={busy}>Undo</Button>
          </span>
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {draftQ?.error && <Notice tone="red">{draftQ.error} <button type="button" className="underline" onClick={() => setParams(null)}>Close the draft</button></Notice>}

      {draft && <WeekSummary draft={draft} busy={busy} onAccept={accept} onDiscard={() => setParams(null)} onAnother={() => edit((p) => ({ ...p, seed: p.seed + 1 }))} />}

      {choices?.map((c) => {
        const d = c.date
        const t = approved ? targetsForDate(approved.targetSet, c) : null
        const meals = (planned ?? []).filter((p) => p.date === d)
        const check = inDraft(d) ? dayCheck.get(d) : undefined
        return (
          <Card key={d} className={d === now ? 'ring-2 ring-leaf-200' : ''}
            title={<span className="flex items-center gap-2">{fmt.date(d)} {d === now && <Badge tone="leaf">today</Badge>}</span>}
            action={<DayTypeSwitch choice={c} compact />}>
            {t && (
              <>
                <p className="tabular text-sm text-stone-600">
                  {fmt.kcal(t.energyKcal)} · {t.proteinG.preferred} g protein · {t.carbsG} g carbs · {t.fatG} g fat
                  {t.workout && <> · training {t.workout.start}</>}
                </p>
                <ul className="mt-2 divide-y divide-stone-50 text-sm">
                  {SLOTS.map((s) => {
                    const k = slotKey({ date: d, slot: s })
                    const m = meals.find((x) => x.slot === s)
                    if (s === 'breakfast' || !inDraft(d) || draft?.past.includes(k)) {
                      const name = s === 'breakfast' ? 'Fixed breakfast' : m ? rname.get(m.recipeId) : undefined
                      return (
                        <li key={s} className="flex justify-between gap-2 py-1">
                          <span className="shrink-0 text-stone-500">{SLOT_LABEL[s]} {t.slots[s].time}</span>
                          <span className={name ? 'truncate text-stone-800' : 'text-stone-400'}>{name ?? '—'}</span>
                        </li>
                      )
                    }
                    const ps = s as PlanSlot
                    const lock = lockedBy.get(k)
                    const sug = draftMeal.get(k)
                    const kept = !lock && !sug && !skipped.has(k) && m && draft?.params.mode === 'empty'
                    const shown = lock ?? sug ?? (kept ? { recipeId: m!.recipeId, portionScale: m!.portionScale } : undefined)
                    return (
                      <li key={s} className="py-1.5" data-testid={`slot-${k}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="shrink-0 text-stone-500">{SLOT_LABEL[s]} {t.slots[s].time}</span>
                          <span className="min-w-0 text-right">
                            <span className={cx('block', shown ? 'text-stone-800' : 'text-stone-400')}>
                              {shown ? rname.get(shown.recipeId) : skipped.has(k) ? 'left empty' : '—'}
                              {shown && shown.portionScale !== 1 && <span className="tabular text-stone-500"> · {shown.portionScale}×</span>}
                            </span>
                            <span className="mt-0.5 flex flex-wrap justify-end gap-1">
                              {sug && <Badge tone="ember">suggested</Badge>}
                              {lock && <Badge tone="leaf">locked</Badge>}
                              {kept && <Badge>kept</Badge>}
                            </span>
                            {sug && sug.reasons.length > 0 && <span className="block text-xs text-stone-500">{sug.reasons.join(' · ')}</span>}
                          </span>
                        </div>
                        <div className="mt-1 flex justify-end gap-1">
                          {sug && (
                            <>
                              <SmallBtn label={`Lock ${SLOT_LABEL[s]} on ${fmt.date(d)}`} onClick={() => edit((p) => ({ ...p, locks: [...p.locks, { date: d, slot: ps, recipeId: sug.recipeId, portionScale: sug.portionScale }] }))}>Lock</SmallBtn>
                              <SmallBtn label={`Swap ${SLOT_LABEL[s]} on ${fmt.date(d)}`} onClick={() => edit((p) => ({ ...p, exclude: { ...p.exclude, [k]: [...(p.exclude?.[k] ?? []), sug.recipeId] } }))}>Swap</SmallBtn>
                              <SmallBtn label={`Clear ${SLOT_LABEL[s]} on ${fmt.date(d)}`} onClick={() => edit((p) => ({ ...p, skips: [...p.skips, k] }))}>Clear</SmallBtn>
                            </>
                          )}
                          {lock && <SmallBtn label={`Unlock ${SLOT_LABEL[s]} on ${fmt.date(d)}`} onClick={() => edit((p) => ({ ...p, locks: p.locks.filter((x) => slotKey(x) !== k) }))}>Unlock</SmallBtn>}
                          {skipped.has(k) && <SmallBtn label={`Fill ${SLOT_LABEL[s]} on ${fmt.date(d)}`} onClick={() => edit((p) => ({ ...p, skips: p.skips.filter((x) => x !== k) }))}>Fill it</SmallBtn>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {check && (
                  <div className="tabular mt-2 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
                    Day: {Math.round(check.totals.energyKcal).toLocaleString('en-AU')} / {check.target.energyKcal.toLocaleString('en-AU')} kcal · P {Math.round(check.totals.proteinG)}/{check.target.proteinG} · C {Math.round(check.totals.carbsG)}/{check.target.carbsG} · F {Math.round(check.totals.fatG)}/{check.target.fatG} g
                    {check.issues.length > 0 && <span className="mt-1 block text-ember-600">⚠ {check.issues.join('; ')}</span>}
                  </div>
                )}
              </>
            )}
          </Card>
        )
      })}
      <Card>
        <Link to="/shopping" className="flex min-h-11 items-center justify-between font-medium text-leaf-700">
          Shopping list for these meals <span aria-hidden>›</span>
        </Link>
      </Card>
    </Page>
  )
}

function SmallBtn({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-leaf-700 hover:bg-leaf-50">
      {children}
    </button>
  )
}

function WeekSummary({ draft, busy, onAccept, onDiscard, onAnother }: { draft: Draft; busy: boolean; onAccept: () => void; onDiscard: () => void; onAnother: () => void }) {
  const w = draft.result.week
  const n = draft.result.meals.length
  const issues = draft.result.days.filter((d) => d.issues.length).length
  return (
    <Card title={<span className="flex items-center gap-2">Draft plan <Badge tone="ember">not saved yet</Badge></span>}>
      <ul className="tabular space-y-1 text-sm text-stone-700">
        <li>{n} meal{n === 1 ? '' : 's'} suggested for {fmt.date(draft.params.from)} – {fmt.date(draft.params.to)}{draft.params.mode === 'empty' && draft.locked.length > 0 ? ', around the meals you already chose' : ''}.</li>
        <li>
          {w.costCents === 0 && w.unpricedMeals > 0
            ? 'Cost: not known yet. Meals are priced once every ingredient has a price from your receipts.'
            : `Estimated food cost ${fmt.money(w.costCents)}${w.unpricedMeals ? ` + ${w.unpricedMeals} meal${w.unpricedMeals === 1 ? '' : 's'} not yet priced` : ''}.`}
        </li>
        {w.usesSoon.length > 0 && <li>Uses food dated soon: {w.usesSoon.join(', ')}.</li>}
        {w.unusedSoon.length > 0 && <li className="text-ember-600">Still unused and dated this week: {w.unusedSoon.join(', ')}.</li>}
        {issues > 0 && <li className="text-ember-600">{issues} day{issues === 1 ? '' : 's'} miss a limit (see below).</li>}
        {draft.result.unfilled.length > 0 && <li className="text-ember-600">{draft.result.unfilled.length} meal{draft.result.unfilled.length === 1 ? '' : 's'} couldn’t be filled without repeating too often.</li>}
      </ul>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button className="col-span-3" onClick={onAccept} disabled={busy || n + draft.params.locks.length + draft.params.skips.length === 0}>Accept plan</Button>
        <Button variant="secondary" onClick={onAnother} disabled={busy} className="col-span-2">Show another plan</Button>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>Discard</Button>
      </div>
      <p className="mt-2 text-xs text-stone-500">Lock what you like, swap or clear the rest, then accept. You can undo afterwards.</p>
    </Card>
  )
}

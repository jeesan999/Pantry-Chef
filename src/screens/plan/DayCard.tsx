import { CircleAlert, CircleCheck, Copy, MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PantryCheckSheet } from '../../components/PantryCheck'
import { Badge, Button, Sheet, cx, fmt } from '../../components/ui'
import { repo } from '../../db/instance'
import type { PlanSlot } from '../../engines/planner/engine'
import { SLOT_LABEL, clearMeal } from '../../lib/day'
import { copyMeal, regenerateMeal, setMealRecipe, type DaySummary, type MealSummary } from '../../lib/planOps'
import { fitStatus } from '../../lib/fit'
import { RecipePicker } from './RecipePicker'

export type Undoable = { text: string; undo?: () => Promise<void> }

const toneText = { leaf: 'text-leaf-700', ember: 'text-ember-600', red: 'text-red-700', stone: 'text-stone-500' }
const toneBar = { leaf: 'bg-leaf-500', ember: 'bg-ember-500', red: 'bg-red-500', stone: 'bg-stone-400' }

/** Planned totals against the day's targets, one compact bar per nutrient. */
export function DayTotals({ day }: { day: DaySummary }) {
  const rows: Array<[string, number, number, string]> = [
    ['Energy', day.totals.energyKcal, day.target.energyKcal, 'kcal'],
    ['Protein', day.totals.proteinG, day.target.proteinG.preferred, 'g'],
    ['Carbs', day.totals.carbsG, day.target.carbsG, 'g'],
    ['Fat', day.totals.fatG, day.target.fatG, 'g'],
  ]
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-stone-50 px-3 py-2 sm:grid-cols-4" aria-label={`Planned totals for ${fmt.date(day.date)}`}>
      {rows.map(([label, v, t, unit]) => {
        const s = fitStatus(v, t)
        return (
          <div key={label} className="text-xs">
            <div className="flex justify-between gap-1">
              <span className="text-stone-600">{label}</span>
              <span className="tabular font-medium text-stone-800">{Math.round(v).toLocaleString('en-AU')}<span className="font-normal text-stone-500">/{Math.round(t).toLocaleString('en-AU')}{unit === 'g' ? ' g' : ''}</span></span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-stone-200" role="presentation">
              <div className={cx('h-full rounded-full', toneBar[s.tone])} style={{ width: `${Math.min(100, (v / Math.max(t, 1)) * 100)}%` }} />
            </div>
            <span className={cx('block text-[11px]', toneText[s.tone])}>{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** One saved day: its meals with pantry status and cost, actions per meal, and totals. */
export function DayPlan({ day, dates, today, now, onDone }: { day: DaySummary; dates: string[]; today: string; now: string; onDone: (u: Undoable) => void }) {
  const [menu, setMenu] = useState<MealSummary | null>(null)
  const [picking, setPicking] = useState<PlanSlot | null>(null)
  const [copying, setCopying] = useState<MealSummary | null>(null)
  const [checking, setChecking] = useState<MealSummary | null>(null)
  const past = day.date < today
  const run = async (fn: () => Promise<Undoable>) => {
    try {
      onDone(await fn())
    } catch (e) {
      onDone({ text: (e as Error).message })
    }
  }
  const label = (s: string) => `${SLOT_LABEL[s as PlanSlot]} on ${fmt.date(day.date)}`
  return (
    <>
      <ul className="divide-y divide-stone-100 text-sm">
        {day.meals.map((m) => {
          const fixed = m.slot === 'breakfast'
          const editable = !fixed && !past && !m.logged
          return (
            <li key={m.slot} className="flex items-center gap-2 py-1.5" data-testid={`meal-${day.date}|${m.slot}`}>
              <span className="w-24 shrink-0 text-stone-500">{SLOT_LABEL[m.slot]} <span className="tabular text-xs">{day.target.slots[m.slot].time}</span></span>
              <span className="min-w-0 flex-1">
                {m.recipe ? (
                  <>
                    <Link to={`/recipes/${encodeURIComponent(m.recipe.id)}`} className="block truncate font-medium text-stone-800 hover:underline">{fixed && !m.meal ? 'Fixed breakfast' : m.recipe.name}</Link>
                    <span className="tabular flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                      {m.nutrition && <span>{Math.round(m.nutrition.energyKcal)} kcal · P {Math.round(m.nutrition.proteinG)} g</span>}
                      {m.costCents !== null && <span>{fmt.money(m.costCents)}</span>}
                      {m.logged ? <Badge tone="leaf">eaten</Badge> : !past && m.toBuy !== null && (
                        <button type="button" onClick={() => setChecking(m)} aria-label={`Pantry check for ${label(m.slot)}`} className={cx('inline-flex items-center gap-0.5 font-medium', m.toBuy === 0 ? 'text-leaf-700' : 'text-orange-900')}>
                          {m.toBuy === 0 ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden />}
                          {m.toBuy === 0 ? 'in pantry' : `${m.toBuy} to buy`}
                        </button>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-stone-400">Not planned</span>
                )}
              </span>
              {editable && (m.recipe ? (
                <button type="button" aria-label={`Options for ${label(m.slot)}`} onClick={() => setMenu(m)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-stone-600 hover:bg-stone-100">
                  <MoreHorizontal className="h-5 w-5" aria-hidden />
                </button>
              ) : (
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Choose ${label(m.slot)}`} onClick={() => setPicking(m.slot as PlanSlot)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-leaf-700 hover:bg-leaf-50"><Plus className="h-4 w-4" aria-hidden />Choose</button>
                  <button type="button" aria-label={`Suggest ${label(m.slot)}`} onClick={() => run(async () => {
                    const r = await regenerateMeal(repo, day.date, m.slot as PlanSlot, today, now)
                    return r ? { text: `${r.recipe.name} is on ${label(m.slot).toLowerCase()}.`, undo: r.undo } : { text: 'No recipe fits this meal.' }
                  })} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-leaf-700 hover:bg-leaf-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Suggest</button>
                </span>
              ))}
            </li>
          )
        })}
      </ul>
      <DayTotals day={day} />
      <p className="tabular mt-1.5 text-xs text-stone-500">
        {day.costCents > 0 ? `About ${fmt.money(day.costCents)} of food` : 'Cost not known yet'}{day.unpriced > 0 && day.costCents > 0 ? ` + ${day.unpriced} meal${day.unpriced === 1 ? '' : 's'} not priced` : ''}
        {!past && ` · ${day.toBuy === 0 ? 'everything in the pantry' : `${day.toBuy} ingredient${day.toBuy === 1 ? '' : 's'} to buy`}`}
      </p>

      {menu && (
        <Sheet open onOpenChange={(o) => !o && setMenu(null)} title={`${label(menu.slot)}: ${menu.recipe!.name}`}>
          <div className="grid gap-2">
            <Button variant="secondary" onClick={() => { setPicking(menu.slot as PlanSlot); setMenu(null) }}><Search className="h-4 w-4" aria-hidden />Change recipe</Button>
            <Button variant="secondary" onClick={() => { const m = menu; setMenu(null); run(async () => {
              const r = await regenerateMeal(repo, day.date, m.slot as PlanSlot, today, now)
              return r ? { text: `${r.recipe.name} is on ${label(m.slot).toLowerCase()}.`, undo: r.undo } : { text: 'No other recipe fits this meal.' }
            }) }}><RefreshCw className="h-4 w-4" aria-hidden />Suggest another</Button>
            <Button variant="secondary" onClick={() => { setCopying(menu); setMenu(null) }}><Copy className="h-4 w-4" aria-hidden />Copy to other days</Button>
            <Button variant="secondary" onClick={() => { setChecking(menu); setMenu(null) }}><CircleCheck className="h-4 w-4" aria-hidden />Pantry check</Button>
            <Button variant="ghost" className="text-red-700" onClick={() => { const m = menu; setMenu(null); run(async () => {
              const before = m.meal!
              await clearMeal(repo, day.date, m.slot)
              return { text: `${label(m.slot)} cleared.`, undo: async () => { await setMealRecipe(repo, day.date, m.slot as PlanSlot, before.recipeId); const row = await repo.db.planned_meals.where('[date+slot]').equals([day.date, m.slot]).first(); if (row) await repo.update('planned_meals', row.id, { portionScale: before.portionScale, substitutions: before.substitutions }) } }
            }) }}><Trash2 className="h-4 w-4" aria-hidden />Leave unplanned</Button>
          </div>
        </Sheet>
      )}
      {picking && (
        <RecipePicker day={day} slot={picking} onClose={() => setPicking(null)} onPick={(id) => { const s = picking; setPicking(null); run(async () => ({ text: `${label(s)} set.`, undo: await setMealRecipe(repo, day.date, s, id) })) }} />
      )}
      {copying && <CopySheet day={day} meal={copying} dates={dates} today={today} onClose={() => setCopying(null)} onCopy={(to) => { const m = copying; setCopying(null); run(async () => {
        const r = await copyMeal(repo, m.meal!, to)
        return { text: `Copied to ${r.copied} day${r.copied === 1 ? '' : 's'}${r.skipped.length ? ` (${r.skipped.length} skipped: already eaten)` : ''}.`, undo: r.undo }
      }) }} />}
      {checking && checking.recipe && (
        <PantryCheckSheet title={`Pantry check: ${checking.recipe.name}`} recipeId={checking.recipe.id} portionScale={checking.meal?.portionScale ?? 1} date={day.date} plannedMealId={checking.meal?.id} onClose={() => setChecking(null)} />
      )}
    </>
  )
}

function CopySheet({ day, meal, dates, today, onClose, onCopy }: { day: DaySummary; meal: MealSummary; dates: string[]; today: string; onClose: () => void; onCopy: (to: string[]) => void }) {
  const options = dates.filter((d) => d !== day.date && d >= today)
  const [sel, setSel] = useState<Set<string>>(new Set(options))
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Repeat ${meal.recipe!.name}`}>
      <p className="mb-2 text-sm text-stone-600">Copy to {SLOT_LABEL[meal.slot].toLowerCase()} on these days. Portions are sized to each day’s targets; your swaps come too.</p>
      <ul className="divide-y divide-stone-100">
        {options.map((d) => (
          <li key={d}>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-leaf-600)]" checked={sel.has(d)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(d); else n.delete(d); setSel(n) }} />
              {fmt.date(d)}
            </label>
          </li>
        ))}
      </ul>
      {options.length === 0 && <p className="text-sm text-stone-500">No other upcoming days in view.</p>}
      <Button className="mt-3 w-full" disabled={sel.size === 0} onClick={() => onCopy([...sel])}>Copy to {sel.size} day{sel.size === 1 ? '' : 's'}</Button>
    </Sheet>
  )
}

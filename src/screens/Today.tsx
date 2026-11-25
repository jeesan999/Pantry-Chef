import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RecipeArt } from '../components/RecipeArt'
import { Badge, Button, Card, Notice, Page, RangeBar, Ring, Sheet, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import { FIXED_BREAKFAST_ID } from '../db/seed'
import type { PlannedMeal, Recipe } from '../db/types'
import { SLOTS, type SlotName } from '../engines/contract'
import { SLOT_LABEL, assignMeal, clearMeal, targetsForDate } from '../lib/day'
import { DayTypeSwitch } from '../components/DayTypeSwitch'
import { useAllRecipeNutrition, useApprovedTargets, useDayChoices, usePantrySuggestions, useProfile } from '../lib/hooks'
import { addNutrients, emptyNutrients, scaleNutrients } from '../lib/nutrition'
import { rankForSlot } from '../lib/rank'
import { allRatings } from '../lib/ratings'
import { budgetStatuses } from '../lib/expenses'
import { BudgetAlerts } from './expenses/BudgetAlerts'
import { StaleTargets } from './plan/StaleTargets'
import { EatBar, SnacksCard } from './today/Eating'
import { MAX_DAYS_BACK, loadDay } from '../lib/eating'
import { addDays as addDaysTo } from '../engines/nutrition/engine'

export default function TodayScreen() {
  const now = today()
  const [date, setDate] = useState(now)
  const [view, setView] = useState<'eaten' | 'planned' | null>(null)
  const log = useLiveQuery(() => loadDay(repo, date), [date])
  const approved = useApprovedTargets()
  const profile = useProfile()
  const nutrition = useAllRecipeNutrition()
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const planned = useLiveQuery(() => db.planned_meals.where('date').equals(date).toArray(), [date])
  const [picking, setPicking] = useState<SlotName | null>(null)
  const budgets = useLiveQuery(() => budgetStatuses(repo, date), [date])
  const lastWeighIn = useLiveQuery(async () => (await db.weight_measurements.orderBy('date').last())?.date ?? null)

  const choice = useDayChoices([date])?.[0]
  const day = approved && choice ? targetsForDate(approved.targetSet, choice) : null
  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])
  const plannedBySlot = useMemo(() => new Map((planned ?? []).map((p) => [p.slot, p])), [planned])

  const mealFor = (slot: SlotName): { recipe?: Recipe; scale: number; planned?: PlannedMeal } => {
    const p = plannedBySlot.get(slot)
    if (slot === 'breakfast') return { recipe: recipeById.get(FIXED_BREAKFAST_ID), scale: p?.portionScale ?? 1, planned: p }
    return { recipe: p ? recipeById.get(p.recipeId) : undefined, scale: p?.portionScale ?? 1, planned: p }
  }

  const plannedTotals = SLOTS.reduce((acc, slot) => {
    const m = mealFor(slot)
    const n = m.recipe && nutrition?.get(m.recipe.id)
    return n ? addNutrients(acc, n.perServing, m.scale) : acc
  }, emptyNutrients())
  const anyLogged = !!log && log.logged.size + log.quick.length > 0
  const shown = view ?? (anyLogged ? 'eaten' : 'planned')
  const totals = shown === 'eaten' ? log?.totals ?? emptyNutrients() : plannedTotals
  const anyApprox = SLOTS.some((s) => {
    const m = mealFor(s)
    return m.recipe && nutrition?.get(m.recipe.id)?.approximate
  })

  if (approved === undefined || !profile || !nutrition || !recipes) return <Page title="Today">{null}</Page>

  return (
    <Page
      title={date === now ? 'Today' : date === addDaysTo(now, -1) ? 'Yesterday' : fmt.date(date)}
      subtitle={
        <span className="flex items-center gap-2">
          {fmt.date(date)}
          {choice && <DayTypeSwitch choice={choice} />}
        </span>
      }
      action={
        <div className="flex gap-1">
          <Button variant="secondary" aria-label="Previous day" disabled={date <= addDaysTo(now, -MAX_DAYS_BACK)} onClick={() => { setDate(addDaysTo(date, -1)); setView(null) }}>‹</Button>
          <Button variant="secondary" aria-label="Next day" disabled={date >= now} onClick={() => { setDate(addDaysTo(date, 1)); setView(null) }}>›</Button>
        </div>
      }
    >
      <StaleTargets />
      <BudgetAlerts statuses={budgets} link />
      {lastWeighIn && lastWeighIn <= addDaysTo(now, -7) && (
        <Notice tone="stone">No weigh-in for a week. <Link to="/progress" className="font-medium underline">Log one</Link> to keep your trend useful.</Notice>
      )}
      {!profile.confirmed && (
        <Notice>
          Your profile uses starting values (81 kg, age 41, 180 cm). <Link to="/settings" className="font-medium underline">Check them in Settings</Link>.
        </Notice>
      )}
      {!approved || !day ? (
        <Card>
          <p className="text-stone-700">No approved targets yet. Review the proposed targets to start planning your day.</p>
          <Link to="/goals"><Button className="mt-3">Review targets</Button></Link>
        </Card>
      ) : (
        <>
          <Card
            title={date === now ? 'Today’s totals' : 'Day totals'}
            action={
              <div role="radiogroup" aria-label="Totals" className="flex rounded-lg bg-stone-100 p-0.5 text-xs font-medium">
                {(['eaten', 'planned'] as const).map((v) => (
                  <button key={v} role="radio" aria-checked={shown === v} onClick={() => setView(v)}
                    className={shown === v ? 'min-h-8 rounded-md bg-white px-2.5 text-leaf-700 shadow-sm' : 'min-h-8 px-2.5 text-stone-600'}>
                    {v === 'eaten' ? 'Eaten' : 'Planned'}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid grid-cols-4 gap-1">
              <Ring value={totals.energyKcal} target={day.energyKcal} label="Energy" unit="kcal" color="#e07f2a" />
              <Ring value={totals.proteinG} target={day.proteinG.preferred} label="Protein" unit="g" color="#2e7445" />
              <Ring value={totals.carbsG} target={day.carbsG} label="Carbs" unit="g" color="#ca8a04" />
              <Ring value={totals.fatG} target={day.fatG} label="Fat" unit="g" color="#7c3aed" />
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {day.carbsMinG !== null && <Limit label="Carbs (daily minimum)" value={totals.carbsG} limit={day.carbsMinG} />}
              <Limit label="Saturated fat" value={totals.satFatG} limit={day.satFatMaxG} max />
              <Limit label="Fibre" value={totals.fibreG} limit={day.fibreMinG} />
              <Limit label="Added sugar" value={totals.addedSugarG} limit={day.addedSugarMaxG} max />
              <p className="text-xs text-stone-500">
                {shown === 'eaten'
                  ? `${Math.max(0, Math.round(day.proteinG.preferred - totals.proteinG))} g protein to go · ${log?.complete ? 'every meal logged' : 'meals not yet logged count as nothing'}`
                  : 'What your planned meals add up to'} · targets v{approved.version}{anyApprox ? ' · approximate values' : ''}
              </p>
            </div>
          </Card>

          {SLOTS.map((slot) => {
            const st = day.slots[slot]
            const m = mealFor(slot)
            const n = m.recipe ? nutrition.get(m.recipe.id) : undefined
            const per = n ? scaleNutrients(n.perServing, m.scale) : null
            return (
              <Card key={slot} className="p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-leaf-900">{SLOT_LABEL[slot]}</span>
                    <span className="tabular text-sm text-stone-500">{st.time}</span>
                    {slot === 'breakfast' && <Badge>fixed</Badge>}
                    {st.digestibility === 'high' && <Badge tone="ember">easy to digest: training soon</Badge>}
                    {slot === 'lunch' && day.dayType === 'training' && <Badge tone="blue">post-workout</Badge>}
                  </div>
                  {slot !== 'breakfast' && !(m.planned && log?.logged.has(m.planned.id)) && (
                    <button className="min-h-11 px-2 text-sm font-medium text-leaf-700" onClick={() => setPicking(slot)}>
                      {m.recipe ? 'Change' : 'Choose'}
                    </button>
                  )}
                </div>
                {m.recipe && per ? (
                  <Link to={`/recipes/${m.recipe.id}`} className="flex gap-3 p-4">
                    <RecipeArt recipe={m.recipe} className="h-16 w-16 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-stone-800">{m.recipe.name}</p>
                      <p className="tabular text-sm text-stone-500">
                        {fmt.kcal(per.energyKcal)} · {m.scale !== 1 && `${m.scale}× serving · `}
                        {m.recipe.cuisine}
                      </p>
                    </div>
                  </Link>
                ) : (
                  <p className="px-4 py-4 text-sm text-stone-500">Nothing chosen yet.</p>
                )}
                <EatBar date={date} slot={slot} planned={m.planned} logged={m.planned ? log?.logged.get(m.planned.id) : undefined} recipeName={m.recipe?.name} />
                <div className="space-y-1.5 border-t border-stone-100 bg-stone-50/60 px-4 py-3">
                  <Row label="Protein"><RangeBar value={per?.proteinG ?? 0} low={st.proteinG[0]} high={st.proteinG[1]} unit="g" /></Row>
                  <Row label="Carbs"><RangeBar value={per?.carbsG ?? 0} low={st.carbsG[0]} high={st.carbsG[1]} unit="g" /></Row>
                  <Row label="Fat"><RangeBar value={per?.fatG ?? 0} low={st.fatG[0]} high={st.fatG[1]} unit="g" /></Row>
                </div>
              </Card>
            )
          })}
          <SnacksCard date={date} quick={log?.quick ?? []} />
          <p className="px-1 text-xs text-stone-500">
            Want a change? <Link to="/chef" className="font-medium text-leaf-700 underline">Ask Chef</Link>, e.g. “swap tonight’s dinner” or “I had a banana”.
          </p>
        </>
      )}

      {picking && day && approved && (
        <PickRecipe
          slot={picking}
          targetProtein={(day.slots[picking].proteinG[0] + day.slots[picking].proteinG[1]) / 2}
          onClose={() => setPicking(null)}
          onClear={async () => {
            await clearMeal(repo, date, picking)
            setPicking(null)
          }}
          onPick={async (recipeId, portionScale) => {
            await assignMeal(repo, { date, slot: picking, time: day.slots[picking].time, recipeId, portionScale, targetsId: approved.id, targetsVersion: approved.version! })
            setPicking(null)
          }}
          hasCurrent={plannedBySlot.has(picking)}
        />
      )}
    </Page>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-xs text-stone-500">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Limit({ label, value, limit, max }: { label: string; value: number; limit: number | null; max?: boolean }) {
  if (limit === null) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-stone-600">{label}</span>
        <span className="tabular text-stone-700">{fmt.g(value)} <span className="text-stone-400">no limit set</span></span>
      </div>
    )
  }
  const ok = max ? value <= limit : value >= limit
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-600">{label}</span>
      <span className={`tabular ${ok ? 'text-stone-700' : max ? 'text-red-600' : 'text-ember-600'}`}>
        {fmt.g(value)} <span className="text-stone-400">{max ? 'max' : 'min'} {limit} g</span>
      </span>
    </div>
  )
}

function PickRecipe({ slot, targetProtein, onPick, onClose, onClear, hasCurrent }: {
  slot: SlotName; targetProtein: number; onPick: (id: string, scale: number) => void; onClose: () => void; onClear: () => void; hasCurrent: boolean
}) {
  const nutrition = useAllRecipeNutrition()
  const pantry = usePantrySuggestions()
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const ratings = useLiveQuery(() => allRatings(repo))
  const options = recipes ? rankForSlot({ slot, recipes, nutrition, pantry, targetProtein, ratings }) : []
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Choose ${SLOT_LABEL[slot].toLowerCase()}`}>
      <p className="mb-3 text-sm text-stone-500">Portions are scaled to about {Math.round(targetProtein)} g protein. What you have in the pantry first.</p>
      {options.length === 0 && <p className="text-sm text-stone-600">No recipes are tagged for this meal yet.</p>}
      <ul className="divide-y divide-stone-100">
        {options.map(({ r, scale, kcal, protein, pantry: pc, soon }) => (
          <li key={r.id}>
            <button className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => onPick(r.id, scale)}>
              <RecipeArt recipe={r} className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-stone-800">{r.name}</p>
                <p className="tabular text-xs text-stone-500">
                  {r.cuisine} · {Math.round(protein)} g protein · {Math.round(kcal)} kcal{scale !== 1 && ` · ${scale}×`}
                </p>
                {pc > 0 && <p className="text-xs text-leaf-700">{Math.round(pc * 100)}% in your pantry{soon && ' · uses food dated soon'}</p>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {hasCurrent && <Button variant="danger" className="mt-4 w-full" onClick={onClear}>Clear this meal</Button>}
    </Sheet>
  )
}

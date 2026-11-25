import { useLiveQuery } from 'dexie-react-hooks'
import { CircleAlert, CircleCheck, Clock, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { PantryCheckSheet } from '../../components/PantryCheck'
import { RecipeArt } from '../../components/RecipeArt'
import { Card, cx, fmt } from '../../components/ui'
import { repo, today } from '../../db/instance'
import { approvedTargets } from '../../engines/nutrition/service'
import { SLOT_LABEL, assignMeal, targetsForDate } from '../../lib/day'
import { dayChoice } from '../../lib/schedule'
import { nextMealSlot, suggestForSlot, type Suggestion } from '../../lib/suggestions'

const nowHHMM = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Suggested for lunch": the best recipes for the next meal, from what's left to eat today and what's in the pantry. */
export function SuggestCard() {
  const date = today()
  const data = useLiveQuery(async () => {
    const at = await nextMealSlot(repo, date, nowHHMM())
    return suggestForSlot(repo, { ...at, today: date, now: nowHHMM() })
  }, [date])
  const [open, setOpen] = useState<Suggestion | null>(null)
  if (!data || !data.suggestions.length) return null
  const slotName = SLOT_LABEL[data.slot].toLowerCase()
  const when = data.date === date ? slotName : `tomorrow’s ${slotName}`
  const r = data.remaining

  const use = async (s: Suggestion, subs: Record<string, string>) => {
    const t = await approvedTargets(repo)
    if (!t?.version) throw new Error('Approve your targets first.')
    const day = targetsForDate(t.targetSet, await dayChoice(repo, data.date))
    await assignMeal(repo, { date: data.date, slot: data.slot, time: day.slots[data.slot].time, recipeId: s.recipe.id, portionScale: s.portionScale, targetsId: t.id, targetsVersion: t.version })
    const pm = await repo.db.planned_meals.where('[date+slot]').equals([data.date, data.slot]).first()
    if (pm && Object.keys(subs).length) await repo.update('planned_meals', pm.id, { substitutions: subs })
    setOpen(null)
  }

  return (
    <Card title={`Suggested for ${when}`} icon={Lightbulb}>
      <p className="tabular mb-3 text-sm text-stone-600">
        Still needed today: <b className="text-stone-800">{Math.round(r.energyKcal).toLocaleString('en-AU')} kcal</b> · {Math.round(r.proteinG)} g protein · {Math.round(r.carbsG)} g carbs · {Math.round(r.fatG)} g fat
      </p>
      <ul className="space-y-2">
        {data.suggestions.map((s) => {
          const share = r.proteinG > 0 ? Math.min(100, Math.round((s.nutrition.proteinG / r.proteinG) * 100)) : 100
          return (
            <li key={s.recipe.id}>
              <button type="button" onClick={() => setOpen(s)} className="flex w-full gap-3 rounded-xl border border-stone-200 p-2.5 text-left transition hover:border-leaf-300 hover:bg-leaf-50">
                <RecipeArt recipe={s.recipe} className="h-14 w-14 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-stone-800">{s.recipe.name}</span>
                    {s.current && <span className="shrink-0 text-xs text-stone-500">(planned)</span>}
                  </span>
                  <span className="tabular block text-xs text-stone-600">
                    {fmt.kcal(s.nutrition.energyKcal)} · {Math.round(s.nutrition.proteinG)} g protein ({share}% of what’s left) · {Math.round(s.nutrition.carbsG)} g carbs · {Math.round(s.nutrition.fatG)} g fat
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    <span className={cx('inline-flex items-center gap-1 font-medium', s.availability.allAvailable ? 'text-leaf-700' : 'text-orange-900')}>
                      {s.availability.allAvailable ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden />}
                      {s.availability.allAvailable ? 'All in pantry' : `${s.availability.missing + s.availability.partial} to buy`}
                    </span>
                    <span className="inline-flex items-center gap-1 text-stone-500"><Clock className="h-3.5 w-3.5" aria-hidden />{s.totalMin} min</span>
                    {s.costCents !== null && <span className="text-stone-500">{fmt.money(s.costCents)}</span>}
                    {s.reasons[0] && <span className="text-leaf-700">{s.reasons[0]}</span>}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {open && (
        <PantryCheckSheet
          title={open.recipe.name}
          recipeId={open.recipe.id}
          portionScale={open.portionScale}
          date={data.date}
          useLabel={open.current ? `Keep it for ${when}` : `Use for ${when}`}
          onUse={(subs) => use(open, subs)}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  )
}

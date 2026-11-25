import { useLiveQuery } from 'dexie-react-hooks'
import { CircleAlert, CircleCheck, Clock, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecipeArt } from '../../components/RecipeArt'
import { Badge, Input, Select, Sheet, cx, fmt } from '../../components/ui'
import { repo } from '../../db/instance'
import type { Recipe } from '../../db/types'
import { checkAvailability, type AvailabilitySummary } from '../../engines/availability/engine'
import type { PlanSlot } from '../../engines/planner/engine'
import { SLOT_LABEL, SLOT_TAGS } from '../../lib/day'
import { loadCostContext, recipeServingCosts } from '../../lib/expenses'
import { loadLots, loadMealContext, mealNeeds } from '../../lib/meals'
import { portionForProtein, scaleNutrients } from '../../lib/nutrition'
import type { DaySummary } from '../../lib/planOps'
import { loadRecipeNutrition } from '../../lib/rank'
import { allRatings } from '../../lib/ratings'

type Pantry = 'any' | 'all' | 'shopping'
type Sort = 'fit' | 'protein' | 'kcal' | 'time' | 'cost'

/**
 * Browse recipes for one meal: filters (protein, calories, carbs, time, cost, pantry), each recipe's
 * contribution to what the day still needs, and what's missing, before you choose.
 */
export function RecipePicker({ day, slot, onPick, onClose }: { day: DaySummary; slot: PlanSlot; onPick: (recipeId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [pantry, setPantry] = useState<Pantry>('any')
  const [minP, setMinP] = useState('')
  const [maxKcal, setMaxKcal] = useState('')
  const [maxCarbs, setMaxCarbs] = useState('')
  const [maxMin, setMaxMin] = useState('')
  const [maxCost, setMaxCost] = useState('')
  const [sort, setSort] = useState<Sort>('fit')
  const [filters, setFilters] = useState(false)

  const st = day.target.slots[slot]
  const current = day.meals.find((m) => m.slot === slot)
  // still needed for the day without this meal
  const without = {
    kcal: day.target.energyKcal - (day.totals.energyKcal - (current?.nutrition?.energyKcal ?? 0)),
    p: day.target.proteinG.preferred - (day.totals.proteinG - (current?.nutrition?.proteinG ?? 0)),
    c: day.target.carbsG - (day.totals.carbsG - (current?.nutrition?.carbsG ?? 0)),
    f: day.target.fatG - (day.totals.fatG - (current?.nutrition?.fatG ?? 0)),
  }

  const data = useLiveQuery(async () => {
    const [recipes, nutrition, mctx, { lots, productFood }, costCtx, ratings] = await Promise.all([repo.db.recipes.toArray(), loadRecipeNutrition(repo), loadMealContext(repo), loadLots(repo), loadCostContext(repo), allRatings(repo)])
    const costs = await recipeServingCosts(repo, costCtx)
    const tags = new Set(SLOT_TAGS[slot])
    return recipes
      .filter((r) => !r.fixedSlot && r.slotTags.some((t) => tags.has(t)) && !ratings.get(r.id)?.flags.includes('do_not_recommend'))
      .map((r) => {
        const n = nutrition.get(r.id)!
        const scale = portionForProtein(n.perServing.proteinG, (st.proteinG[0] + st.proteinG[1]) / 2)
        const per = scaleNutrients(n.perServing, scale)
        const a: AvailabilitySummary = checkAvailability(mealNeeds(mctx, { recipeId: r.id, portionScale: scale }, productFood), lots, day.date)
        const c = costs.get(r.id)
        return { r, scale, per, a, cost: c && c.coveredPct === 100 ? Math.round(c.cents * scale) : null, mins: r.prepMin + r.cookMin, favourite: !!ratings.get(r.id)?.flags.includes('favourite') }
      })
  }, [slot, day.date])

  const list = useMemo(() => {
    if (!data) return []
    const num = (s: string) => (s.trim() ? Number(s) : null)
    const fitScore = (x: (typeof data)[number]) =>
      // how closely carbs and fat land in this meal's range, plus pantry and favourites
      -(Math.abs(x.per.carbsG - (st.carbsG[0] + st.carbsG[1]) / 2) / 20 + Math.abs(x.per.fatG - (st.fatG[0] + st.fatG[1]) / 2) / 15) + x.a.coverage + (x.favourite ? 0.3 : 0)
    return data
      .filter((x) => !q.trim() || x.r.name.toLowerCase().includes(q.trim().toLowerCase()) || x.r.cuisine.toLowerCase().includes(q.trim().toLowerCase()))
      .filter((x) => pantry === 'any' || (pantry === 'all' ? x.a.allAvailable : !x.a.allAvailable))
      .filter((x) => num(minP) === null || x.per.proteinG >= num(minP)!)
      .filter((x) => num(maxKcal) === null || x.per.energyKcal <= num(maxKcal)!)
      .filter((x) => num(maxCarbs) === null || x.per.carbsG <= num(maxCarbs)!)
      .filter((x) => num(maxMin) === null || x.mins <= num(maxMin)!)
      .filter((x) => num(maxCost) === null || (x.cost !== null && x.cost <= num(maxCost)! * 100))
      .sort((a, b) => (sort === 'protein' ? b.per.proteinG - a.per.proteinG : sort === 'kcal' ? a.per.energyKcal - b.per.energyKcal : sort === 'time' ? a.mins - b.mins : sort === 'cost' ? (a.cost ?? 1e9) - (b.cost ?? 1e9) : fitScore(b) - fitScore(a)))
  }, [data, q, pantry, minP, maxKcal, maxCarbs, maxMin, maxCost, sort, st])

  const pct = (v: number, of: number) => (of > 0 ? `${Math.round((v / of) * 100)}%` : '—')
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${SLOT_LABEL[slot]} · ${fmt.date(day.date)}`}>
      <p className="tabular mb-3 text-sm text-stone-600">
        Still needed that day: <b className="text-stone-800">{Math.max(0, Math.round(without.kcal)).toLocaleString('en-AU')} kcal</b> · {Math.max(0, Math.round(without.p))} g protein · {Math.max(0, Math.round(without.c))} g carbs · {Math.max(0, Math.round(without.f))} g fat
      </p>
      <div className="flex gap-2">
        <Input aria-label="Search recipes" placeholder="Search recipes or cuisines" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" aria-expanded={filters} onClick={() => setFilters(!filters)} className={cx('inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium', filters ? 'border-leaf-500 bg-leaf-50 text-leaf-700' : 'border-stone-300 text-stone-700')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden />Filters
        </button>
      </div>
      <div role="radiogroup" aria-label="Pantry" className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 text-sm">
        {([['any', 'All recipes'], ['all', 'All in pantry'], ['shopping', 'Needs shopping']] as Array<[Pantry, string]>).map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={pantry === v} onClick={() => setPantry(v)} className={cx('min-h-9 rounded-lg font-medium', pantry === v ? 'bg-white text-leaf-700 shadow-card' : 'text-stone-600')}>{l}</button>
        ))}
      </div>
      {filters && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input aria-label="Minimum protein (g)" inputMode="numeric" placeholder="Protein at least (g)" value={minP} onChange={(e) => setMinP(e.target.value)} />
          <Input aria-label="Maximum calories" inputMode="numeric" placeholder="Calories up to" value={maxKcal} onChange={(e) => setMaxKcal(e.target.value)} />
          <Input aria-label="Maximum carbs (g)" inputMode="numeric" placeholder="Carbs up to (g)" value={maxCarbs} onChange={(e) => setMaxCarbs(e.target.value)} />
          <Input aria-label="Maximum minutes" inputMode="numeric" placeholder="Ready in (min)" value={maxMin} onChange={(e) => setMaxMin(e.target.value)} />
          <Input aria-label="Maximum cost ($)" inputMode="decimal" placeholder="Cost up to ($)" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="fit">Best fit</option><option value="protein">Most protein</option><option value="kcal">Fewest calories</option><option value="time">Quickest</option><option value="cost">Cheapest</option>
          </Select>
        </div>
      )}
      <p className="mt-2 text-xs text-stone-500">{data ? `${list.length} recipe${list.length === 1 ? '' : 's'}` : 'Loading…'} · portions sized to {Math.round((st.proteinG[0] + st.proteinG[1]) / 2)} g protein</p>
      <ul className="mt-1 divide-y divide-stone-100">
        {list.map((x) => {
          const missing = x.a.lines.filter((l) => l.status !== 'available')
          // fit: does this meal stay within what the day still needs, with protein in this meal's range?
          const overKcal = x.per.energyKcal > Math.max(0, without.kcal) * 1.05
          const protOk = x.per.proteinG >= st.proteinG[0] * 0.9 && x.per.proteinG <= st.proteinG[1] * 1.1
          const fit = overKcal ? { tone: 'red' as const, text: 'more than the day has left' } : protOk ? { tone: 'leaf' as const, text: 'good fit' } : { tone: 'ember' as const, text: x.per.proteinG < st.proteinG[0] ? 'low in protein for this meal' : 'more protein than this meal needs' }
          return (
            <li key={x.r.id}>
              <button type="button" onClick={() => onPick(x.r.id)} className="flex w-full gap-3 py-2.5 text-left" aria-label={`Choose ${x.r.name}`}>
                <RecipeArt recipe={x.r as Recipe} className="h-14 w-14 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-stone-800">{x.r.name}</span>
                    {current?.recipe?.id === x.r.id && <Badge>current</Badge>}
                    {x.favourite && <Badge tone="red">♥</Badge>}
                    <Badge tone={fit.tone}>{fit.text}</Badge>
                  </span>
                  <span className="tabular block text-xs text-stone-600">
                    {Math.round(x.per.energyKcal)} kcal ({pct(x.per.energyKcal, without.kcal)}) · P {Math.round(x.per.proteinG)} g ({pct(x.per.proteinG, without.p)}) · C {Math.round(x.per.carbsG)} g · F {Math.round(x.per.fatG)} g
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className={cx('inline-flex items-center gap-1 font-medium', x.a.allAvailable ? 'text-leaf-700' : 'text-orange-900')}>
                      {x.a.allAvailable ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden />}
                      {x.a.allAvailable ? 'All in pantry' : `Missing: ${missing.slice(0, 3).map((l) => l.label.toLowerCase()).join(', ')}${missing.length > 3 ? ` +${missing.length - 3}` : ''}`}
                    </span>
                    <span className="inline-flex items-center gap-1 text-stone-500"><Clock className="h-3.5 w-3.5" aria-hidden />{x.mins} min</span>
                    {x.cost !== null && <span className="text-stone-500">{fmt.money(x.cost)}</span>}
                    <span className="text-stone-500">{x.r.cuisine}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

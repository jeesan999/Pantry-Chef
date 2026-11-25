import { useLiveQuery } from 'dexie-react-hooks'
import { ChefHat, ShoppingCart, Snowflake, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Notice, Sheet, cx, fmt } from '../../components/ui'
import { repo } from '../../db/instance'
import { formatQty } from '../../engines/shopping/engine'
import { SLOT_LABEL } from '../../lib/day'
import { bulkPrep, planCosts, type DaySummary } from '../../lib/planOps'
import { currentList, generateList, type ListRange } from '../../lib/shopping'

/** Weekly (or 4-day) food cost and budget, with the shopping list and bulk prep buttons. */
export function PlanTools({ range, days, today }: { range: ListRange; days: DaySummary[]; today: string }) {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [prep, setPrep] = useState(false)
  const costs = useLiveQuery(() => planCosts(repo, range).catch(() => null), [range.from, range.to, JSON.stringify(days.map((d) => d.meals.map((m) => m.meal?.id + String(m.meal?.portionScale) + m.meal?.recipeId)))])
  const planned = days.flatMap((d) => d.meals.filter((m) => m.meal && m.slot !== 'breakfast')).length

  const buildList = async (mealIds?: string[]) => {
    setBusy(true)
    setErr(null)
    try {
      const list = await currentList(repo)
      const r = await generateList(repo, range, list?.id, { mealIds })
      const msg = `Built from ${r.plannedMeals} planned meal${r.plannedMeals === 1 ? '' : 's'}${r.meals > r.plannedMeals ? ` and ${r.meals - r.plannedMeals} breakfast${r.meals - r.plannedMeals === 1 ? '' : 's'}` : ''}: ${r.toBuy} to buy.`
      nav('/shopping', { state: { msg } })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={`Food cost ${fmt.date(range.from)} – ${fmt.date(range.to)}`} icon={Wallet}>
      {costs ? (
        <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Stat label="Plan total" value={costs.totalCents ? fmt.money(costs.totalCents) : '—'} note={costs.unpricedMeals ? `${costs.unpricedMeals} meal${costs.unpricedMeals === 1 ? '' : 's'} not priced` : undefined} />
          <Stat label="Per day" value={costs.perDayCents ? fmt.money(costs.perDayCents) : '—'} />
          <Stat label="Per meal" value={costs.perMealCents ? fmt.money(costs.perMealCents) : '—'} />
          <Stat label="From your pantry" value={fmt.money(costs.pantryCents)} />
          <Stat label="Still to buy" value={fmt.money(costs.toBuyCents)} note={costs.unpricedToBuy ? `+ ${costs.unpricedToBuy} item${costs.unpricedToBuy === 1 ? '' : 's'} not priced` : undefined} />
          {costs.budget ? (
            <Stat label="Weekly budget" value={fmt.money(costs.budget.limitCents)} note={
              <span className={cx('font-medium', costs.budget.status.level === 'over' ? 'text-red-700' : costs.budget.status.level === 'warn' ? 'text-ember-600' : 'text-leaf-700')}>
                {costs.budget.status.level === 'over' ? `${fmt.money(-costs.budget.status.remainingCents)} over` : `within budget, ${fmt.money(costs.budget.status.remainingCents)} spare`}
              </span>
            } />
          ) : (
            <Stat label="Weekly budget" value="not set" note={<a href="#/expenses" className="text-leaf-700 underline">Set one</a>} />
          )}
        </dl>
      ) : (
        <p className="text-sm text-stone-500">Working out costs…</p>
      )}
      {err && <div className="mt-2"><Notice tone="red">{err}</Notice></div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button onClick={() => buildList()} disabled={busy}><ShoppingCart className="h-4 w-4" aria-hidden />Generate shopping list</Button>
        <Button variant="secondary" onClick={() => setPrep(true)} disabled={planned === 0}><ChefHat className="h-4 w-4" aria-hidden />Bulk prep</Button>
      </div>
      <p className="mt-1.5 text-xs text-stone-500">The list subtracts what’s in your pantry. Nothing is taken from the pantry until you mark a meal eaten.</p>
      {prep && <BulkPrepSheet days={days} today={today} onClose={() => setPrep(false)} onList={(ids) => { setPrep(false); buildList(ids) }} />}
    </Card>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-semibold text-stone-800">{value}</dd>
      {note && <dd className="text-xs text-stone-500">{note}</dd>}
    </div>
  )
}

function BulkPrepSheet({ days, today, onClose, onList }: { days: DaySummary[]; today: string; onClose: () => void; onList: (mealIds: string[]) => void }) {
  const meals = days.flatMap((d) => d.meals.filter((m) => m.meal && m.recipe && m.slot !== 'breakfast' && !m.logged && d.date >= today).map((m) => ({ ...m, date: d.date })))
  const [sel, setSel] = useState<Set<string>>(() => new Set(meals.filter((m) => m.slot !== 'smoko').map((m) => m.meal!.id)))
  const ids = [...sel].sort()
  const b = useLiveQuery(() => (ids.length ? bulkPrep(repo, ids) : null), [ids.join()])
  const toggle = (id: string, on: boolean) => { const n = new Set(sel); if (on) n.add(id); else n.delete(id); setSel(n) }
  const buy = b?.needs.filter((n) => n.buyQty > 0) ?? []
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Bulk prep">
      <details className="mb-3 rounded-xl border border-stone-200 p-2" open={meals.length <= 8}>
        <summary className="cursor-pointer text-sm font-medium text-stone-700">{sel.size} of {meals.length} meals selected</summary>
        <ul className="mt-1 divide-y divide-stone-100 text-sm">
          {meals.map((m) => (
            <li key={m.meal!.id}>
              <label className="flex min-h-10 items-center gap-3">
                <input type="checkbox" className="h-5 w-5 accent-[var(--color-leaf-600)]" checked={sel.has(m.meal!.id)} onChange={(e) => toggle(m.meal!.id, e.target.checked)} />
                <span className="min-w-0 flex-1 truncate">{fmt.date(m.date)} {SLOT_LABEL[m.slot].toLowerCase()}: {m.recipe!.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>
      {!b && sel.size > 0 && <p className="text-sm text-stone-500">Working it out…</p>}
      {b && (
        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-stone-800">Cook</h3>
            <ul className="mt-1 space-y-1.5 text-sm">
              {b.sessions.map((s, i) => (
                <li key={i} className="rounded-xl bg-stone-50 px-3 py-2">
                  <span className="font-medium text-stone-800">{fmt.date(s.date)}: {s.recipe.name}</span>
                  <span className="tabular block text-xs text-stone-600">
                    {+s.portions.toFixed(1)} serving{s.portions === 1 ? '' : 's'} for {s.forDates.map((d) => fmt.date(d)).join(', ')} · {s.recipe.prepMin + s.recipe.cookMin} min
                    {s.freeze > 0 && <span className="inline-flex items-center gap-0.5 text-sky-800"> · <Snowflake className="h-3 w-3" aria-hidden />or cook {s.freeze} more now and freeze</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-stone-500">Cooked food keeps about 3 days in the fridge (fish and seafood 2), so later meals get their own cook or come from the freezer.</p>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-stone-800">Ingredients, combined</h3>
            <ul className="tabular mt-1 divide-y divide-stone-100 text-sm">
              {b.needs.map((n) => (
                <li key={n.key} className="flex items-baseline justify-between gap-2 py-1">
                  <span className="min-w-0 truncate text-stone-800">{n.label}</span>
                  <span className="shrink-0 text-xs text-stone-600">
                    need {formatQty(n.neededQty, n.unit)} · have {formatQty(n.haveQty, n.unit)}
                    {n.buyQty > 0 ? <Badge tone="ember">buy {formatQty(n.buyQty, n.unit)}</Badge> : <Badge tone="leaf">in pantry</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <p className="tabular text-sm text-stone-700">
            {buy.length === 0 ? 'Everything is in your pantry.' : `${buy.length} item${buy.length === 1 ? '' : 's'} to buy, about ${fmt.money(b.toBuyCents)}${b.unpricedItems ? ` + ${b.unpricedItems} not priced` : ''}.`}
          </p>
          <Button className="w-full" disabled={buy.length === 0} onClick={() => onList(b.mealIds)}><ShoppingCart className="h-4 w-4" aria-hidden />Shopping list for these meals</Button>
        </div>
      )}
    </Sheet>
  )
}

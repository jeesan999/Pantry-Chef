import { useLiveQuery } from 'dexie-react-hooks'
import { CircleAlert, CircleCheck, CircleX, Repeat, ShoppingCart, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db, pantry, repo, today } from '../db/instance'
import { summaryText, type IngredientCheck } from '../engines/availability/engine'
import { checkAvailability } from '../engines/availability/engine'
import { formatQty } from '../engines/shopping/engine'
import { eatMeal, eatenFor } from '../lib/eating'
import { loadLots, loadMealContext, mealNeeds, setSubstitution, substituteOptions, type Substitutions } from '../lib/meals'
import { addMissingToList } from '../lib/shopping'
import { Badge, Button, Notice, Sheet, cx } from './ui'

const qty = (q: { amount: number; unit: 'g' | 'ml' | 'unit' }) => formatQty(q.amount, q.unit)

/** Ingredient-by-ingredient pantry check, with swaps and shopping. Reads only until you press a button. */
export function PantryCheck({ recipeId, portionScale, date, plannedMealId, useLabel, onUse }: {
  recipeId: string
  portionScale: number
  date: string
  plannedMealId?: string // a planned meal: swaps are saved on it and it can be cooked
  useLabel?: string // e.g. "Use for lunch"
  onUse?: (subs: Substitutions) => Promise<void> | void
}) {
  const [localSubs, setLocalSubs] = useState<Substitutions>({})
  const [swapping, setSwapping] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ tone: 'leaf' | 'red'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const data = useLiveQuery(async () => {
    const [mctx, { lots, productFood }, pm, logged] = await Promise.all([
      loadMealContext(repo),
      loadLots(repo),
      plannedMealId ? db.planned_meals.get(plannedMealId) : undefined,
      plannedMealId ? eatenFor(repo, plannedMealId) : undefined,
    ])
    const subs = plannedMealId ? pm?.substitutions ?? {} : localSubs
    const meal = { recipeId, portionScale, substitutions: subs }
    const a = checkAvailability(mealNeeds(mctx, meal, productFood), lots, date)
    const options = new Map(a.lines.filter((l) => l.status !== 'available').map((l) => [l.index, substituteOptions(l.foodId, l.short.unit === 'g' ? l.required.amount : 0, lots, mctx.foods, date)]))
    return { a, subs, options, logged: !!logged }
  }, [recipeId, portionScale, date, plannedMealId, JSON.stringify(localSubs)])

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setMsg(null)
    try {
      const t = await fn()
      if (t) setMsg({ tone: 'leaf', text: t })
    } catch (e) {
      setMsg({ tone: 'red', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const swap = (l: IngredientCheck, foodId: string | null) =>
    run(async () => {
      if (!l.ingredientId) return
      if (plannedMealId) await setSubstitution(repo, plannedMealId, l.ingredientId, foodId)
      else setLocalSubs((s) => {
        const n = { ...s }
        if (foodId) n[l.ingredientId!] = foodId
        else delete n[l.ingredientId!]
        return n
      })
      setSwapping(null)
    })

  if (!data) return <p className="text-sm text-stone-500">Checking your pantry…</p>
  const { a, subs, options } = data
  const short = a.lines.filter((l) => l.status !== 'available')
  return (
    <div className="space-y-3">
      <p className={cx('flex items-center gap-2 text-sm font-medium', a.allAvailable ? 'text-leaf-700' : 'text-orange-900')}>
        {a.allAvailable ? <CircleCheck className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
        {summaryText(a)}
      </p>
      <table className="tabular w-full text-sm">
        <thead className="text-xs text-stone-500">
          <tr><th className="py-1 text-left font-normal">Ingredient</th><th className="py-1 text-right font-normal">Needed</th><th className="py-1 pl-3 text-right font-normal">Pantry</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {a.lines.map((l) => {
            const swapped = l.ingredientId && subs[l.ingredientId]
            const opts = options.get(l.index) ?? []
            return (
              <tr key={l.index} className="align-top">
                <td className="py-2 pr-2">
                  <span className={cx('flex items-start gap-1.5', l.status === 'missing' && 'font-semibold text-red-700', l.status === 'partial' && 'font-medium text-orange-900')}>
                    {l.status === 'available' ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-leaf-600" aria-label="available" /> : l.status === 'partial' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ember-600" aria-label="partly available" /> : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="missing" />}
                    <span>{l.label}{l.datedSoon && <Badge tone="ember">dated soon</Badge>}</span>
                  </span>
                  {(opts.length > 0 || swapped) && (
                    <span className="ml-5 mt-1 flex flex-wrap gap-1">
                      {swapped ? (
                        <button type="button" className="text-xs font-medium text-leaf-700 underline" onClick={() => swap(l, null)} disabled={busy}>Undo swap</button>
                      ) : swapping === l.index ? (
                        opts.map((o) => (
                          <button key={o.foodId} type="button" disabled={busy} onClick={() => swap(l, o.foodId)}
                            className="min-h-8 rounded-full border border-leaf-200 bg-leaf-50 px-2.5 text-xs font-medium text-leaf-800">Use {o.label.toLowerCase()} ({formatQty(o.haveG, 'g')} in pantry)</button>
                        ))
                      ) : (
                        <button type="button" className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-leaf-700" onClick={() => setSwapping(l.index)}>
                          <Repeat className="h-3.5 w-3.5" aria-hidden />Swap for something you have ({opts.length})
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right text-stone-700">{qty(l.required)}</td>
                <td className="py-2 pl-3 text-right">
                  {l.status === 'available' ? <span className="text-leaf-700">Available</span>
                    : l.status === 'partial' ? <span className="text-orange-900">Have {qty(l.have)}<span className="block text-xs">need {qty(l.short)} more</span></span>
                    : <span className="font-semibold text-red-700">Missing</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2">
        {onUse && (
          <Button disabled={busy} onClick={() => run(async () => { await onUse(subs) })} className="sm:col-span-2">{useLabel ?? 'Use this recipe'}</Button>
        )}
        {plannedMealId && a.allAvailable && !data.logged && (
          <Button disabled={busy} onClick={() => run(async () => { await eatMeal(repo, pantry, plannedMealId, 1, today()); return 'Cooked and logged: the ingredients came out of your pantry.' })}>
            <Sparkles className="h-4 w-4" aria-hidden />Cook it and mark eaten
          </Button>
        )}
        {short.length > 0 && (
          <Button variant="secondary" disabled={busy} onClick={() => run(async () => {
            const n = await addMissingToList(repo, today(), short)
            return `Added ${n} item${n === 1 ? '' : 's'} to your shopping list.`
          })}>
            <ShoppingCart className="h-4 w-4" aria-hidden />Add {short.length} missing to shopping list
          </Button>
        )}
        {!a.allAvailable && (
          <Link to="/recipes?cookable=1" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-leaf-700 hover:bg-leaf-50">Show recipes I can make now</Link>
        )}
      </div>
      <p className="text-xs text-stone-500">Checking doesn’t take anything from your pantry. Food only comes out when you mark a meal eaten.</p>
    </div>
  )
}

/** The pantry check in a sheet. */
export function PantryCheckSheet({ title, onClose, ...props }: Parameters<typeof PantryCheck>[0] & { title: string; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={title}>
      <PantryCheck {...props} />
    </Sheet>
  )
}

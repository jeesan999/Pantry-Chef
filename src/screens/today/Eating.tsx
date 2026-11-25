import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Field, Input, Notice, Select, Sheet, cx, fmt } from '../../components/ui'
import { db, pantry, repo, today } from '../../db/instance'
import { FIXED_BREAKFAST_ID } from '../../db/seed'
import type { MealConsumption, PlannedMeal, QtyUnit } from '../../db/types'
import type { SlotName } from '../../engines/contract'
import { SLOT_LABEL } from '../../lib/day'
import { eatMeal, eatQuick, ensureBreakfast, previewMeal, previewQuick, undoEaten, type QuickChoice } from '../../lib/eating'
import { searchItems } from '../../lib/itemSearch'

const FRACTIONS: Array<[number, string]> = [[1, 'All'], [0.75, '¾'], [0.5, 'Half'], [0.25, '¼']]
const fracLabel = (f: number) => (f === 0 ? 'skipped' : f === 1 ? 'eaten' : `eaten · ${FRACTIONS.find(([x]) => x === f)?.[1] ?? `${Math.round(f * 100)}%`}`)

/** Eaten / Skipped for one meal, or what was logged with Undo. */
export function EatBar({ date, slot, planned, logged, recipeName }: { date: string; slot: SlotName; planned?: PlannedMeal; logged?: MealConsumption; recipeName?: string }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const mealId = async () => (slot === 'breakfast' ? (await ensureBreakfast(repo, date)).id : planned!.id)
  if (!recipeName) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-4 py-2">
      {logged ? (
        <>
          <span className="flex items-center gap-2 text-sm">
            <Badge tone={logged.fractionEaten === 0 ? 'stone' : 'leaf'}>{fracLabel(logged.fractionEaten)}</Badge>
            <span className="tabular text-stone-500">{logged.time}{logged.fractionEaten > 0 ? ` · ${fmt.kcal(logged.nutrition.energyKcal)}` : ''}</span>
          </span>
          <Button variant="ghost" className="min-h-9 px-2" disabled={busy} aria-label={`Undo ${SLOT_LABEL[slot]}`} onClick={() => run(() => undoEaten(repo, pantry, logged.id))}>Undo</Button>
        </>
      ) : (
        <span className="flex gap-2">
          <Button className="min-h-9" disabled={busy} aria-label={`Mark ${SLOT_LABEL[slot]} eaten`} onClick={() => setOpen(true)}>Eaten</Button>
          <Button variant="secondary" className="min-h-9" disabled={busy} aria-label={`Mark ${SLOT_LABEL[slot]} skipped`} onClick={() => run(async () => eatMeal(repo, pantry, await mealId(), 0, today()))}>Skipped</Button>
        </span>
      )}
      {err && <p className="w-full text-xs text-red-600">{err}</p>}
      {open && (
        <EatSheet
          title={`${SLOT_LABEL[slot]}: ${recipeName}`}
          meal={planned ?? { date, recipeId: FIXED_BREAKFAST_ID, portionScale: 1 }}
          onClose={() => setOpen(false)}
          onConfirm={(f) => run(async () => {
            await eatMeal(repo, pantry, await mealId(), f, today())
            setOpen(false)
          })}
          busy={busy}
          error={err}
        />
      )}
    </div>
  )
}

function EatSheet({ title, meal, onClose, onConfirm, busy, error }: {
  title: string; meal: Pick<PlannedMeal, 'date' | 'recipeId' | 'portionScale'>; onClose: () => void; onConfirm: (f: number) => void; busy: boolean; error: string
}) {
  const [f, setF] = useState(1)
  const pre = useLiveQuery(() => previewMeal(repo, meal, f), [meal.recipeId, meal.portionScale, meal.date, f])
  const missing = pre?.lines.filter((l) => l.missing) ?? []
  const taken = pre?.lines.filter((l) => l.taken) ?? []
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="How much did you eat" className="grid grid-cols-4 rounded-xl bg-stone-100 p-1">
          {FRACTIONS.map(([v, l]) => (
            <button key={v} role="radio" aria-checked={f === v} onClick={() => setF(v)}
              className={cx('min-h-10 rounded-lg text-sm font-medium transition', f === v ? 'bg-white text-leaf-700 shadow-sm' : 'text-stone-600')}>{l}</button>
          ))}
        </div>
        {pre && (
          <div className="tabular space-y-2 text-sm">
            <p className="text-stone-700">{fmt.kcal(pre.nutrition.energyKcal)} · {Math.round(pre.nutrition.proteinG)} g protein · {Math.round(pre.nutrition.carbsG)} g carbs · {Math.round(pre.nutrition.fatG)} g fat</p>
            {taken.length > 0 && (
              <div>
                <p className="font-medium text-stone-700">From your pantry</p>
                <ul className="text-stone-600">{taken.map((l) => <li key={l.label}>{l.label}: {l.taken}</li>)}</ul>
              </div>
            )}
            {missing.length > 0 && (
              <p className="text-stone-500">Not in your pantry, so nothing to take out (still counted in your totals): {missing.map((l) => `${l.label} ${l.missing}`).join(', ')}</p>
            )}
            {f < 1 && pre.wasteCents > 0 && <Notice tone="stone">The rest you cooked is recorded as leftover waste ({fmt.money(pre.wasteCents)}).</Notice>}
            {f < 1 && pre.wasteCents === 0 && taken.length > 0 && <Notice tone="stone">The rest you cooked is recorded as leftover waste.</Notice>}
          </div>
        )}
        {error && <Notice tone="red">{error}</Notice>}
        <Button className="w-full" disabled={busy} onClick={() => onConfirm(f)}>Log it</Button>
      </div>
    </Sheet>
  )
}

/** Quick foods logged on a day, with Add food. */
export function SnacksCard({ date, quick }: { date: string; quick: MealConsumption[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Card title="Snacks & extras" action={<Button variant="ghost" onClick={() => setOpen(true)}>Add food</Button>}>
      {quick.length ? (
        <ul className="tabular divide-y divide-stone-100 text-sm">
          {quick.map((q) => (
            <li key={q.id} className="flex min-h-11 items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-stone-800">{q.quick!.label} <span className="text-stone-500">· {q.quick!.unit === 'unit' ? `${q.quick!.quantity}` : `${q.quick!.quantity} ${q.quick!.unit}`}</span></span>
                <span className="block text-xs text-stone-500">{q.time} · {q.slot === 'snack' || !q.slot ? 'snack' : SLOT_LABEL[q.slot]} · {fmt.kcal(q.nutrition.energyKcal)} · {Math.round(q.nutrition.proteinG)} g protein</span>
              </span>
              <Button variant="ghost" className="min-h-9 px-2" disabled={busy} aria-label={`Undo ${q.quick!.label}`}
                onClick={async () => { setBusy(true); try { await undoEaten(repo, pantry, q.id) } finally { setBusy(false) } }}>Undo</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">Ate something outside your meals? Add it so your totals stay true.</p>
      )}
      {open && <QuickSheet date={date} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function QuickSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const products = useLiveQuery(() => db.products.toArray())
  const foods = useLiveQuery(() => db.foods.toArray())
  const stocked = useLiveQuery(async () => {
    const [lots, ps] = await Promise.all([db.inventory_lots.toArray(), db.products.toArray()])
    const pf = new Map(ps.map((p) => [p.id, p.foodId]))
    const ids = new Set<string>()
    for (const l of lots) if (l.remaining > 1e-9) { ids.add(l.productId); const f = pf.get(l.productId); if (f) ids.add(f) }
    return ids
  })
  const [q, setQ] = useState('')
  const [choice, setChoice] = useState<QuickChoice | null>(null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<QtyUnit>('g')
  const [slot, setSlot] = useState<SlotName | 'snack'>('snack')
  const [fromPantry, setFromPantry] = useState(true)
  const [err, setErr] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const hits = useMemo(() => (q.trim() && products && foods ? searchItems(q, products, foods, 8) : []), [q, products, foods])
  const label = choice ? (choice.kind === 'product' ? choice.product.name : choice.label) : ''
  const inStock = !!choice && !!stocked && (choice.kind === 'product' ? stocked.has(choice.product.id) || (!!choice.product.foodId && stocked.has(choice.product.foodId)) : stocked.has(choice.food.id))
  const amount = Number(qty)
  const pre = useLiveQuery(async () => {
    if (!choice || !(amount > 0)) return null
    try {
      return { ok: await previewQuick(repo, { choice, quantity: amount, unit, date, slot, fromPantry: fromPantry && inStock }) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [choice, amount, unit, slot, fromPantry, inStock, date])

  const pick = (c: QuickChoice) => {
    setChoice(c)
    const food = c.kind === 'food' ? c.food : foods?.find((f) => f.id === c.product.foodId)
    if (food?.gramsPerUnit) { setUnit('unit'); setQty('1') } else { setUnit('g'); setQty('100') }
  }
  const add = async () => {
    if (!choice) return
    setErr('')
    try {
      await eatQuick(repo, pantry, { choice, quantity: amount, unit, date, slot, fromPantry: fromPantry && inStock }, today())
      setAdded((a) => [...a, label])
      setChoice(null)
      setQ('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Add food">
      {!choice ? (
        <div className="space-y-2">
          <Input autoFocus autoComplete="off" aria-label="Search foods" placeholder="e.g. banana, milk, almonds" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul role="listbox" aria-label="Suggestions" className="max-h-[50dvh] divide-y divide-stone-100 overflow-y-auto">
            {hits.map((h) => (
              <li key={h.kind === 'product' ? h.product.id : h.food.id} role="option" aria-selected={false}>
                <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left text-sm"
                  onClick={() => pick(h.kind === 'product' ? { kind: 'product', product: h.product } : { kind: 'food', food: h.food, label: h.label })}>
                  <span className="text-stone-800">{h.label}</span>
                  {stocked?.has(h.kind === 'product' ? h.product.id : h.food.id) && <Badge tone="leaf">in pantry</Badge>}
                </button>
              </li>
            ))}
          </ul>
          {added.length > 0 && <Notice tone="leaf">Added: {added.join(', ')}</Notice>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-medium text-stone-800">{label} <button type="button" className="ml-2 text-sm font-normal text-leaf-700 underline" onClick={() => setChoice(null)}>change</button></p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="How much"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Unit">
              <Select value={unit} onChange={(e) => setUnit(e.target.value as QtyUnit)}>
                <option value="unit">items</option><option value="g">grams</option><option value="ml">ml</option>
              </Select>
            </Field>
          </div>
          <Field label="With">
            <Select value={slot} onChange={(e) => setSlot(e.target.value as SlotName | 'snack')}>
              <option value="snack">A snack</option>
              {(['breakfast', 'smoko', 'lunch', 'dinner'] as SlotName[]).map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
            </Select>
          </Field>
          {inStock && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" className="h-5 w-5 accent-leaf-600" checked={fromPantry} onChange={(e) => setFromPantry(e.target.checked)} />
              From my pantry (takes it out of stock)
            </label>
          )}
          {pre?.ok && (
            <p className="tabular text-sm text-stone-600">
              {fmt.kcal(pre.ok.nutrition.energyKcal)} · {Math.round(pre.ok.nutrition.proteinG)} g protein · {Math.round(pre.ok.grams)} g
              {pre.ok.missing && <span className="block text-stone-500">Only {pre.ok.taken ?? 'none'} in your pantry; the rest is counted, not deducted.</span>}
            </p>
          )}
          {(pre?.error || err) && <Notice tone="red">{pre?.error ?? err}</Notice>}
          <Button className="w-full" disabled={!pre?.ok} onClick={add}>Add</Button>
        </div>
      )}
    </Sheet>
  )
}

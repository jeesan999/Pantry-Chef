import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { FoodPicker } from '../components/FoodPicker'
import { Badge, Button, Card, Field, Input, Notice, Page, Select, Sheet, fmt } from '../components/ui'
import { db, pantry, repo, today } from '../db/instance'
import { newId, nowIso } from '../db/repo'
import type { Food, InventoryLot, Product, QtyUnit, WasteRecord } from '../db/types'
import { addDays } from '../engines/nutrition/engine'
import { bestFoodMatch } from '../lib/foodMatch'
import { guessCategory, guessStorage, searchItems } from '../lib/itemSearch'
import { usePantrySuggestions } from '../lib/hooks'
import { Link, useSearchParams } from 'react-router-dom'

const LOCATIONS: InventoryLot['location'][] = ['fridge', 'freezer', 'pantry']
const LOC_LABEL = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' }
const CATEGORIES = ['Meat & seafood', 'Dairy & eggs', 'Fruit & veg', 'Grains & bread', 'Tins & jars', 'Oils & sauces', 'Nuts & seeds', 'Frozen', 'Other']

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const unitLabel = (u: QtyUnit) => (u === 'unit' ? '' : ` ${u}`)

export function ExpiryBadge({ lot, now }: { lot: InventoryLot; now: string }) {
  if (!lot.expiryDate) return null
  const d = daysBetween(now, lot.expiryDate)
  const kind = lot.expiryKind === 'best_before' ? 'best before' : 'use by'
  if (d < 0) return <Badge tone="red">{lot.expiryKind === 'best_before' ? 'past best before' : 'past use-by: do not eat'}</Badge>
  if (d === 0) return <Badge tone="ember">{kind} today</Badge>
  if (d <= 3) return <Badge tone="ember">{kind} in {d} d</Badge>
  return <Badge>{kind} {fmt.date(lot.expiryDate)}</Badge>
}

export default function PantryScreen() {
  const now = today()
  const stock = useLiveQuery(() => pantry.stock())
  const products = useLiveQuery(() => db.products.toArray())
  const [params, setParams] = useSearchParams()
  const [adding, setAddingState] = useState(params.get('add') === '1')
  const setAdding = (v: boolean) => {
    setAddingState(v)
    if (!v && params.get('add')) setParams({}, { replace: true })
  }
  const [lotOpen, setLotOpen] = useState<InventoryLot | null>(null)
  const pmap = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const value = (stock ?? []).reduce((s, l) => s + l.remaining * l.unitCostCents, 0)

  return (
    <Page title="Pantry" subtitle={stock ? `${stock.length} items in stock · ${fmt.money(value)} at cost` : ' '} action={<Button onClick={() => setAdding(true)}>Add</Button>}>
      {stock?.length === 0 && (
        <Card>
          <p className="text-stone-700">Your pantry is empty. Add what you have on hand; receipt scanning (Phase 3) will add purchases automatically.</p>
        </Card>
      )}
      {LOCATIONS.map((loc) => {
        const lots = (stock ?? []).filter((l) => l.location === loc)
        if (!lots.length) return null
        return (
          <Card key={loc} title={LOC_LABEL[loc]}>
            <ul className="divide-y divide-stone-100">
              {lots.map((l) => (
                <li key={l.id}>
                  <button className="flex min-h-14 w-full items-center justify-between gap-2 py-2 text-left" onClick={() => setLotOpen(l)}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-800">{pmap.get(l.productId)?.name}</p>
                      <p className="tabular text-xs text-stone-500">{+l.remaining.toFixed(1)}{unitLabel(l.unit)} of {+l.quantity.toFixed(1)}{unitLabel(l.unit)} · bought {fmt.date(l.purchaseDate)}</p>
                    </div>
                    <ExpiryBadge lot={l} now={now} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
      <PantrySuggestions />
      <p className="px-1 text-xs text-stone-500">Expiry is advisory: the app ranks by the dates you enter and cannot judge whether food is safe.</p>
      {adding && <AddLot products={products ?? []} onClose={() => setAdding(false)} />}
      {lotOpen && <LotSheet lot={lotOpen} product={pmap.get(lotOpen.productId)} onClose={() => setLotOpen(null)} />}
    </Page>
  )
}

type Picked =
  | { kind: 'product'; product: Product }
  | { kind: 'food'; food: Food; name: string }
  | { kind: 'new'; name: string }

const defaultUnit = (f?: Food | null): QtyUnit => {
  if (!f) return 'g'
  if (f.gramsPerUnit && /egg|avocado|banana|apple|capsicum|onion|tomato|carrot|zucchini|wrap|sausage/i.test(f.name)) return 'unit'
  if (f.densityGPerMl && /milk|oil|sauce|vinegar|stock|cream|juice|syrup/i.test(f.name)) return 'ml'
  return 'g'
}

/** Manual entry: type what you bought and pick a suggestion; works when receipt scanning fails. */
function AddLot({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const now = today()
  const foods = useLiveQuery(() => db.foods.toArray())
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [newCat, setNewCat] = useState(CATEGORIES[0])
  const [newStorage, setNewStorage] = useState<Product['storage']>('fridge')
  const [food, setFood] = useState<Food | null>(null)
  const [pickFood, setPickFood] = useState(false)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<QtyUnit>('g')
  const [cost, setCost] = useState('')
  const [bought, setBought] = useState(now)
  const [expiry, setExpiry] = useState('')
  const [expiryKind, setExpiryKind] = useState<'use_by' | 'best_before'>('use_by')
  const [location, setLocation] = useState<InventoryLot['location']>('fridge')
  const [error, setError] = useState<string>()
  const [added, setAdded] = useState<string[]>([])

  const hits = useMemo(() => (q.trim() && !picked && foods ? searchItems(q, products, foods, 8) : []), [q, picked, products, foods])
  const autoFood = useMemo(
    () => (picked?.kind === 'new' && !food && foods ? bestFoodMatch(picked.name, foods)?.food ?? null : null),
    [picked, food, foods],
  )

  const choose = (p: Picked) => {
    setPicked(p)
    setError(undefined)
    if (p.kind === 'product') {
      setLocation(p.product.storage)
      setUnit(p.product.packUnit ?? defaultUnit(foods?.find((f) => f.id === p.product.foodId)))
    } else {
      const name = p.kind === 'food' ? p.name : p.name
      const cat = guessCategory(p.kind === 'food' ? p.food.name : name)
      const store = guessStorage(cat, p.kind === 'food' ? p.food.name : name)
      setNewCat(cat)
      setNewStorage(store)
      setLocation(store)
      const f = p.kind === 'food' ? p.food : foods ? bestFoodMatch(name, foods)?.food : undefined
      setUnit(defaultUnit(f))
    }
  }

  const reset = () => {
    setQ(''); setPicked(null); setFood(null); setQty(''); setCost(''); setExpiry(''); setError(undefined)
  }

  const save = async (another: boolean) => {
    setError(undefined)
    const quantity = Number(qty)
    const cents = Math.round(Number(cost || 0) * 100)
    if (!picked) return setError('Type what you bought and pick a suggestion, or add it as a new item.')
    if (!(quantity > 0)) return setError('Enter how much you bought.')
    try {
      let name = ''
      await repo.tx(async () => {
        let p: Product
        if (picked.kind === 'product') p = picked.product
        else {
          name = picked.name.trim()
          const foodId = picked.kind === 'food' ? picked.food.id : (food ?? autoFood)?.id
          p = { id: newId(), name, category: newCat, storage: newStorage, foodId, createdAt: nowIso() }
          await repo.insert('products', p)
        }
        name = p.name
        await pantry.addLot({ productId: p.id, quantity, unit, totalCostCents: cents, purchaseDate: bought, expiryDate: expiry || undefined, expiryKind: expiry ? expiryKind : undefined, location })
      })
      if (another) {
        setAdded((a) => [...a, name])
        reset()
      } else onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const pickedName = picked ? (picked.kind === 'product' ? picked.product.name : picked.name) : ''
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Add to pantry">
      <div className="space-y-3">
        {added.length > 0 && <Notice tone="leaf">Added {added.length}: {added.join(', ')}</Notice>}
        {error && <Notice tone="red">{error}</Notice>}
        {picked ? (
          <div className="rounded-xl bg-leaf-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-leaf-900">{pickedName}</span>
              <button className="min-h-10 px-2 text-sm text-leaf-700" onClick={() => { setPicked(null); setFood(null) }}>Change</button>
            </div>
            {picked.kind === 'food' && <p className="text-xs text-stone-600">From the food list: {picked.food.name}</p>}
            {picked.kind === 'product' && <p className="text-xs text-stone-600">Bought before</p>}
          </div>
        ) : (
          <div>
            <Field label="What did you buy?">
              <Input
                autoFocus
                autoComplete="off"
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls="item-suggestions"
                placeholder="Start typing, e.g. chicken, soy sauce, mayo"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && q.trim()) {
                    e.preventDefault()
                    const h = hits[0]
                    choose(h ? (h.kind === 'product' ? { kind: 'product', product: h.product } : { kind: 'food', food: h.food, name: h.label }) : { kind: 'new', name: q.trim() })
                  }
                }}
              />
            </Field>
            {q.trim() && (
              <ul id="item-suggestions" role="listbox" aria-label="Suggestions" className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-stone-200">
                {hits.map((h) => (
                  <li key={h.kind === 'product' ? h.product.id : h.food.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-leaf-50"
                      onClick={() => choose(h.kind === 'product' ? { kind: 'product', product: h.product } : { kind: 'food', food: h.food, name: h.label })}
                    >
                      <span className="text-stone-800">{h.label}</span>
                      {h.kind === 'product' ? <Badge tone="leaf">bought before</Badge> : <Badge>{guessCategory(h.food.name)}</Badge>}
                    </button>
                  </li>
                ))}
                <li role="option" aria-selected={false}>
                  <button type="button" className="flex min-h-12 w-full items-center px-3 py-2 text-left text-sm font-medium text-leaf-700 hover:bg-leaf-50" onClick={() => choose({ kind: 'new', name: q.trim() })}>
                    Add “{q.trim()}” as a new item
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}

        {picked && picked.kind !== 'product' && (
          <div className="space-y-2 rounded-xl border border-stone-200 p-3">
            {picked.kind === 'food' && (
              <Field label="Name (as on the pack)" hint="Optional; helps match future receipts">
                <Input value={picked.name} onChange={(e) => setPicked({ ...picked, name: e.target.value })} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Category"><Select value={newCat} onChange={(e) => setNewCat(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Usually kept in"><Select value={newStorage} onChange={(e) => { const st = e.target.value as Product['storage']; setNewStorage(st); setLocation(st) }}>{LOCATIONS.map((l) => <option key={l} value={l}>{LOC_LABEL[l]}</option>)}</Select></Field>
            </div>
            {picked.kind === 'new' && (
              <Field label="Nutrition food" hint={autoFood ? 'Matched from the name; tap to change.' : 'Optional: links it to nutrient data so recipes can suggest it.'}>
                <Button variant="secondary" className="w-full" onClick={() => setPickFood(true)}>{food ? food.name : autoFood ? autoFood.name : 'Choose food (optional)'}</Button>
              </Field>
            )}
          </div>
        )}

        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Quantity"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Unit"><Select value={unit} onChange={(e) => setUnit(e.target.value as QtyUnit)}><option value="g">g</option><option value="ml">ml</option><option value="unit">each</option></Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Total paid ($)"><Input inputMode="decimal" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="Bought"><Input type="date" value={bought} max={now} onChange={(e) => setBought(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Expiry"><Input type="date" value={expiry} min={addDays(bought, -1)} onChange={(e) => setExpiry(e.target.value)} /></Field>
          <Field label="Date type"><Select value={expiryKind} onChange={(e) => setExpiryKind(e.target.value as 'use_by' | 'best_before')}><option value="use_by">Use by</option><option value="best_before">Best before</option></Select></Field>
        </div>
        <Field label="Location"><Select value={location} onChange={(e) => setLocation(e.target.value as InventoryLot['location'])}>{LOCATIONS.map((l) => <option key={l} value={l}>{LOC_LABEL[l]}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => save(false)}>Add to pantry</Button>
          <Button variant="secondary" onClick={() => save(true)}>Add and enter another</Button>
        </div>
      </div>
      <FoodPicker open={pickFood} onClose={() => setPickFood(false)} onPick={(f) => { setFood(f); setPickFood(false) }} />
    </Sheet>
  )
}

function LotSheet({ lot: initial, product, onClose }: { lot: InventoryLot; product?: Product; onClose: () => void }) {
  const lot = useLiveQuery(() => db.inventory_lots.get(initial.id), [initial.id]) ?? initial
  const txns = useLiveQuery(() => db.inventory_transactions.where('lotId').equals(initial.id).sortBy('at'), [initial.id])
  const avg = useLiveQuery(() => pantry.weightedAverageCost(initial.productId), [initial.productId, lot.remaining])
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<WasteRecord['reason']>('expired')
  const [error, setError] = useState<string>()
  const reversed = new Set((txns ?? []).filter((t) => t.reversesId).map((t) => t.reversesId))
  const n = Number(amount)
  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    try { await fn(); setAmount('') } catch (e) { setError((e as Error).message) }
  }
  const u = unitLabel(lot.unit)
  const TYPE = { purchase: 'Added', consume: 'Used', discard: 'Thrown out', adjust: 'Count corrected', undo: 'Undone' }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={product?.name ?? 'Item'}>
      <div className="space-y-3">
        {error && <Notice tone="red">{error}</Notice>}
        <p className="tabular text-sm text-stone-600">
          {+lot.remaining.toFixed(1)}{u} left · {fmt.money(lot.unitCostCents * (lot.unit === 'unit' ? 1 : 1000))}{lot.unit === 'unit' ? ' each' : ` per ${lot.unit === 'g' ? 'kg' : 'L'}`}
          {avg != null && lot.unit !== 'unit' && <> · average across stock {fmt.money(avg * 1000)} per {lot.unit === 'g' ? 'kg' : 'L'}</>}
        </p>
        <Field label={`Amount${u}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!(n > 0)} onClick={() => act(() => pantry.consume(lot.id, n))}>Use</Button>
          <Button variant="secondary" disabled={!(n >= 0) || amount === ''} onClick={() => act(() => pantry.adjust(lot.id, n, 'stock count'))}>Set count to this</Button>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select value={reason} onChange={(e) => setReason(e.target.value as WasteRecord['reason'])} aria-label="Reason">
            <option value="expired">Expired</option><option value="spoiled">Spoiled</option><option value="leftover">Leftover not eaten</option><option value="other">Other</option>
          </Select>
          <Button variant="danger" disabled={!(n > 0)} onClick={() => act(() => pantry.discard(lot.id, n, reason))}>Throw out</Button>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-stone-700">History</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {(txns ?? []).slice().reverse().map((t) => (
              <li key={t.id} className="tabular flex items-center justify-between py-2">
                <span className={reversed.has(t.id) ? 'text-stone-400 line-through' : 'text-stone-700'}>
                  {TYPE[t.type]} {t.qtyDelta > 0 ? '+' : ''}{+t.qtyDelta.toFixed(1)}{u}
                  <span className="block text-xs text-stone-400">{new Date(t.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </span>
                {t.type !== 'undo' && !reversed.has(t.id) && <Button variant="ghost" onClick={() => act(() => pantry.undo(t.id))}>Undo</Button>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Sheet>
  )
}

function PantrySuggestions() {
  const s = usePantrySuggestions(6)
  if (!s || s.length === 0) return null
  return (
    <Card title="Cook from your pantry">
      <ul className="divide-y divide-stone-100">
        {s.map((x) => (
          <li key={x.recipe.id}>
            <Link to={`/recipes/${x.recipe.id}`} className="block py-2.5">
              <p className="font-medium text-stone-800">{x.recipe.name}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge tone="leaf">{Math.round(x.coverage * 100)}% in stock</Badge>
                {x.usesSoon.length > 0 && <Badge tone="ember">uses {x.usesSoon[0].toLowerCase()} soon</Badge>}
              </div>
              <p className="mt-1 text-xs text-stone-500">{x.missing.length ? `Need: ${x.missing.join(', ')}` : 'You have everything'}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

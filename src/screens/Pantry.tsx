import { useLiveQuery } from 'dexie-react-hooks'
import Fuse from 'fuse.js'
import { useMemo, useState } from 'react'
import { FoodPicker } from '../components/FoodPicker'
import { Badge, Button, Card, Field, Input, Notice, Page, Select, Sheet, fmt } from '../components/ui'
import { db, pantry, repo, today } from '../db/instance'
import { newId, nowIso } from '../db/repo'
import type { Food, InventoryLot, Product, QtyUnit, WasteRecord } from '../db/types'
import { addDays } from '../engines/nutrition/engine'

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
  const [adding, setAdding] = useState(false)
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
      <p className="px-1 text-xs text-stone-500">Expiry is advisory: the app ranks by the dates you enter and cannot judge whether food is safe.</p>
      {adding && <AddLot products={products ?? []} onClose={() => setAdding(false)} />}
      {lotOpen && <LotSheet lot={lotOpen} product={pmap.get(lotOpen.productId)} onClose={() => setLotOpen(null)} />}
    </Page>
  )
}

function AddLot({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const now = today()
  const [q, setQ] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
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
  const fuse = useMemo(() => new Fuse(products, { keys: ['name', 'brand'], threshold: 0.4 }), [products])
  const matches = q ? fuse.search(q, { limit: 6 }).map((r) => r.item) : []

  const save = async () => {
    setError(undefined)
    const quantity = Number(qty)
    const cents = Math.round(Number(cost || 0) * 100)
    if (!(quantity > 0)) return setError('Enter how much you have.')
    if (!product && !(creating && q.trim())) return setError('Choose a product or create one.')
    try {
      await repo.tx(async () => {
        let p = product
        if (!p) {
          p = { id: newId(), name: q.trim(), category: newCat, storage: newStorage, foodId: food?.id, createdAt: nowIso() }
          await repo.insert('products', p)
        }
        await pantry.addLot({ productId: p.id, quantity, unit, totalCostCents: cents, purchaseDate: bought, expiryDate: expiry || undefined, expiryKind: expiry ? expiryKind : undefined, location })
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Add to pantry">
      <div className="space-y-3">
        {error && <Notice tone="red">{error}</Notice>}
        {product ? (
          <div className="flex items-center justify-between rounded-xl bg-leaf-50 px-3 py-2">
            <span className="font-medium text-leaf-900">{product.name}</span>
            <button className="text-sm text-leaf-700" onClick={() => setProduct(null)}>Change</button>
          </div>
        ) : (
          <>
            <Field label="Product"><Input placeholder="e.g. Chicken breast fillets" value={q} onChange={(e) => { setQ(e.target.value); setCreating(false) }} /></Field>
            {matches.length > 0 && !creating && (
              <ul className="rounded-xl border border-stone-200">
                {matches.map((m) => (
                  <li key={m.id}><button className="w-full px-3 py-2.5 text-left text-sm" onClick={() => { setProduct(m); setLocation(m.storage); setUnit(m.packUnit ?? unit) }}>{m.name}</button></li>
                ))}
              </ul>
            )}
            {q.trim() && !creating && <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>Create “{q.trim()}” as a new product</Button>}
            {creating && (
              <div className="space-y-2 rounded-xl border border-stone-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Category"><Select value={newCat} onChange={(e) => setNewCat(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                  <Field label="Usually kept in"><Select value={newStorage} onChange={(e) => { const s = e.target.value as Product['storage']; setNewStorage(s); setLocation(s) }}>{LOCATIONS.map((l) => <option key={l} value={l}>{LOC_LABEL[l]}</option>)}</Select></Field>
                </div>
                <Field label="Nutrition food" hint="Links the product to its nutrient data, so recipes can use stock and cost.">
                  <Button variant="secondary" className="w-full" onClick={() => setPickFood(true)}>{food ? food.name : 'Choose food (optional)'}</Button>
                </Field>
              </div>
            )}
          </>
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
        <Button className="w-full" onClick={save}>Add to pantry</Button>
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

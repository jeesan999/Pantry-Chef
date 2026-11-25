import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Field, Input, Notice, Select, Sheet, cx, fmt } from '../../components/ui'
import { db, repo } from '../../db/instance'
import type { Product, QtyUnit, ShoppingListItem } from '../../db/types'
import { formatQty } from '../../engines/shopping/engine'
import { guessCategory, searchItems } from '../../lib/itemSearch'
import { addExtra, packsFor, removeItem, setItemQuantity, setTicked, type ExtraChoice } from '../../lib/shopping'

export function ItemRow({ item, product }: { item: ShoppingListItem; product?: Product }) {
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const saveQty = async () => {
    if (editing === null) return
    setErr('')
    try {
      await setItemQuantity(repo, item.id, Number(editing))
      setEditing(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const packs = packsFor(item.quantity, item.unit, product)
  // Shown at once; the saved value takes over when the database answers.
  const [pending, setPending] = useState<boolean | null>(null)
  if (pending !== null && pending === item.ticked) setPending(null) // saved value has caught up
  const ticked = pending ?? item.ticked
  const toggle = async () => {
    setErr('')
    const next = !ticked
    setPending(next)
    try {
      await setTicked(repo, item.id, next)
    } catch (e) {
      setErr((e as Error).message)
      setPending(null)
    }
  }
  const name = item.label ?? 'Item'
  const detail = item.source === 'extra'
    ? 'Extra'
    : [item.haveQty ? `need ${formatQty(item.neededQty ?? item.quantity, item.unit)} · have ${formatQty(item.haveQty, item.unit)}` : '', item.recipes?.length ? `for ${item.recipes.join(', ')}` : '']
      .filter(Boolean)
      .join(' · ')
  return (
    <li className={cx('flex items-center gap-3 py-1.5', ticked && 'opacity-50')}>
      <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={ticked} onChange={toggle} className="h-6 w-6 shrink-0 accent-leaf-600" aria-label={`${name}, ${formatQty(item.quantity, item.unit)}`} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate font-medium text-stone-800', ticked && 'line-through')}>
            {name} <span className="tabular font-normal text-stone-600">{formatQty(item.quantity, item.unit)}</span>
          </span>
          {packs && <span className="tabular block text-xs text-stone-600">{packs.packs} × {formatQty(packs.size, item.unit)} pack{packs.packs === 1 ? '' : 's'}</span>}
          {detail && <span className="block truncate text-xs text-stone-500">{detail}</span>}
          {item.quantityEdited && <span className="block text-xs text-stone-500">amount changed by you</span>}
          {err && <span className="block text-xs text-red-600">{err}</span>}
        </span>
      </label>
      <span className="tabular shrink-0 text-sm">{item.estCostCents !== undefined ? fmt.money(item.estCostCents) : <Badge>no price yet</Badge>}</span>
      {!ticked && (
        <Button variant="ghost" className="shrink-0 px-2 text-stone-500" aria-label={`Change amount of ${name}`} onClick={() => setEditing(String(+item.quantity.toFixed(2)))}><Pencil className="h-4 w-4" aria-hidden /></Button>
      )}
      <Button variant="ghost" className="shrink-0 px-2 text-stone-500" aria-label={`Remove ${name}`} onClick={() => removeItem(repo, item.id)}>✕</Button>
      {editing !== null && (
        <Sheet open onOpenChange={(o) => !o && setEditing(null)} title={`How much ${name.toLowerCase()}?`}>
          <form onSubmit={(e) => { e.preventDefault(); saveQty() }} className="space-y-3">
            <Field label={`Amount (${item.unit === 'unit' ? 'items' : item.unit})`} hint={item.neededQty ? `Your meals need ${formatQty(item.neededQty, item.unit)}${item.haveQty ? `, you have ${formatQty(item.haveQty, item.unit)}` : ''}.` : undefined}>
              <Input autoFocus inputMode="decimal" value={editing} onChange={(e) => setEditing(e.target.value)} />
            </Field>
            {err && <Notice tone="red">{err}</Notice>}
            <Button type="submit" className="w-full">Save amount</Button>
          </form>
        </Sheet>
      )}
    </li>
  )
}

export function AddExtraSheet({ open, onOpenChange, listId }: { open: boolean; onOpenChange: (o: boolean) => void; listId: string }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add to the list">
      {open && <ExtraForm listId={listId} />}
    </Sheet>
  )
}

function ExtraForm({ listId }: { listId: string }) {
  const products = useLiveQuery(() => db.products.toArray())
  const foods = useLiveQuery(() => db.foods.toArray())
  const [q, setQ] = useState('')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState<QtyUnit>('unit')
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState('')
  const hits = useMemo(() => (q.trim() && products && foods ? searchItems(q, products, foods, 6) : []), [q, products, foods])

  const add = async (choice: ExtraChoice, label: string) => {
    setError('')
    const n = Number(qty)
    try {
      await addExtra(repo, listId, choice, n, unit)
      setAdded((a) => [...a, label])
      setQ('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="What do you need?">
        <Input autoFocus autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. dish liquid, milk, snacks" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="How many / much"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Unit">
          <Select value={unit} onChange={(e) => setUnit(e.target.value as QtyUnit)}>
            <option value="unit">items</option>
            <option value="g">grams</option>
            <option value="ml">ml</option>
          </Select>
        </Field>
      </div>
      {q.trim() && (
        <ul role="listbox" aria-label="Suggestions" className="divide-y divide-stone-100">
          {hits.map((h) => (
            <li key={h.kind === 'product' ? h.product.id : h.food.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left text-sm"
                onClick={() => add(h.kind === 'product' ? { kind: 'product', product: h.product } : { kind: 'food', foodId: h.food.id, label: h.label }, h.label)}
              >
                <span className="text-stone-800">{h.label}</span>
                {h.kind === 'product' ? <Badge tone="leaf">yours</Badge> : <Badge>{guessCategory(h.food.name)}</Badge>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="flex min-h-12 w-full items-center py-2 text-left text-sm font-medium text-leaf-700" onClick={() => add({ kind: 'text', name: q }, q.trim())}>
              Add “{q.trim()}”
            </button>
          </li>
        </ul>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      {added.length > 0 && <Notice tone="leaf">Added: {added.join(', ')}</Notice>}
    </div>
  )
}

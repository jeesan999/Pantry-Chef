import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../db/instance'
import type { Food, Product } from '../db/types'
import { guessCategory, searchItems } from '../lib/itemSearch'
import { Badge, Input, Sheet } from './ui'

export type ItemChoice = { kind: 'product'; product: Product } | { kind: 'food'; food: Food; label: string } | { kind: 'none' }

/** Type-ahead over what you have bought before and the food list; used to correct a receipt line. */
export function ItemSearchSheet({ open, initial, onClose, onPick }: { open: boolean; initial: string; onClose: () => void; onPick: (c: ItemChoice) => void }) {
  const products = useLiveQuery(() => db.products.toArray())
  const foods = useLiveQuery(() => db.foods.toArray())
  const [q, setQ] = useState(initial)
  const hits = useMemo(() => (q.trim() && products && foods ? searchItems(q, products, foods, 10) : []), [q, products, foods])
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="What is this item?">
      <Input autoFocus autoComplete="off" aria-label="Search items" placeholder="Start typing, e.g. chicken, soy sauce" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul role="listbox" aria-label="Suggestions" className="mt-2 max-h-[55dvh] divide-y divide-stone-100 overflow-y-auto">
        {hits.map((h) => (
          <li key={h.kind === 'product' ? h.product.id : h.food.id} role="option" aria-selected={false}>
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-left text-sm"
              onClick={() => onPick(h.kind === 'product' ? { kind: 'product', product: h.product } : { kind: 'food', food: h.food, label: h.label })}
            >
              <span className="text-stone-800">{h.label}</span>
              {h.kind === 'product' ? <Badge tone="leaf">bought before</Badge> : <Badge>{guessCategory(h.food.name)}</Badge>}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50" onClick={() => onPick({ kind: 'none' })}>
        Keep it as a new item without a food link
      </button>
    </Sheet>
  )
}

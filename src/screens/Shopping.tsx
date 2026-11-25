import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Field, Input, Notice, Page, Sheet, cx, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import type { ShoppingListItem } from '../db/types'
import { clearTicked, currentList, deleteList, generateList, nextWeekRange, thisWeekRange, type GenerateResult, type ListRange } from '../lib/shopping'
import { AddExtraSheet, ItemRow } from './shopping/parts'

type RangeKind = 'this' | 'next' | 'custom'
const RANGE_OPTIONS: Array<[RangeKind, string]> = [['this', 'This week'], ['next', 'Next week'], ['custom', 'Choose days']]

export default function ShoppingScreen() {
  const now = today()
  const list = useLiveQuery(async () => (await currentList(repo)) ?? null)
  const items = useLiveQuery(async () => (list ? db.shopping_list_items.where('listId').equals(list.id).toArray() : []), [list?.id])
  const products = useLiveQuery(async () => new Map((await db.products.toArray()).map((p) => [p.id, p])))

  const [kind, setKind] = useState<RangeKind | null>(null)
  const [custom, setCustom] = useState<ListRange>(thisWeekRange(now))
  const [built, setBuilt] = useState<GenerateResult | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Default range: the current list's, if it matches a preset; else this week.
  const matches = (r: ListRange) => list && list.from === r.from && list.to === r.to
  const chosen: RangeKind = kind ?? (!list ? 'this' : matches(thisWeekRange(now)) ? 'this' : matches(nextWeekRange(now)) ? 'next' : 'custom')
  const customRange = kind === null && list?.from && list.to && chosen === 'custom' ? { from: list.from, to: list.to } : custom
  const range = chosen === 'this' ? thisWeekRange(now) : chosen === 'next' ? nextWeekRange(now) : customRange

  const build = async () => {
    setError('')
    try {
      setBuilt(await generateList(repo, range, list?.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (list === undefined || items === undefined || !products) return <Page title="Shopping List">{null}</Page>

  const groups = new Map<string, ShoppingListItem[]>()
  for (const i of items) {
    const cat = products.get(i.productId)?.category ?? 'Other'
    groups.set(cat, [...(groups.get(cat) ?? []), i])
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
  const open = items.filter((i) => !i.ticked)
  const toBuyCents = open.reduce((s, i) => s + (i.estCostCents ?? 0), 0)
  const tickedCents = items.filter((i) => i.ticked).reduce((s, i) => s + (i.estCostCents ?? 0), 0)
  const unpriced = open.filter((i) => i.estCostCents === undefined).length

  return (
    <Page
      title="Shopping List"
      subtitle={list?.from && list.to ? `For meals ${fmt.date(list.from)} – ${fmt.date(list.to)}` : 'Built from your meal plan, minus your pantry'}
      action={list ? <Button variant="secondary" onClick={() => setAdding(true)}>Add</Button> : undefined}
    >
      <Card>
        <div role="radiogroup" aria-label="Meals from" className="grid grid-cols-3 rounded-xl bg-stone-100 p-1">
          {RANGE_OPTIONS.map(([k, l]) => (
            <button key={k} role="radio" aria-checked={chosen === k} onClick={() => setKind(k)}
              className={cx('min-h-9 rounded-lg text-sm font-medium transition', chosen === k ? 'bg-white text-leaf-700 shadow-sm' : 'text-stone-600')}>
              {l}
            </button>
          ))}
        </div>
        {chosen === 'custom' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="First day"><Input type="date" value={customRange.from} onChange={(e) => { setKind('custom'); setCustom({ ...customRange, from: e.target.value }) }} /></Field>
            <Field label="Last day"><Input type="date" value={customRange.to} onChange={(e) => { setKind('custom'); setCustom({ ...customRange, to: e.target.value }) }} /></Field>
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">Meals from {fmt.date(range.from)} to {fmt.date(range.to)}, including breakfast each day.</p>
        )}
        <Button className="mt-3 w-full" onClick={build}>{list ? 'Update list' : 'Build list'}</Button>
        {list && <p className="mt-2 text-xs text-stone-500">Updating keeps your ticks and anything you added yourself.</p>}
        {error && <div className="mt-2"><Notice tone="red">{error}</Notice></div>}
        {built && built.plannedMeals === 0 && (
          <div className="mt-2">
            <Notice>
              No meals are planned for these days, so the list only covers breakfast. Choose meals on <Link to="/" className="font-medium underline">Today</Link> or check the <Link to="/plan" className="font-medium underline">Plan</Link>.
            </Notice>
          </div>
        )}
        {built && built.plannedMeals > 0 && (
          <p className="mt-2 text-sm text-leaf-700" role="status">
            Built from {built.plannedMeals} planned meal{built.plannedMeals === 1 ? '' : 's'} and {built.meals - built.plannedMeals} breakfast{built.meals - built.plannedMeals === 1 ? '' : 's'}: {built.toBuy} to buy.
          </p>
        )}
      </Card>

      {list && (
        <>
          <Card>
            <dl className="tabular grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-stone-500">Still to buy (estimate)</dt><dd className="text-lg font-semibold" data-testid="to-buy-total">{toBuyCents === 0 && unpriced > 0 ? <span className="text-base text-stone-500">No prices yet</span> : fmt.money(toBuyCents)}</dd></div>
              <div><dt className="text-stone-500">In the trolley</dt><dd className="text-lg font-semibold">{fmt.money(tickedCents)}</dd></div>
            </dl>
            <p className="mt-1 text-xs text-stone-500">
              {open.length} of {items.length} left{unpriced ? ` · + ${unpriced} item${unpriced === 1 ? '' : 's'} without a price yet` : ''}. Estimates use the latest price you paid.
            </p>
          </Card>

          {items.length === 0 && <Card><p className="text-sm text-stone-600">Nothing to buy: your pantry covers these meals.</p></Card>}
          {sortedGroups.map(([cat, group]) => (
            <Card key={cat} title={cat}>
              <ul className="divide-y divide-stone-100">
                {[...group].sort((a, b) => Number(a.ticked) - Number(b.ticked) || (a.label ?? '').localeCompare(b.label ?? '')).map((i) => <ItemRow key={i.id} item={i} />)}
              </ul>
            </Card>
          ))}

          {!!list.coveredLabels?.length && (
            <Card>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-stone-700">Already in your pantry: {list.coveredLabels.length} item{list.coveredLabels.length === 1 ? '' : 's'}</summary>
                <ul className="mt-2 list-disc pl-5 text-sm text-stone-600">{list.coveredLabels.map((l) => <li key={l}>{l}</li>)}</ul>
              </details>
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={!items.some((i) => i.ticked)} onClick={() => clearTicked(repo, list.id)}>Clear ticked</Button>
            <Button variant="danger" className="flex-1" onClick={() => setConfirmDelete(true)}>Delete list</Button>
          </div>
          <p className="px-1 text-xs text-stone-500">Scan your receipt after shopping: it adds the food to your pantry and ticks what you bought here.</p>

          <AddExtraSheet open={adding} onOpenChange={setAdding} listId={list.id} />
          <Sheet open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this list?">
            <p className="text-sm text-stone-600">Everything on it goes, including items you added yourself. Your meal plan and pantry are not changed.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <Button variant="danger" className="flex-1" onClick={async () => { await deleteList(repo, list.id); setConfirmDelete(false); setBuilt(null); setKind(null) }}>Delete</Button>
            </div>
          </Sheet>
        </>
      )}
    </Page>
  )
}

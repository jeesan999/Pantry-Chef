import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Notice, Page, cx, fmt } from '../components/ui'
import { db, repo, today } from '../db/instance'
import {
  periodLabel,
  periodRange,
  shiftPeriod,
  spendByCategory,
  spendByPeriod,
  spendByProductCategory,
  spendByStore,
  total,
  type BudgetStatus,
  type PeriodKind,
  type Share,
} from '../engines/cost/engine'
import { budgetStatuses, deleteManualExpense, getBudgets, loadCostContext } from '../lib/expenses'
import { BudgetAlerts } from './expenses/BudgetAlerts'
import { ShareBar, SpendBars } from './expenses/charts'
import { AddExpenseSheet, BudgetSheet } from './expenses/sheets'
import { MealCostsCard, PriceHistoryCard, ProteinPerDollarCard } from './expenses/value'

const KINDS: Array<[PeriodKind, string]> = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']]
type Split = 'store' | 'category' | 'food'
const SPLITS: Array<[Split, string]> = [['store', 'Store'], ['category', 'Category'], ['food', 'Food type']]

export default function ExpensesScreen() {
  const [kind, setKind] = useState<PeriodKind>('week')
  const [anchor, setAnchor] = useState(today())
  const [split, setSplit] = useState<Split>('store')
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState('')
  const range = periodRange(kind, anchor)
  const isCurrent = range.start <= today() && today() <= range.end

  const data = useLiveQuery(async () => {
    const [expenses, purchases, products] = await Promise.all([
      db.expenses.where('date').between(range.start, range.end, true, true).toArray(),
      db.grocery_purchases.where('date').between(range.start, range.end, true, true).toArray(),
      db.products.toArray(),
    ])
    return { expenses, purchases, products: new Map(products.map((p) => [p.id, p])) }
  }, [range.start, range.end])
  const budgets = useLiveQuery(() => getBudgets(repo))
  const statuses = useLiveQuery(() => budgetStatuses(repo, today()))
  const ctx = useLiveQuery(() => loadCostContext(repo))
  const tracked = useLiveQuery(async () => {
    const recs = await db.waste_records.toArray()
    const undone = new Set((await db.inventory_transactions.where('type').equals('undo').toArray()).map((t) => t.reversesId))
    return {
      waste: recs.filter((w) => !undone.has(w.transactionId)).reduce((s, w) => s + w.costCents, 0),
      stock: (await db.inventory_lots.toArray()).reduce((s, l) => s + l.remaining * l.unitCostCents, 0),
    }
  })

  const remove = async (id: string) => {
    setError('')
    try {
      await deleteManualExpense(repo, id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const expenses = data?.expenses ?? []
  const shares: Share[] = !data ? [] : split === 'store' ? spendByStore(expenses) : split === 'category' ? spendByCategory(expenses) : spendByProductCategory(data.purchases, data.products)
  const recent = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || a.store.localeCompare(b.store))

  return (
    <Page title="Expenses" action={<Button variant="secondary" onClick={() => setAddOpen(true)}>Add</Button>}>
      <BudgetAlerts statuses={statuses} />

      <Card>
        <Segmented label="Period" options={KINDS} value={kind} onChange={(k) => { setKind(k); setAnchor(today()) }} />
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" aria-label="Previous period" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}>‹</Button>
          <div className="text-center">
            <div className="text-sm text-stone-500">{periodLabel(kind, anchor)}{isCurrent && ' · now'}</div>
            <div className="tabular text-2xl font-semibold text-stone-900" data-testid="period-total">{fmt.money(total(expenses))}</div>
          </div>
          <Button variant="ghost" aria-label="Next period" disabled={isCurrent} onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}>›</Button>
        </div>
        <div className="mt-3">
          <SpendBars buckets={spendByPeriod(expenses, kind, anchor)} caption={`Spending, ${periodLabel(kind, anchor)}`} />
        </div>
      </Card>

      <Card title="Budgets" action={<Button variant="ghost" onClick={() => setBudgetOpen(true)}>{statuses?.length ? 'Change' : 'Set budget'}</Button>}>
        {statuses?.length ? (
          <div className="space-y-3">
            {statuses.map(({ period, status }) => <BudgetRow key={period} label={period === 'week' ? 'This week' : 'This month'} s={status} />)}
          </div>
        ) : (
          <p className="text-sm text-stone-600">Set a weekly or monthly budget to be warned before you go over it.</p>
        )}
      </Card>

      <Card title="Where it went">
        <Segmented label="Split by" options={SPLITS} value={split} onChange={setSplit} />
        {shares.length ? (
          <ul className="tabular mt-3 space-y-2.5 text-sm">
            {shares.map((s) => (
              <li key={s.name}>
                <div className="mb-1 flex justify-between gap-2">
                  <span className="truncate text-stone-800">{s.name}</span>
                  <span className="whitespace-nowrap">{fmt.money(s.cents)} <span className="text-stone-500">· {Math.round(s.pct)}%</span></span>
                </div>
                <ShareBar pct={s.pct} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-stone-600">Nothing spent in this period.</p>
        )}
        {split === 'food' && shares.length > 0 && <p className="mt-2 text-xs text-stone-500">Food lines only, after line discounts.</p>}
      </Card>

      <Card title="Expenses in this period">
        {error && <div className="mb-2"><Notice tone="red">{error}</Notice></div>}
        {recent.length ? (
          <ul className="tabular divide-y divide-stone-100 text-sm">
            {recent.map((e) => (
              <li key={e.id} className="flex min-h-12 items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate font-medium text-stone-800">{e.store}</div>
                  <div className="text-xs text-stone-500">{fmt.date(e.date)} · {e.category}{e.receiptId ? ' · receipt' : ''}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-medium">{fmt.money(e.amountCents)}</span>
                  {!e.receiptId && (
                    <Button variant="ghost" className="px-2 text-stone-500" aria-label={`Delete ${e.store} ${fmt.money(e.amountCents)}`} onClick={() => remove(e.id)}>✕</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-600">
            None yet. <Link to="/scan" className="font-medium text-leaf-700 underline">Scan a receipt</Link> or add one by hand.
          </p>
        )}
      </Card>

      {ctx && <PriceHistoryCard ctx={ctx} />}
      {ctx && <MealCostsCard ctx={ctx} />}
      {ctx && <ProteinPerDollarCard ctx={ctx} />}

      <Card title="Pantry">
        <dl className="tabular grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-stone-500">Stock at cost</dt><dd className="text-lg font-semibold">{fmt.money(tracked?.stock ?? 0)}</dd></div>
          <div><dt className="text-stone-500">Food thrown out</dt><dd className="text-lg font-semibold">{fmt.money(tracked?.waste ?? 0)}</dd></div>
        </dl>
      </Card>

      <BudgetSheet open={budgetOpen} onOpenChange={setBudgetOpen} budgets={budgets ?? {}} />
      <AddExpenseSheet open={addOpen} onOpenChange={setAddOpen} />
    </Page>
  )
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Array<[T, string]>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-xl bg-stone-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([v, l]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx('min-h-9 rounded-lg text-sm font-medium transition', value === v ? 'bg-white text-leaf-700 shadow-sm' : 'text-stone-600')}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

const LEVEL = { ok: { tone: 'leaf', text: 'on track', bar: 'bg-leaf-600' }, warn: { tone: 'ember', text: 'nearly there', bar: 'bg-ember-500' }, over: { tone: 'red', text: 'over budget', bar: 'bg-red-600' } } as const

function BudgetRow({ label, s }: { label: string; s: BudgetStatus }) {
  const l = LEVEL[s.level]
  return (
    <div className="tabular text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-stone-800">{label} <Badge tone={l.tone}>{l.text}</Badge></span>
        <span>{fmt.money(s.spentCents)} <span className="text-stone-500">of {fmt.money(s.limitCents)}</span></span>
      </div>
      <div className="h-2 rounded-full bg-stone-100" role="meter" aria-label={`${label} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.pct)}>
        <div className={cx('h-2 rounded-full', l.bar)} style={{ width: `${Math.min(s.pct, 100)}%` }} />
      </div>
      <div className="mt-1 text-xs text-stone-500">{s.remainingCents >= 0 ? `${fmt.money(s.remainingCents)} left` : `${fmt.money(-s.remainingCents)} over`}</div>
    </div>
  )
}

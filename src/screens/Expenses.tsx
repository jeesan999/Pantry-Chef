import { useLiveQuery } from 'dexie-react-hooks'
import { Card, ComingInPhase, Page, fmt } from '../components/ui'
import { db } from '../db/instance'

export default function ExpensesScreen() {
  const waste = useLiveQuery(async () => {
    const recs = await db.waste_records.toArray()
    const undone = new Set((await db.inventory_transactions.where('type').equals('undo').toArray()).map((t) => t.reversesId))
    return recs.filter((w) => !undone.has(w.transactionId)).reduce((s, w) => s + w.costCents, 0)
  })
  const stockValue = useLiveQuery(async () => (await db.inventory_lots.toArray()).reduce((s, l) => s + l.remaining * l.unitCostCents, 0))
  return (
    <Page title="Expenses">
      <ComingInPhase phase={4} what="Spending by week, month, year, store and category; budgets with alerts; price history; cost per meal and per day; protein per dollar." />
      <Card title="Already tracked">
        <dl className="tabular grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-stone-500">Pantry stock at cost</dt><dd className="text-lg font-semibold">{fmt.money(stockValue ?? 0)}</dd></div>
          <div><dt className="text-stone-500">Food thrown out</dt><dd className="text-lg font-semibold">{fmt.money(waste ?? 0)}</dd></div>
        </dl>
      </Card>
    </Page>
  )
}

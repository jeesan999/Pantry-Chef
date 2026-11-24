import { useState } from 'react'
import { Button, Field, Input, Notice, Select, Sheet } from '../../components/ui'
import { repo, today } from '../../db/instance'
import type { Budget } from '../../db/types'
import { MANUAL_CATEGORIES, addManualExpense, parseDollars, saveBudget } from '../../lib/expenses'

const dollars = (c?: number) => (c ? (c / 100).toFixed(2) : '')

export function BudgetSheet({ open, onOpenChange, budgets }: { open: boolean; onOpenChange: (o: boolean) => void; budgets: Partial<Record<Budget['period'], Budget>> }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Budgets">
      {open && <BudgetForm budgets={budgets} done={() => onOpenChange(false)} />}
    </Sheet>
  )
}

function BudgetForm({ budgets, done }: { budgets: Partial<Record<Budget['period'], Budget>>; done: () => void }) {
  const [week, setWeek] = useState(dollars(budgets.week?.limitCents))
  const [month, setMonth] = useState(dollars(budgets.month?.limitCents))
  const [alert, setAlert] = useState(String(budgets.week?.alertPct ?? budgets.month?.alertPct ?? 80))
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    const w = week.trim() ? parseDollars(week) : 0
    const m = month.trim() ? parseDollars(month) : 0
    const a = Number(alert)
    if (w === null || m === null) return setError('Enter budgets in dollars, like 150 or 150.00.')
    if (!Number.isInteger(a) || a < 1 || a > 100) return setError('The alert must be a whole percent from 1 to 100.')
    try {
      await repo.tx(async () => {
        await saveBudget(repo, 'week', w, a)
        await saveBudget(repo, 'month', m, a)
      })
      done()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Weekly budget ($)" hint="Monday to Sunday">
          <Input inputMode="decimal" value={week} onChange={(e) => setWeek(e.target.value)} placeholder="None" />
        </Field>
        <Field label="Monthly budget ($)">
          <Input inputMode="decimal" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="None" />
        </Field>
      </div>
      <Field label="Alert at (% of budget)" hint="You're warned on Today and here once spending reaches this.">
        <Input inputMode="numeric" value={alert} onChange={(e) => setAlert(e.target.value)} />
      </Field>
      {error && <Notice tone="red">{error}</Notice>}
      <p className="text-xs text-stone-500">Leave a budget empty to remove it.</p>
      <Button className="w-full" onClick={save}>Save budgets</Button>
    </div>
  )
}

export function AddExpenseSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add an expense">
      {open && <ExpenseForm done={() => onOpenChange(false)} />}
    </Sheet>
  )
}

function ExpenseForm({ done }: { done: () => void }) {
  const [store, setStore] = useState('')
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(MANUAL_CATEGORIES[0])
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    const cents = parseDollars(amount)
    if (cents === null) return setError('Enter the amount in dollars, like 12.50.')
    try {
      await addManualExpense(repo, { store, date, amountCents: cents, category })
      done()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">For spending without a receipt to scan. Scanned receipts are added automatically.</p>
      <Field label="Where">
        <Input value={store} onChange={(e) => setStore(e.target.value)} placeholder="e.g. Farmers market" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount ($)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Category">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {MANUAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      {error && <Notice tone="red">{error}</Notice>}
      <Button className="w-full" onClick={save}>Add expense</Button>
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Field, Select, fmt } from '../../components/ui'
import { db, repo, today } from '../../db/instance'
import { FIXED_BREAKFAST_ID } from '../../db/seed'
import { dayCost, priceSummary, proteinPerDollar, type MealCost } from '../../engines/cost/engine'
import { weekDates } from '../../lib/day'
import { recipeServingCosts, type CostContext } from '../../lib/expenses'
import { PriceLine } from './charts'

const UNIT_LABEL = { g: 'per kg', ml: 'per L', unit: 'each' } as const

export function PriceHistoryCard({ ctx }: { ctx: CostContext }) {
  const bought = useMemo(() => {
    const ids = new Set(ctx.points.map((p) => p.productId))
    return [...ids].map((id) => ctx.products.get(id)).filter((p) => !!p).sort((a, b) => a!.name.localeCompare(b!.name))
  }, [ctx])
  const [pick, setPick] = useState('')
  const productId = pick || bought[0]?.id || ''
  const series = ctx.points.filter((p) => p.productId === productId).sort((a, b) => a.date.localeCompare(b.date))
  const sum = priceSummary(series)
  const unit = series[0]?.unit ?? 'unit'

  return (
    <Card title="Price history">
      {!bought.length ? (
        <p className="text-sm text-stone-600">Prices appear here after you <Link to="/scan" className="font-medium text-leaf-700 underline">scan a receipt</Link>.</p>
      ) : (
        <div className="space-y-3">
          <Field label="Product">
            <Select value={productId} onChange={(e) => setPick(e.target.value)}>
              {bought.map((p) => <option key={p!.id} value={p!.id}>{p!.name}</option>)}
            </Select>
          </Field>
          {sum && (
            <dl className="tabular grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-stone-500">Latest</dt><dd className="font-semibold">{fmt.money(sum.latest)}</dd></div>
              <div><dt className="text-stone-500">Lowest</dt><dd className="font-semibold">{fmt.money(sum.lowest)}</dd></div>
              <div><dt className="text-stone-500">Average</dt><dd className="font-semibold">{fmt.money(Math.round(sum.average))}</dd></div>
            </dl>
          )}
          <p className="text-xs text-stone-500">{UNIT_LABEL[unit]}, after discounts · {series.length} {series.length === 1 ? 'purchase' : 'purchases'}</p>
          {series.length > 1 && <PriceLine points={series} unitLabel={UNIT_LABEL[unit]} caption={`Price of ${ctx.products.get(productId)?.name ?? 'product'} over time`} />}
        </div>
      )}
    </Card>
  )
}

function CostValue({ cost }: { cost: MealCost }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {cost.coveredPct < 100 && <Badge tone="ember">partial</Badge>}
      <span className="tabular font-medium">{cost.coveredPct === 0 ? '—' : fmt.money(cost.cents)}</span>
    </span>
  )
}

export function MealCostsCard({ ctx }: { ctx: CostContext }) {
  const date = today()
  const data = useLiveQuery(async () => {
    const dates = weekDates(date)
    const [costs, recipes, planned] = await Promise.all([
      recipeServingCosts(repo, ctx),
      db.recipes.toArray(),
      db.planned_meals.where('date').between(dates[0], dates[6], true, true).toArray(),
    ])
    const scaled = (id: string, scale: number): MealCost | undefined => {
      const c = costs.get(id)
      return c && { ...c, cents: Math.round(c.cents * scale) }
    }
    const day = (d: string) => {
      const meals = [scaled(FIXED_BREAKFAST_ID, 1), ...planned.filter((p) => p.date === d).map((p) => scaled(p.recipeId, p.portionScale))]
      return dayCost(meals.filter((m): m is MealCost => !!m))
    }
    const plannedDays = dates.filter((d) => planned.some((p) => p.date === d))
    return {
      today: day(date),
      weekAvg: plannedDays.length ? dayCost(plannedDays.map(day)) : null,
      plannedDays: plannedDays.length,
      eaten: await (async () => {
        const logs = (await db.meal_consumption.where('date').between(dates[0], date, true, true).toArray()).filter((c) => !c.undone)
        const days = new Set(logs.map((c) => c.date)).size
        return { cents: logs.reduce((s, c) => s + c.costCents, 0), days }
      })(),
      priced: recipes
        .filter((r) => r.id !== FIXED_BREAKFAST_ID)
        .map((r) => ({ recipe: r, cost: costs.get(r.id)! }))
        .filter((x) => x.cost && x.cost.coveredPct > 0)
        .sort((a, b) => b.cost.coveredPct - a.cost.coveredPct || a.cost.cents - b.cost.cents),
    }
  }, [ctx, date])
  if (!data) return null
  const full = data.priced.filter((x) => x.cost.coveredPct === 100)
  const list = (full.length >= 3 ? full : data.priced).slice(0, 6)

  return (
    <Card title="Cost per meal and per day">
      <p className="mb-3 text-xs text-stone-500">Estimated from the latest price you paid for each ingredient. “Partial” means some ingredients have no price yet and are left out, not guessed.</p>
      {data.eaten.days > 0 && (
        <p className="tabular mb-3 rounded-xl bg-leaf-50 px-3 py-2 text-sm text-leaf-900">
          What you ate this week cost {fmt.money(data.eaten.cents)}: {fmt.money(Math.round(data.eaten.cents / data.eaten.days))} a day over {data.eaten.days} logged day{data.eaten.days === 1 ? '' : 's'}.
        </p>
      )}
      <dl className="tabular grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-stone-500">Today’s plan</dt><dd className="text-lg"><CostValue cost={data.today} /></dd></div>
        <div>
          <dt className="text-stone-500">This week, per day</dt>
          <dd className="text-lg">
            {data.weekAvg ? <CostValue cost={{ ...data.weekAvg, cents: Math.round(data.weekAvg.cents / data.plannedDays) }} /> : <span className="text-sm text-stone-500">No meals planned</span>}
          </dd>
        </div>
      </dl>
      <h3 className="mt-4 mb-1 text-sm font-medium text-stone-700">{full.length >= 3 ? 'Cheapest fully priced recipes' : 'Recipes with prices so far'} (per serving)</h3>
      {list.length ? (
        <ul className="divide-y divide-stone-100 text-sm">
          {list.map(({ recipe, cost }) => (
            <li key={recipe.id} className="flex min-h-11 items-center justify-between gap-2 py-1.5">
              <Link to={`/recipes/${recipe.id}`} className="min-w-0 truncate text-stone-800">{recipe.name}</Link>
              <CostValue cost={cost} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-600">No recipe ingredients have a price yet. Scan a receipt to start.</p>
      )}
    </Card>
  )
}

export function ProteinPerDollarCard({ ctx }: { ctx: CostContext }) {
  const rows = [...ctx.prices.byProduct.entries()]
    .map(([pid, price]) => {
      const product = ctx.products.get(pid)
      const food = product?.foodId ? ctx.foods.get(product.foodId) : undefined
      const protein = product?.labelNutrients?.proteinG ?? food?.per100g.proteinG
      const g = protein ? proteinPerDollar(protein, price, food) : null
      return product && g ? { product, g } : null
    })
    .filter((r) => !!r)
    .sort((a, b) => b!.g - a!.g)
    .slice(0, 8)
  return (
    <Card title="Protein per dollar">
      {rows.length ? (
        <>
          <ul className="divide-y divide-stone-100 text-sm">
            {rows.map((r) => (
              <li key={r!.product.id} className="flex min-h-11 items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-stone-800">{r!.product.name}</span>
                <span className="tabular whitespace-nowrap font-medium">{r!.g.toFixed(1)} g / $</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Grams of protein for each dollar, at the latest price you paid.</p>
        </>
      ) : (
        <p className="text-sm text-stone-600">Shows once you’ve bought foods that have protein data.</p>
      )}
    </Card>
  )
}

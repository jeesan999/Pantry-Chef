import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../../components/ui'
import type { Bucket } from '../../engines/cost/engine'

// One series per chart, so one colour: leaf-600 (validated ≥3:1 on the card surface). Grid and axes stay recessive.
const SERIES = '#2e7445'
const GRID = '#e7e5e4'
const AXIS = '#78716c'
const tick = { fill: AXIS, fontSize: 11 }

/** Whole dollars for the axis; full cents in the tooltip. */
const axisMoney = (c: number) => (c >= 100000 ? `$${Math.round(c / 100000)}k` : `$${Math.round(c / 100)}`)

interface TipProps { active?: boolean; label?: string | number; payload?: ReadonlyArray<{ value?: unknown; payload?: unknown }> }

function Tip({ active, payload, title }: TipProps & { title: (row: Record<string, unknown>) => string }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as Record<string, unknown>
  return (
    <div className="tabular rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="text-stone-500">{title(row)}</div>
      <div className="font-semibold text-stone-900">{fmt.money(Number(payload[0].value))}</div>
    </div>
  )
}

export function SpendBars({ buckets, caption }: { buckets: Bucket[]; caption: string }) {
  return (
    <figure>
      <div className="h-44" role="img" aria-label={`${caption}: bar chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
            <YAxis tickFormatter={axisMoney} tick={tick} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: '#f5f5f4' }}
              content={(p: TipProps) => <Tip {...p} title={(r) => (r.start === r.end ? fmt.date(String(r.start)) : `${fmt.date(String(r.start))} – ${fmt.date(String(r.end))}`)} />}
            />
            <Bar dataKey="cents" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-stone-500">Show as table</summary>
        <table className="tabular mt-2 w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <tbody className="divide-y divide-stone-100">
            {buckets.map((b) => (
              <tr key={b.key}><td className="py-1 text-stone-600">{b.label}</td><td className="py-1 text-right">{fmt.money(b.cents)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export function PriceLine({ points, unitLabel, caption }: { points: Array<{ date: string; cents: number; store: string }>; unitLabel: string; caption: string }) {
  const data = points.map((p, i) => ({ ...p, i }))
  return (
    <figure>
      <div className="h-40" role="img" aria-label={`${caption}: line chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tickFormatter={(d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`} tick={tick} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis tickFormatter={(c: number) => `$${(c / 100).toFixed(c < 1000 ? 2 : 0)}`} tick={tick} tickLine={false} axisLine={false} width={52} domain={['auto', 'auto']} />
            <Tooltip cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} content={(p: TipProps) => <Tip {...p} title={(r) => `${fmt.date(String(r.date))} · ${String(r.store)} · ${unitLabel}`} />} />
            <Line type="linear" dataKey="cents" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-stone-500">Show as table</summary>
        <table className="tabular mt-2 w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <tbody className="divide-y divide-stone-100">
            {points.map((p, i) => (
              <tr key={i}><td className="py-1 text-stone-600">{fmt.date(p.date)}</td><td className="py-1 text-stone-600">{p.store}</td><td className="py-1 text-right">{fmt.money(p.cents)} {unitLabel}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** A thin bar showing a share, for breakdown lists. */
export function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-stone-100" aria-hidden>
      <div className="h-1.5 rounded-full bg-leaf-600" style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  )
}

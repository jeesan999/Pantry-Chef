import { useChartPalette } from '../../theme/chart'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../../components/ui'

const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`

interface Row { date: string; kg?: number | null; avg?: number | null; cm?: number }
interface TipProps { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }

function WeightTip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload as Row
  return (
    <div className="tabular rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="text-stone-500">{fmt.date(r.date)}</div>
      {r.kg != null && <div className="text-stone-700">Weigh-in <b className="text-stone-900">{r.kg.toFixed(1)} kg</b></div>}
      {r.avg != null && <div className="text-stone-700">7-day average <b className="text-stone-900">{r.avg.toFixed(1)} kg</b></div>}
    </div>
  )
}

export function WeightChart({ rows, targetKg }: { rows: Array<{ date: string; kg: number; avg: number | null }>; targetKg?: number }) {
  const { TREND, GRID, AXIS, DOTS, SURFACE, tick } = useChartPalette()
  const vals = rows.flatMap((r) => [r.kg, r.avg ?? r.kg]).concat(targetKg ? [targetKg] : [])
  const lo = Math.floor(Math.min(...vals) - 0.5)
  const hi = Math.ceil(Math.max(...vals) + 0.5)
  const last = [...rows].reverse().find((r) => r.avg != null)
  return (
    <figure>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: TREND }} />7-day average</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: DOTS }} />Daily weigh-in</span>
        {targetKg && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: AXIS }} />Target {targetKg} kg</span>}
      </div>
      <div className="h-52" role="img" aria-label={`Weight chart: ${rows.length} weigh-ins${last ? `, latest 7-day average ${last.avg} kg` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 36, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis domain={[lo, hi]} tick={tick} tickLine={false} axisLine={false} width={52} allowDecimals={false} unit=" kg" />
            {targetKg && <ReferenceLine y={targetKg} stroke={AXIS} strokeDasharray="5 4" />}
            <Tooltip cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} content={(p: TipProps) => <WeightTip {...p} />} />
            <Line dataKey="kg" stroke="none" dot={{ r: 3, fill: DOTS, stroke: SURFACE, strokeWidth: 1 }} activeDot={{ r: 5, fill: DOTS }} isAnimationActive={false} legendType="none" />
            <Line
              dataKey="avg"
              stroke={TREND}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: TREND, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
              label={(p: { index?: number; x?: number | string; y?: number | string }) =>
                last && p.index === rows.indexOf(last) ? (
                  <text key="lbl" x={Number(p.x) + 6} y={Number(p.y) + 4} fontSize={11} fill={AXIS} className="tabular">{last.avg!.toFixed(1)}</text>
                ) : <g key={`n${p.index}`} />
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-stone-500">Show as table</summary>
        <table className="tabular mt-2 w-full text-left">
          <caption className="sr-only">Daily weigh-ins and 7-day average</caption>
          <thead className="text-xs text-stone-500"><tr><th className="py-1 font-normal">Date</th><th className="py-1 text-right font-normal">Weigh-in</th><th className="py-1 text-right font-normal">7-day avg</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {[...rows].reverse().map((r) => (
              <tr key={r.date}><td className="py-1 text-stone-600">{fmt.date(r.date)}</td><td className="py-1 text-right">{r.kg.toFixed(1)}</td><td className="py-1 text-right">{r.avg?.toFixed(1) ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export function WaistChart({ rows, targetCm }: { rows: Array<{ date: string; cm: number }>; targetCm?: number }) {
  const { TREND, GRID, AXIS, SURFACE, tick } = useChartPalette()
  const vals = rows.map((r) => r.cm).concat(targetCm ? [targetCm] : [])
  return (
    <figure>
      <div className="h-36" role="img" aria-label={`Waist chart: ${rows.length} measurements, latest ${rows[rows.length - 1]?.cm} cm`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis domain={[Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)]} tick={tick} tickLine={false} axisLine={false} width={56} allowDecimals={false} unit=" cm" />
            {targetCm && <ReferenceLine y={targetCm} stroke={AXIS} strokeDasharray="5 4" />}
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
              content={(p: TipProps) => {
                if (!p.active || !p.payload?.length) return null
                const r = p.payload[0].payload as Row
                return <div className="tabular rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"><div className="text-stone-500">{fmt.date(r.date)}</div><b>{r.cm} cm</b></div>
              }}
            />
            <Line dataKey="cm" stroke={TREND} strokeWidth={2} dot={{ r: 4, fill: TREND, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

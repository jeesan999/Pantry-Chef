import type { Nutrients } from '../db/types'
import type { DayTargets } from '../engines/contract'
import { fitStatus, limitStatus, type Tone } from '../lib/fit'
import { cx, fmt } from './ui'

const TONE_TEXT: Record<Tone, string> = { leaf: 'text-leaf-700', ember: 'text-ember-600', red: 'text-red-700', stone: 'text-stone-500', sky: 'text-sky-700' }

interface Row { label: string; value: number; target: number | null; unit: string; kind: 'target' | 'min' | 'max'; sub?: string }

/**
 * The day's nutrition at a glance: each nutrient, its target, the difference and a status in words.
 * Used on Today and on Plan with the same calculation.
 */
export function DaySnapshot({ totals, day, costCents, unpriced, caption }: {
  totals: Nutrients
  day: DayTargets
  costCents?: number | null
  unpriced?: number
  caption?: string
}) {
  const natural = Math.max(0, totals.sugarsG - totals.addedSugarG)
  const rows: Row[] = [
    { label: 'Calories', value: totals.energyKcal, target: day.energyKcal, unit: 'kcal', kind: 'target' },
    { label: 'Protein', value: totals.proteinG, target: day.proteinG.preferred, unit: 'g', kind: 'target' },
    { label: 'Carbs', value: totals.carbsG, target: day.carbsG, unit: 'g', kind: 'target' },
    { label: 'Fat', value: totals.fatG, target: day.fatG, unit: 'g', kind: 'target' },
    { label: 'Fibre', value: totals.fibreG, target: day.fibreMinG, unit: 'g', kind: 'min' },
    { label: 'Sugar', value: totals.sugarsG, target: null, unit: 'g', kind: 'target', sub: `${fmt.g(natural)} natural · ${fmt.g(totals.addedSugarG)} added` },
    { label: 'Added sugar', value: totals.addedSugarG, target: day.addedSugarMaxG, unit: 'g', kind: 'max' },
    { label: 'Saturated fat', value: totals.satFatG, target: day.satFatMaxG, unit: 'g', kind: 'max' },
  ]
  if (day.carbsMinG !== null) rows.splice(3, 0, { label: 'Carbs (daily minimum)', value: totals.carbsG, target: day.carbsMinG, unit: 'g', kind: 'min' })
  const n = (v: number, unit: string) => `${Math.round(v).toLocaleString('en-AU')}${unit === 'g' ? ' g' : ` ${unit}`}`
  return (
    <div>
      <table className="tabular w-full text-[13px] sm:text-sm">
        <caption className="sr-only">{caption ?? 'Nutrition for the day'}</caption>
        <thead>
          <tr className="text-left text-xs text-stone-500">
            <th scope="col" className="py-1 font-medium">Nutrient</th>
            <th scope="col" className="py-1 text-right font-medium">Amount</th>
            <th scope="col" className="py-1 text-right font-medium">Target</th>
            <th scope="col" className="py-1 text-right font-medium"><abbr title="Difference" className="no-underline">Diff.</abbr></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => {
            const s = r.target === null ? null : r.kind === 'max' ? limitStatus(r.value, r.target) : r.kind === 'min' ? (r.value >= r.target ? { tone: 'leaf' as Tone, label: 'minimum reached' } : fitStatus(r.value, r.target)) : fitStatus(r.value, r.target)
            const diff = r.target === null ? null : r.value - r.target
            return (
              <tr key={r.label}>
                <th scope="row" className="py-1.5 text-left font-normal text-stone-700">
                  {r.label}
                  {r.sub && <span className="block text-xs text-stone-500">{r.sub}</span>}
                  {s && <span className={cx('block text-xs font-medium', TONE_TEXT[s.tone])}>{s.label}</span>}
                </th>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-medium text-stone-900">{n(r.value, r.unit)}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right text-stone-600">{r.target === null ? '—' : `${r.kind === 'max' ? 'max ' : r.kind === 'min' ? 'min ' : ''}${n(r.target, r.unit)}`}</td>
                <td className={cx('whitespace-nowrap py-1.5 pl-2 text-right', s ? TONE_TEXT[s.tone] : 'text-stone-500')}>{diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${n(Math.abs(diff), r.unit)}`}</td>
              </tr>
            )
          })}
          {costCents !== undefined && (
            <tr>
              <th scope="row" className="py-1.5 text-left font-normal text-stone-700">Food cost</th>
              <td colSpan={3} className="py-1.5 text-right font-medium text-stone-900">
                {costCents ? fmt.money(costCents) : 'not known yet'}
                {!!unpriced && !!costCents && <span className="block text-xs font-normal text-stone-500">+ {unpriced} meal{unpriced === 1 ? '' : 's'} not priced</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

import { motion } from 'motion/react'
import { useId } from 'react'
import type { Nutrients } from '../db/types'
import type { DayTargets } from '../engines/contract'
import { GAUGE_TONE, gaugeStatus, type GaugeStatus } from '../lib/fit'
import { cx } from './ui'

type Kind = 'energy' | 'protein' | 'carbs' | 'fat'

/**
 * Symbols drawn in a 48 x 56 box: a battery for energy, a flexed arm for protein, a grain sack for
 * carbs and a drop for fat. Each fills from the bottom in exact proportion to the target (capped at
 * full); going over is shown with a red outline and the amount over, never by overfilling.
 */
const SHAPES: Record<Kind, { d: string; top: number; bottom: number; extra?: string }> = {
  energy: {
    d: 'M10 10 a5 5 0 0 1 5 -5 h18 a5 5 0 0 1 5 5 v39 a5 5 0 0 1 -5 5 h-18 a5 5 0 0 1 -5 -5 Z M19 1.5 h10 a1.5 1.5 0 0 1 1.5 1.5 v2 h-13 v-2 a1.5 1.5 0 0 1 1.5 -1.5 Z',
    top: 5,
    bottom: 54,
    extra: 'M26 15 L17 31 h7 l-2 12 l9 -16 h-7 Z', // lightning bolt
  },
  protein: {
    // flexed arm: shoulder bottom left, biceps bulging up, forearm rising to a fist at the top right
    d: 'M3 53 C2 45 4 38 10 34 C14 24 26 20 31 27 L31 14 C29 11 30 5 34 4 L42 3 C46 3 47 8 44 10 L41 12 L42 34 C44 45 40 53 31 54 Z',
    top: 3,
    bottom: 54,
  },
  carbs: {
    // tied grain sack
    d: 'M17 13 L13 4 C18 6 21 6 24 4 C27 6 30 6 35 4 L31 13 C40 19 45 31 43 42 C42 51 35 54 24 54 C13 54 6 51 5 42 C3 31 8 19 17 13 Z',
    top: 4,
    bottom: 54,
    extra: 'M16 13 H32', // the tie
  },
  fat: {
    d: 'M24 3 C24 3 7 24 7 36 A17 17 0 0 0 41 36 C41 24 24 3 24 3 Z',
    top: 3,
    bottom: 53,
  },
}

const TONE_TEXT = { leaf: 'text-leaf-700', ember: 'text-ember-600', red: 'text-red-700', stone: 'text-stone-500', sky: 'text-sky-700' }
const STATUS_ICON: Record<GaugeStatus, string> = { low: '↓', 'on track': '→', reached: '✓', over: '↑' }

export function NutrientGauge({ kind, label, value, target, unit, expected = 1, color }: {
  kind: Kind; label: string; value: number; target: number; unit: string; expected?: number; color: string
}) {
  const id = useId()
  const s = SHAPES[kind]
  const frac = target > 0 ? Math.max(0, Math.min(value / target, 1)) : 0
  const status = gaugeStatus(value, target, expected)
  const over = status === 'over'
  const h = s.bottom - s.top
  const y = s.bottom - h * frac
  const pct = target > 0 ? Math.round((value / target) * 100) : 0
  const left = Math.round(target - value)
  const fmtN = (n: number) => Math.round(n).toLocaleString('en-AU')
  return (
    <div className="flex flex-col items-center text-center">
      <svg width={52} height={60} viewBox="0 0 48 56" role="img" aria-label={`${label} ${Math.round(value)} of ${Math.round(target)} ${unit}, ${pct}%, ${status}`} className="overflow-visible">
        <defs>
          <clipPath id={`${id}c`}><path d={s.d} /></clipPath>
        </defs>
        <path d={s.d} style={{ fill: 'var(--color-stone-100)' }} />
        <g clipPath={`url(#${id}c)`}>
          <motion.rect x={0} width={48} height={56} style={{ fill: color }} initial={{ y: s.bottom }} animate={{ y }} transition={{ duration: 0.8, ease: 'easeOut' }} />
        </g>
        <path d={s.d} fill="none" strokeWidth={over ? 2.5 : 1.5} strokeLinejoin="round" style={{ stroke: over ? 'var(--color-red-600)' : 'var(--color-stone-300)' }} />
        {s.extra && <path d={s.extra} fill={kind === 'energy' ? 'var(--color-white)' : 'none'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: kind === 'energy' ? 'var(--color-stone-400)' : 'var(--color-stone-300)' }} opacity={0.9} />}
      </svg>
      <span className="mt-1 text-xs font-semibold text-stone-800">{label}</span>
      <span className="tabular text-sm font-semibold leading-tight text-stone-900">{fmtN(value)}</span>
      <span className="tabular text-[11px] leading-tight text-stone-500">of {fmtN(target)}{unit === 'g' ? ' g' : ` ${unit}`}</span>
      <span className="tabular whitespace-nowrap text-[11px] text-stone-600">{pct}% · {left >= 0 ? `${fmtN(left)} left` : `${fmtN(-left)} over`}</span>
      <span className={cx('text-[11px] font-medium', TONE_TEXT[GAUGE_TONE[status]])}><span aria-hidden>{STATUS_ICON[status]} </span>{status}</span>
    </div>
  )
}

/** Energy, protein, carbs and fat for a day. */
export function NutrientGauges({ totals, day, expected = 1 }: { totals: Nutrients; day: Pick<DayTargets, 'energyKcal' | 'proteinG' | 'carbsG' | 'fatG'>; expected?: number }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      <NutrientGauge kind="energy" label="Energy" value={totals.energyKcal} target={day.energyKcal} unit="kcal" expected={expected} color="var(--nut-energy)" />
      <NutrientGauge kind="protein" label="Protein" value={totals.proteinG} target={day.proteinG.preferred} unit="g" expected={expected} color="var(--nut-protein)" />
      <NutrientGauge kind="carbs" label="Carbs" value={totals.carbsG} target={day.carbsG} unit="g" expected={expected} color="var(--nut-carbs)" />
      <NutrientGauge kind="fat" label="Fat" value={totals.fatG} target={day.fatG} unit="g" expected={expected} color="var(--nut-fat)" />
    </div>
  )
}

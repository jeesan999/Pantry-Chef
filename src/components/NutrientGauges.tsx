import { motion, useReducedMotion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import type { Nutrients } from '../db/types'
import type { DayTargets } from '../engines/contract'
import { GAUGE_TONE, gaugeStatus, type GaugeStatus } from '../lib/fit'
import { cx } from './ui'

type Kind = 'energy' | 'protein' | 'carbs' | 'fat'

/**
 * Food illustrations drawn in a 48 x 48 box: a plate of food for energy, a steak for protein, toast
 * for carbs and an avocado for fat. Fixed food colours, so they read the same in light and dark mode.
 */
const ICONS: Record<Kind, ReactNode> = {
  energy: (
    <g>
      <circle cx="24" cy="24" r="19" fill="#c9d3dc" />
      <circle cx="24" cy="24" r="16.5" fill="#f4f7fa" />
      <circle cx="24" cy="24" r="12" fill="none" stroke="#dde4ea" strokeWidth="1" />
      {/* rice, salmon, greens and a carrot slice */}
      <ellipse cx="19.5" cy="26.5" rx="6.5" ry="4.6" fill="#fbf6e9" stroke="#e7dcc0" strokeWidth="0.8" />
      <ellipse cx="28.5" cy="18.5" rx="5.6" ry="4.4" fill="#f27b6b" />
      <path d="M24.6 17 q3.9 -1.2 7.6 0.4 M24.8 19.6 q3.8 -1 7.4 0.6" stroke="#fde2dc" strokeWidth="1" fill="none" strokeLinecap="round" />
      <ellipse cx="30.5" cy="26.4" rx="3.4" ry="2.4" fill="#2f9e44" transform="rotate(-30 30.5 26.4)" />
      <ellipse cx="27" cy="28.6" rx="2.4" ry="1.7" fill="#40c057" transform="rotate(20 27 28.6)" />
      <circle cx="17" cy="31.8" r="1.9" fill="#f59f00" />
    </g>
  ),
  protein: (
    <g>
      <path d="M8 22 C7 14 17 10 27 10.5 C37 11 42.5 15.5 41.5 24 C40.6 31.5 34 37.5 24 37.5 C13.5 37.5 9 30 8 22 Z" fill="#9c2f3a" />
      <path d="M11 22 C10.4 16 18.5 13 27 13.4 C35.4 13.8 39.3 17.2 38.6 23.6 C38 29.4 32.6 34.5 24 34.5 C15.4 34.5 11.6 28.4 11 22 Z" fill="#d9485a" />
      <path d="M14 20 q5 -4.2 11 -2 q3.5 1.4 7 -0.6 M15 26 q4.5 2.6 9 0.4" stroke="#f3b7bf" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="31" cy="25" r="4.6" fill="#f4e7c8" />
      <circle cx="31" cy="25" r="2" fill="#e2cf9f" />
    </g>
  ),
  carbs: (
    <g>
      <path d="M11 22 C6.5 21 6 12 14 9.5 C18 8.2 21 9.6 24 9.6 C27 9.6 30 8.2 34 9.5 C42 12 41.5 21 37 22 L36 38 C36 40 34.6 41 32.6 41 H15.4 C13.4 41 12 40 12 38 Z" fill="#a8551c" />
      <path d="M14.2 21.4 C11 20.4 11.2 14.6 16 13 C19 12 21.5 13.2 24 13.2 C26.5 13.2 29 12 32 13 C36.8 14.6 37 20.4 33.8 21.4 L33 36.4 C33 37.4 32.2 38 31.2 38 H16.8 C15.8 38 15 37.4 15 36.4 Z" fill="#f6d79a" />
      <g fill="#dcb46a">
        <circle cx="19" cy="20" r="0.9" /><circle cx="27" cy="18" r="0.9" /><circle cx="23" cy="25" r="0.9" />
        <circle cx="29" cy="29" r="0.9" /><circle cx="19.5" cy="31" r="0.9" /><circle cx="25.5" cy="33.5" r="0.9" />
      </g>
    </g>
  ),
  fat: (
    <g>
      <path d="M24 5 C29.5 5 31.5 10.5 33.5 16 C35.8 22 40 25 40 31.5 C40 39.5 32.8 44 24 44 C15.2 44 8 39.5 8 31.5 C8 25 12.2 22 14.5 16 C16.5 10.5 18.5 5 24 5 Z" fill="#3f6212" />
      <path d="M24 8.2 C28 8.2 29.5 12.6 31.2 17.4 C33.4 23.2 36.8 25.8 36.8 31.4 C36.8 37.8 31 41 24 41 C17 41 11.2 37.8 11.2 31.4 C11.2 25.8 14.6 23.2 16.8 17.4 C18.5 12.6 20 8.2 24 8.2 Z" fill="#a3d65c" />
      <path d="M24 11.5 C27 11.5 28.2 15 29.6 19 C31.4 23.8 34 26 34 31 C34 36 29.6 38.4 24 38.4 C18.4 38.4 14 36 14 31 C14 26 16.6 23.8 18.4 19 C19.8 15 21 11.5 24 11.5 Z" fill="#e3f2a6" />
      <circle cx="24" cy="30" r="6.6" fill="#7c3f12" />
      <circle cx="22" cy="27.8" r="1.8" fill="#a5612b" />
    </g>
  ),
}

/** A wavy liquid surface at y = 0, from x = -24 to 72: covers the 48-wide tile while sliding one wavelength (12). */
const WAVE = `M-24 0 ${Array.from({ length: 15 }, (_, i) => `q3 ${i % 2 ? 1.6 : -1.6} 6 0`).join(' ')} q3 -1.6 6 0 V60 H-24 Z`

const TONE_TEXT = { leaf: 'text-leaf-700', ember: 'text-ember-600', red: 'text-red-700', stone: 'text-stone-500', sky: 'text-sky-700' }
const STATUS_ICON: Record<GaugeStatus, string> = { low: '↓', 'on track': '→', reached: '✓', over: '↑' }

export function NutrientGauge({ kind, label, value, target, unit, expected = 1, color }: {
  kind: Kind; label: string; value: number; target: number; unit: string; expected?: number; color: string
}) {
  const id = useId()
  const frac = target > 0 ? Math.max(0, Math.min(value / target, 1)) : 0
  const status = gaugeStatus(value, target, expected)
  const over = status === 'over'
  // the liquid's level in the tile; empty and full push the wave just past the edge so no sliver shows
  const y = frac <= 0 ? 51 : frac >= 1 ? -3 : 48 - 48 * frac
  const still = useReducedMotion()
  const pct = target > 0 ? Math.round((value / target) * 100) : 0
  const left = Math.round(target - value)
  const fmtN = (n: number) => Math.round(n).toLocaleString('en-AU')
  return (
    <div className="flex flex-col items-center text-center">
      <svg width={56} height={56} viewBox="0 0 48 48" role="img" aria-label={`${label} ${Math.round(value)} of ${Math.round(target)} ${unit}, ${pct}%, ${status}`}>
        <defs>
          <clipPath id={`${id}c`}><rect width="48" height="48" rx="12" /></clipPath>
        </defs>
        {/* tinted tile; the liquid rises in it as the day's total grows */}
        <rect width="48" height="48" rx="12" style={{ fill: `color-mix(in srgb, ${color} 14%, var(--color-white))` }} />
        <g clipPath={`url(#${id}c)`}>
          <motion.g initial={{ y: 51 }} animate={{ y }} transition={{ duration: 0.8, ease: 'easeOut' }}>
            <g transform="translate(0 -1)">
              <motion.path d={WAVE} style={{ fill: color }} opacity={0.18} initial={{ x: -12 }} animate={still ? { x: -12 } : { x: [-12, 0] }} transition={{ duration: 3.2, ease: 'linear', repeat: still ? 0 : Infinity }} />
            </g>
            <g transform="translate(0 0.8)">
              <motion.path d={WAVE} style={{ fill: color }} opacity={0.32} initial={{ x: 0 }} animate={still ? { x: 0 } : { x: [0, -12] }} transition={{ duration: 2.4, ease: 'linear', repeat: still ? 0 : Infinity }} />
            </g>
          </motion.g>
        </g>
        <g transform="translate(7 7) scale(0.708)">{ICONS[kind]}</g>
        {over && <rect x="1" y="1" width="46" height="46" rx="11" fill="none" strokeWidth={2} style={{ stroke: 'var(--color-red-600)' }} />}
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

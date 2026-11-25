import { motion, useReducedMotion } from 'motion/react'
import { useId } from 'react'
import type { Nutrients } from '../db/types'
import type { DayTargets } from '../engines/contract'
import { GAUGE_TONE, gaugeStatus, type GaugeStatus } from '../lib/fit'
import { cx } from './ui'

type Kind = 'energy' | 'protein' | 'carbs' | 'fat'

type Pt = [number, number]
type Seg = { p: Pt } | { c1: Pt; c2: Pt; p: Pt }

/** A left-right symmetric outline from its right half (top centre, clockwise, ending at bottom centre). */
function mirrored(start: Pt, right: Seg[]): string {
  const f = (n: number) => +n.toFixed(2)
  const pt = ([x, y]: Pt) => `${f(x)} ${f(y)}`
  const mx = ([x, y]: Pt): Pt => [48 - x, y]
  let d = `M${pt(start)}`
  for (const s of right) d += 'c1' in s ? ` C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}` : ` L${pt(s.p)}`
  // the left half: the same segments mirrored, walked back up to the start
  const from = [start, ...right.map((s) => s.p)]
  for (let i = right.length - 1; i >= 0; i--) {
    const s = right[i]
    d += 'c1' in s ? ` C${pt(mx(s.c2))} ${pt(mx(s.c1))} ${pt(mx(from[i]))}` : ` L${pt(mx(from[i]))}`
  }
  return `${d} Z`
}

/** Bodybuilder in a front double-biceps pose: fists up beside the head, V-shaped torso, legs apart. */
const BODYBUILDER =
  'M19.4 6.1 a4.6 4.6 0 1 0 9.2 0 a4.6 4.6 0 1 0 -9.2 0 Z ' +
  mirrored([24, 11], [
    { p: [26.2, 11] },
    { p: [26.6, 12.4] },
    { c1: [28.2, 12.8], c2: [30, 12.8], p: [31.2, 13.6] }, // trapezius
    { c1: [32.4, 9.6], c2: [37, 7.4], p: [39.2, 10.2] }, // biceps peak
    { p: [39.2, 5.4] }, // inside of the forearm
    { c1: [39, 2.4], c2: [41, 1], p: [43, 1.4] }, // fist
    { c1: [45.2, 1.9], c2: [46.2, 3.8], p: [45.8, 6.2] },
    { p: [46.2, 14.2] }, // outside of the forearm
    { c1: [46.6, 18.2], c2: [44.2, 20.2], p: [41.2, 19.6] }, // elbow
    { c1: [39.2, 19.6], c2: [37.2, 21], p: [35.2, 21.2] }, // under the upper arm to the armpit
    { c1: [35.2, 27], c2: [32.2, 31], p: [30.2, 35] }, // lats tapering to the waist
    { p: [30.4, 37.4] },
    { c1: [32.4, 43], c2: [31.6, 49.6], p: [30.6, 54.2] }, // outer thigh and calf
    { p: [27, 54.6] }, // foot
    { c1: [26.6, 49.6], c2: [26.4, 44], p: [24, 40.6] }, // inner leg
  ])

/**
 * Symbols drawn in a 48 x 56 box: a bodybuilder for energy, a steak for protein, a bowl of rice for
 * carbs and a block of butter for fat. Each fills from the bottom like a liquid, in exact proportion
 * to the target (capped at full); going over is shown with a red outline and the amount over, never
 * by overfilling. `details` are drawn faintly on top (muscle lines, marbling, rice grains, edges).
 */
const SHAPES: Record<Kind, { d: string; top: number; bottom: number; details?: string }> = {
  energy: {
    d: BODYBUILDER,
    top: 1.4,
    bottom: 54.6,
    details: 'M19 21.5 Q24 24.5 29 21.5 M24 24 V35 M21 28.5 H27 M21.5 32 H26.5',
  },
  protein: {
    // a large steak: a rounded, slightly uneven cut with its fat rim and a round marrow bone
    d: 'M8 21 C6 13 16 8.5 26 9.5 C36 10.5 44.5 14 44 24 C43.6 31.5 40.5 35.5 38.5 39.5 C36.2 44.5 30 47.5 22 46.5 C12 45.5 4.5 40.5 4.5 32 C4.5 27.5 9 25.5 8 21 Z',
    top: 9.5,
    bottom: 47.5,
    details: 'M11.5 21.5 C10.5 16 18 13 26 13.6 C34 14.2 40.5 17.5 40.4 24 C40 30.5 37 34 35.2 37.6 M26.5 27 a4.6 4.6 0 1 0 9.2 0 a4.6 4.6 0 1 0 -9.2 0 M29.3 27 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0',
  },
  carbs: {
    // a mound of rice in a round bowl on a foot
    d: 'M4 30 H7 C7 22 13 14 24 14 C35 14 41 22 41 30 H44 C44 41 36 48 28 49 V52 H20 V49 C12 48 4 41 4 30 Z',
    top: 14,
    bottom: 52,
    details: 'M4 30 H44 M15.5 23 l2.2 -1 M21.5 18.6 l2.2 0.8 M28 21.4 l2.2 -1 M19.6 26.2 h2.4 M31 26.4 l2.2 0.8 M25 24.2 l1.8 -1.2 M34.5 22 l1.4 1.4',
  },
  fat: {
    // a block of butter seen from above and to the side: top, front and end faces
    d: 'M5 22 L19 14 L44 18.5 L44 36 L30.5 46 L5 40 Z',
    top: 14,
    bottom: 46,
    details: 'M5 22 L30.5 28 L44 18.5 M30.5 28 V46 M9 23 L30.5 28.2',
  },
}

/** A wavy liquid surface at y = 0, from x = -24 to 72: covers the 48-wide box while sliding one wavelength (12). */
const WAVE = `M-24 0 ${Array.from({ length: 15 }, (_, i) => `q3 ${i % 2 ? 1.6 : -1.6} 6 0`).join(' ')} q3 -1.6 6 0 V60 H-24 Z`

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
  // the liquid's level; empty and full push the wave just past the shape so no sliver shows
  const y = frac <= 0 ? s.bottom + 3 : frac >= 1 ? s.top - 3 : s.bottom - h * frac
  const still = useReducedMotion()
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
          <motion.g initial={{ y: s.bottom + 3 }} animate={{ y }} transition={{ duration: 0.8, ease: 'easeOut' }}>
            {/* back wave, lighter and moving the other way, then the front wave */}
            <g transform="translate(0 -1)">
              <motion.path d={WAVE} style={{ fill: color }} opacity={0.4} initial={{ x: -12 }} animate={still ? { x: -12 } : { x: [-12, 0] }} transition={{ duration: 3.2, ease: 'linear', repeat: still ? 0 : Infinity }} />
            </g>
            <g transform="translate(0 0.8)">
              <motion.path d={WAVE} style={{ fill: color }} initial={{ x: 0 }} animate={still ? { x: 0 } : { x: [0, -12] }} transition={{ duration: 2.4, ease: 'linear', repeat: still ? 0 : Infinity }} />
            </g>
          </motion.g>
        </g>
        {s.details && <path d={s.details} fill="none" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--color-stone-400)' }} opacity={0.75} />}
        <path d={s.d} fill="none" strokeWidth={over ? 2.5 : 1.5} strokeLinejoin="round" style={{ stroke: over ? 'var(--color-red-600)' : 'var(--color-stone-300)' }} />
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

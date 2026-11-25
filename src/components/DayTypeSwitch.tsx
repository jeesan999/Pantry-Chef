import { useState } from 'react'
import { repo } from '../db/instance'
import type { DayType } from '../engines/contract'
import { clearDayChoice, setDayType, type DayChoice } from '../lib/schedule'
import { cx } from './ui'

/** Two-way switch: make a date a training day or a rest day. */
export function DayTypeSwitch({ choice, compact }: { choice: DayChoice; compact?: boolean }) {
  const [error, setError] = useState<string>()
  const pick = async (t: DayType) => {
    setError(undefined)
    try {
      if (t !== choice.dayType) await setDayType(repo, choice.date, t)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const btn = (t: DayType, label: string) => {
    const on = choice.dayType === t
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => pick(t)}
        className={cx(
          'min-h-9 rounded-full px-3 text-xs font-medium transition',
          on ? (t === 'training' ? 'bg-ember-500 text-on-accent' : 'bg-leaf-700 text-on-accent') : 'text-stone-600',
        )}
      >
        {label}
      </button>
    )
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 p-0.5" role="group" aria-label="Day type">
        {btn('training', choice.dayType === 'training' && choice.workout && !compact ? `Training ${choice.workout.start}` : 'Training')}
        {btn('rest', 'Rest')}
      </span>
      {choice.source === 'chosen' && !compact && (
        <button type="button" className="text-[11px] text-stone-500 underline" onClick={() => clearDayChoice(repo, choice.date)}>
          use my usual week
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}

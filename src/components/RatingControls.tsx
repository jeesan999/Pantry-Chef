import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/instance'
import type { RatingFlag } from '../db/types'
import { FLAG_LABEL, getRating, rate } from '../lib/ratings'
import { Card, cx } from './ui'

const FLAGS: RatingFlag[] = ['favourite', 'cook_again', 'do_not_recommend', 'too_expensive', 'too_slow', 'too_repetitive']

/** Stars and flags for a recipe. The planner and Chef use them: "Don’t suggest" hides it from both. */
export function RatingControls({ recipeId }: { recipeId: string }) {
  const r = useLiveQuery(() => getRating(repo, recipeId), [recipeId])
  const flags = new Set(r?.flags ?? [])
  return (
    <Card title="Your rating">
      <div role="radiogroup" aria-label="Stars" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={r?.stars === s}
            aria-label={`${s} star${s === 1 ? '' : 's'}`}
            onClick={() => rate(repo, recipeId, { stars: r?.stars === s ? null : (s as 1 | 2 | 3 | 4 | 5) })}
            className={cx('flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none transition', (r?.stars ?? 0) >= s ? 'text-ember-500' : 'text-stone-300 hover:text-stone-400')}
          >
            ★
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {FLAGS.map((f) => {
          const on = flags.has(f)
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => rate(repo, recipeId, on ? { off: [f] } : { on: [f] })}
              className={cx(
                'min-h-9 rounded-full border px-3 text-sm transition',
                on ? (f === 'do_not_recommend' ? 'border-red-300 bg-red-50 text-red-800' : 'border-leaf-300 bg-leaf-100 text-leaf-800') : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
              )}
            >
              {on ? '✓ ' : ''}{FLAG_LABEL[f]}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-stone-500">The meal planner and Chef use these. “Don’t suggest” keeps it out of plans and swaps.</p>
    </Card>
  )
}

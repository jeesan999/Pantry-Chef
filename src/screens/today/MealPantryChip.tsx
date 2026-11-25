import { useLiveQuery } from 'dexie-react-hooks'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { PantryCheckSheet } from '../../components/PantryCheck'
import { cx } from '../../components/ui'
import { repo } from '../../db/instance'
import type { PlannedMeal } from '../../db/types'
import { mealAvailability } from '../../lib/meals'

/** "All in pantry" / "2 to buy" for a planned meal; opens the full ingredient check. */
export function MealPantryChip({ recipeId, recipeName, portionScale, date, planned }: { recipeId: string; recipeName: string; portionScale: number; date: string; planned?: PlannedMeal }) {
  const [open, setOpen] = useState(false)
  const a = useLiveQuery(() => mealAvailability(repo, { recipeId, portionScale, date, substitutions: planned?.substitutions }), [recipeId, portionScale, date, JSON.stringify(planned?.substitutions ?? {})])
  if (!a) return null
  const toBuy = a.missing + a.partial
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Pantry check for ${recipeName}`}
        className={cx('inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition', a.allAvailable ? 'bg-leaf-50 text-leaf-700 hover:bg-leaf-100' : 'bg-orange-50 text-orange-900 hover:bg-orange-100')}>
        {a.allAvailable ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden />}
        {a.allAvailable ? 'All in pantry' : `${toBuy} to buy`}
      </button>
      {open && <PantryCheckSheet title={recipeName} recipeId={recipeId} portionScale={portionScale} date={date} plannedMealId={planned?.id} onClose={() => setOpen(false)} />}
    </>
  )
}

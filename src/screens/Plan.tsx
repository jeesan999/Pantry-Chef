import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DayTypeSwitch } from '../components/DayTypeSwitch'
import { Badge, Button, Card, ComingInPhase, Page, fmt } from '../components/ui'
import { db, today } from '../db/instance'
import { SLOTS } from '../engines/contract'
import { addDays } from '../engines/nutrition/engine'
import { SLOT_LABEL, targetsForDate, weekDates } from '../lib/day'
import { useApprovedTargets, useDayChoices } from '../lib/hooks'

export default function PlanScreen() {
  const now = today()
  const [offset, setOffset] = useState(0)
  const dates = weekDates(addDays(now, offset * 7))
  const approved = useApprovedTargets()
  const choices = useDayChoices(dates)
  const planned = useLiveQuery(() => db.planned_meals.where('date').between(dates[0], dates[6], true, true).toArray(), [dates[0]])
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const rname = new Map((recipes ?? []).map((r) => [r.id, r.name]))
  const nTrain = choices?.filter((c) => c.dayType === 'training').length

  return (
    <Page
      title={offset === 0 ? 'This week' : offset === 1 ? 'Next week' : 'Week'}
      subtitle={`${fmt.date(dates[0])} – ${fmt.date(dates[6])}${nTrain === undefined ? '' : ` · ${nTrain} training, ${7 - nTrain} rest`}`}
      action={
        <div className="flex gap-1">
          <Button variant="secondary" aria-label="Previous week" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}>‹</Button>
          <Button variant="secondary" aria-label="Next week" onClick={() => setOffset(offset + 1)}>›</Button>
        </div>
      }
    >
      <p className="px-1 text-sm text-stone-600">Set each day to training or rest. Your targets follow the day type you choose; nothing needs re-approving.</p>
      {!approved && (
        <Card><Link to="/goals"><Button>Review targets first</Button></Link></Card>
      )}
      {choices?.map((c) => {
        const d = c.date
        const t = approved ? targetsForDate(approved.targetSet, c) : null
        const meals = (planned ?? []).filter((p) => p.date === d)
        return (
          <Card key={d} className={d === now ? 'ring-2 ring-leaf-200' : ''}
            title={<span className="flex items-center gap-2">{fmt.date(d)} {d === now && <Badge tone="leaf">today</Badge>}</span>}
            action={<DayTypeSwitch choice={c} compact />}>
            {t && (
              <>
                <p className="tabular text-sm text-stone-600">
                  {fmt.kcal(t.energyKcal)} · {t.proteinG.preferred} g protein · {t.carbsG} g carbs · {t.fatG} g fat
                  {t.workout && <> · training {t.workout.start}</>}
                </p>
                <ul className="mt-2 text-sm">
                  {SLOTS.map((s) => {
                    const m = meals.find((x) => x.slot === s)
                    const name = s === 'breakfast' ? 'Fixed breakfast' : m ? rname.get(m.recipeId) : undefined
                    return (
                      <li key={s} className="flex justify-between gap-2 py-0.5">
                        <span className="shrink-0 text-stone-500">{SLOT_LABEL[s]} {t.slots[s].time}</span>
                        <span className={name ? 'truncate text-stone-800' : 'text-stone-400'}>{name ?? '—'}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Card>
        )
      })}
      <Card>
        <Link to="/shopping" className="flex min-h-11 items-center justify-between font-medium text-leaf-700">
          Shopping list for these meals <span aria-hidden>›</span>
        </Link>
      </Card>
      <ComingInPhase phase={8} what="The automatic seven-day planner: it picks meals for every slot to fit your targets, uses food near expiry first, and costs the week. For now, choose meals on the Today screen." />
    </Page>
  )
}

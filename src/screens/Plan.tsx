import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, ComingInPhase, Page, fmt } from '../components/ui'
import { db, today } from '../db/instance'
import { SLOTS } from '../engines/contract'
import { SLOT_LABEL, dayTargetsFor, weekDates } from '../lib/day'
import { useApprovedTargets } from '../lib/hooks'

export default function PlanScreen() {
  const now = today()
  const dates = weekDates(now)
  const approved = useApprovedTargets()
  const planned = useLiveQuery(() => db.planned_meals.where('date').between(dates[0], dates[6], true, true).toArray(), [dates[0]])
  const recipes = useLiveQuery(() => db.recipes.toArray())
  const rname = new Map((recipes ?? []).map((r) => [r.id, r.name]))

  return (
    <Page title="This week" subtitle={`${fmt.date(dates[0])} – ${fmt.date(dates[6])}`}>
      <ComingInPhase phase={5} what="The automatic seven-day planner: it picks meals for every slot to fit your targets, uses food near expiry first, builds the shopping list and costs the week.">
        <p className="mt-1 text-sm text-stone-600">For now, choose meals for each slot on the Today screen.</p>
      </ComingInPhase>
      {!approved ? (
        <Card><Link to="/goals"><Button>Review targets first</Button></Link></Card>
      ) : (
        dates.map((d) => {
          const t = dayTargetsFor(approved.targetSet, d)
          const meals = (planned ?? []).filter((p) => p.date === d)
          return (
            <Card key={d} className={d === now ? 'ring-2 ring-leaf-200' : ''}
              title={<span className="flex items-center gap-2">{fmt.date(d)} {d === now && <Badge tone="leaf">today</Badge>}</span>}
              action={<Badge tone={t.dayType === 'training' ? 'ember' : 'stone'}>{t.dayType === 'training' ? `Training ${t.workout?.start}` : 'Rest'}</Badge>}>
              <p className="tabular text-sm text-stone-600">{fmt.kcal(t.energyKcal)} · {t.proteinG.preferred} g protein · {t.carbsG} g carbs · {t.fatG} g fat</p>
              <ul className="mt-2 text-sm">
                {SLOTS.map((s) => {
                  const m = meals.find((x) => x.slot === s)
                  const name = s === 'breakfast' ? 'Fixed breakfast' : m ? rname.get(m.recipeId) : undefined
                  return (
                    <li key={s} className="flex justify-between gap-2 py-0.5">
                      <span className="text-stone-500">{SLOT_LABEL[s]} {t.slots[s].time}</span>
                      <span className={name ? 'truncate text-stone-800' : 'text-stone-400'}>{name ?? '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )
        })
      )}
    </Page>
  )
}

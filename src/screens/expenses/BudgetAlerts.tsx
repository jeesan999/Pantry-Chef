import { Link } from 'react-router-dom'
import { Notice, fmt } from '../../components/ui'
import type { BudgetStatus } from '../../engines/cost/engine'

/** Warning banners for budgets at or past their alert level. Also shown on Today. */
export function BudgetAlerts({ statuses, link }: { statuses?: Array<{ period: 'week' | 'month'; status: BudgetStatus }>; link?: boolean }) {
  const alerts = (statuses ?? []).filter((s) => s.status.level !== 'ok')
  if (!alerts.length) return null
  return (
    <>
      {alerts.map(({ period, status }) => (
        <Notice key={period} tone={status.level === 'over' ? 'red' : 'ember'}>
          <span aria-hidden>{status.level === 'over' ? '⚠ ' : '● '}</span>
          {status.level === 'over'
            ? `Over this ${period}'s budget by ${fmt.money(-status.remainingCents)} (${fmt.money(status.spentCents)} of ${fmt.money(status.limitCents)}).`
            : `${Math.round(status.pct)}% of this ${period}'s budget spent: ${fmt.money(status.remainingCents)} left.`}
          {link && <> <Link to="/expenses" className="font-medium underline">See expenses</Link></>}
        </Notice>
      ))}
    </>
  )
}

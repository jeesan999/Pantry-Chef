import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}

export function Page({ title, subtitle, action, children }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-leaf-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-stone-200 bg-white p-4 shadow-sm', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-stone-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-leaf-700 text-white hover:bg-leaf-600 active:bg-leaf-900',
    secondary: 'bg-leaf-50 text-leaf-700 border border-leaf-200 hover:bg-leaf-100',
    ghost: 'text-leaf-700 hover:bg-leaf-50',
    danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  }
  return (
    <button
      {...p}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-medium transition disabled:opacity-40',
        styles[variant],
        className,
      )}
    />
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

const inputCls = 'block w-full min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-ink focus:border-leaf-500 focus:outline-none focus:ring-2 focus:ring-leaf-200'

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, p.className)} />
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, p.className)} />
}

export function Badge({ tone = 'stone', children }: { tone?: 'stone' | 'leaf' | 'ember' | 'red' | 'blue'; children: ReactNode }) {
  const t = {
    stone: 'bg-stone-100 text-stone-700',
    leaf: 'bg-leaf-100 text-leaf-700',
    ember: 'bg-orange-100 text-ember-600',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-sky-100 text-sky-700',
  }[tone]
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>
}

export function Notice({ tone = 'ember', children }: { tone?: 'ember' | 'leaf' | 'red' | 'stone'; children: ReactNode }) {
  const t = {
    ember: 'border-orange-200 bg-orange-50 text-orange-900',
    leaf: 'border-leaf-200 bg-leaf-50 text-leaf-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    stone: 'border-stone-200 bg-stone-100 text-stone-800',
  }[tone]
  return <div className={cx('rounded-xl border px-3 py-2.5 text-sm', t)}>{children}</div>
}

/** Circular gauge: value against target, with an animated arc. */
export function Ring({ value, target, label, unit, color = '#2e7445', size = 76, max }: {
  value: number; target: number; label: string; unit: string; color?: string; size?: number; max?: boolean
}) {
  const r = size / 2 - 7
  const c = 2 * Math.PI * r
  const frac = target > 0 ? Math.min(value / target, 1) : 0
  const over = max && value > target
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${Math.round(value)} of ${Math.round(target)} ${unit}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={7} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={over ? '#dc2626' : color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="tabular fill-stone-900 text-[15px] font-semibold">
          {Math.round(value)}
        </text>
        <text x="50%" y="66%" textAnchor="middle" className="fill-stone-500 text-[9px]">
          / {Math.round(target)} {unit}
        </text>
      </svg>
      <span className="text-xs font-medium text-stone-600">{label}</span>
    </div>
  )
}

/** Horizontal bar for a value inside a [low, high] range. */
export function RangeBar({ value, low, high, unit }: { value: number; low: number; high: number; unit: string }) {
  const top = Math.max(high * 1.3, value * 1.05, 1)
  const inRange = value >= low && value <= high
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="relative h-2 flex-1 rounded-full bg-stone-100">
        <div className="absolute h-2 rounded-full bg-leaf-100" style={{ left: `${(low / top) * 100}%`, width: `${((high - low) / top) * 100}%` }} />
        <div className={cx('absolute -top-0.5 h-3 w-1 rounded', inRange ? 'bg-leaf-600' : 'bg-ember-500')} style={{ left: `calc(${Math.min(value / top, 1) * 100}% - 2px)` }} />
      </div>
      <span className="tabular w-28 whitespace-nowrap text-right text-stone-600">
        {Math.round(value)} <span className="text-stone-400">({low === high ? low : `${low}–${high}`} {unit})</span>
      </span>
    </div>
  )
}

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:inset-x-auto sm:left-1/2 sm:w-[32rem] sm:-translate-x-1/2"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-stone-200" />
          <Dialog.Title className="mb-4 text-lg font-semibold text-leaf-900">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A screen whose full function arrives in a later phase: says which, and what already works. */
export function ComingInPhase({ phase, what, children }: { phase: number; what: string; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-leaf-50 text-sm font-semibold text-leaf-700">P{phase}</div>
        <div>
          <p className="font-medium text-stone-800">Arrives in Phase {phase}</p>
          <p className="mt-0.5 text-sm text-stone-600">{what}</p>
          {children}
        </div>
      </div>
    </Card>
  )
}

export function LinkRow({ to, title, detail, right }: { to: string; title: ReactNode; detail?: ReactNode; right?: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-14 items-center justify-between gap-3 border-b border-stone-100 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="truncate font-medium text-stone-800">{title}</div>
        {detail && <div className="truncate text-sm text-stone-500">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-stone-400">
        {right}
        <span aria-hidden>›</span>
      </div>
    </Link>
  )
}

export const fmt = {
  kcal: (n: number) => `${Math.round(n).toLocaleString('en-AU')} kcal`,
  g: (n: number) => `${n < 10 ? Math.round(n * 10) / 10 : Math.round(n)} g`,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  date: (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
}

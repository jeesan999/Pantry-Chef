import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Card, cx } from '../../components/ui'
import { saveAppearance } from '../../theme/save'
import { useAppearance } from '../../theme/appearance'
import { THEMES, derivedVars, type ModePref, type ThemeDef } from '../../theme/themes'

const MODES: Array<[ModePref, string, typeof Sun]> = [['light', 'Light', Sun], ['dark', 'Night', Moon], ['system', 'System', Monitor]]

export function AppearanceCard() {
  const a = useAppearance()
  return (
    <Card title="Appearance" icon={Palette}>
      <div role="radiogroup" aria-label="Light or night mode" className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
        {MODES.map(([m, label, Icon]) => (
          <button key={m} type="button" role="radio" aria-checked={a.mode === m} onClick={() => saveAppearance({ theme: a.theme, mode: m })}
            className={cx('flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition', a.mode === m ? 'bg-white text-leaf-700 shadow-card' : 'text-stone-600 hover:text-stone-900')}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </button>
        ))}
      </div>
      {a.mode === 'system' && <p className="mt-2 text-xs text-stone-500">Follows your phone: now {a.resolved === 'dark' ? 'night' : 'light'}.</p>}

      <p className="mb-2 mt-4 text-sm font-medium text-stone-700">Colour theme</p>
      <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => (
          <ThemeTile key={t.id} t={t} mode={a.resolved} selected={a.theme === t.id} onPick={() => saveAppearance({ theme: t.id, mode: a.mode })} />
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-500">Each tile is a live preview in {a.resolved === 'dark' ? 'night' : 'light'} mode. Your choice is saved on this phone and in your backups.</p>
    </Card>
  )
}

/** A miniature of the app drawn in the theme's own colours (the variables are set on the tile itself). */
function ThemeTile({ t, mode, selected, onPick }: { t: ThemeDef; mode: 'light' | 'dark'; selected: boolean; onPick: () => void }) {
  const vars = derivedVars(t, mode) as unknown as CSSProperties
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${t.name} theme: ${t.blurb}`} onClick={onPick}
      className={cx('group overflow-hidden rounded-2xl border-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500', selected ? 'border-leaf-600' : 'border-stone-200 hover:border-stone-300')}>
      <div style={vars} className="bg-stone-50 p-2.5">
        <div className="rounded-lg border border-stone-200 bg-white p-2 shadow-card">
          <div className="flex items-center justify-between">
            <span className="h-1.5 w-10 rounded-full bg-stone-800" />
            <span className="rounded-full bg-leaf-100 px-1.5 text-[9px] font-semibold text-leaf-800">P 42g</span>
          </div>
          <span className="mt-1.5 block h-1 w-16 rounded-full bg-stone-300" />
          <div className="mt-2 flex items-end gap-1">
            {[40, 70, 55, 90].map((h, i) => <span key={i} className="w-2 rounded-t-sm bg-leaf-600" style={{ height: `${h / 5}px` }} />)}
            <span className="ml-1 h-3 w-3 rounded-full bg-ember-500" />
          </div>
          <span className="mt-2 flex h-4 items-center justify-center rounded-md bg-leaf-700 text-[8px] font-semibold text-on-accent">Accept plan</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 bg-white px-2.5 py-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-stone-800">{t.name}</span>
          <span className="block truncate text-[11px] text-stone-500">{t.blurb}</span>
        </span>
        {selected && <Check className="h-4 w-4 shrink-0 text-leaf-700" aria-hidden />}
      </div>
    </button>
  )
}

/** One-tap light/night switch for the navigation. */
export function ModeToggle({ className }: { className?: string }) {
  const a = useAppearance()
  const dark = a.resolved === 'dark'
  return (
    <button type="button" onClick={() => saveAppearance({ theme: a.theme, mode: dark ? 'light' : 'dark' })} aria-label={dark ? 'Switch to light mode' : 'Switch to night mode'}
      className={cx('inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900', className)}>
      {dark ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
      {dark ? 'Light mode' : 'Night mode'}
    </button>
  )
}

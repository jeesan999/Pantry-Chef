/**
 * Applying and remembering the appearance (colour theme + light/night/system mode).
 * The choice is saved in Settings (backed up with your data) and mirrored to localStorage, which
 * public/theme-init.js reads before the first paint so the app opens in the right colours.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME, derivedVars, themeById, type Mode, type ModePref, type ThemeId } from './themes'

export interface Appearance { theme: ThemeId; mode: ModePref }
export const DEFAULT_APPEARANCE: Appearance = { theme: DEFAULT_THEME, mode: 'system' }
export const STORAGE_KEY = 'chef-appearance'

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
export const resolveMode = (pref: ModePref): Mode => (pref === 'system' ? (media()?.matches ? 'dark' : 'light') : pref)

let current: Appearance = DEFAULT_APPEARANCE
const listeners = new Set<() => void>()
let snapshot = { ...current, resolved: resolveMode(current.mode) }

function readStored(): Appearance | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return s?.theme ? { theme: themeById(s.theme).id, mode: s.mode === 'light' || s.mode === 'dark' ? s.mode : 'system' } : null
  } catch {
    return null
  }
}

/** Put a theme on the page (or on one element, for previews). */
export function applyVars(el: HTMLElement, theme: ThemeId, mode: Mode) {
  const vars = derivedVars(themeById(theme), mode)
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
  return vars
}

export function applyAppearance(a: Appearance) {
  current = { theme: themeById(a.theme).id, mode: a.mode }
  const mode = resolveMode(current.mode)
  const root = document.documentElement
  const vars = applyVars(root, current.theme, mode)
  root.dataset.theme = current.theme
  root.dataset.mode = mode
  root.style.colorScheme = mode // native controls (date pickers, scrollbars) follow
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--color-stone-50'])
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, resolved: mode, vars }))
  } catch {
    // private mode: the choice still applies now and lives in Settings
  }
  snapshot = { ...current, resolved: mode }
  for (const l of listeners) l()
}

/** At start-up: the remembered appearance, then follow the system when set to "system". */
export function initAppearance() {
  applyAppearance(readStored() ?? DEFAULT_APPEARANCE)
  media()?.addEventListener?.('change', () => {
    if (current.mode === 'system') applyAppearance(current)
  })
}

/** Settings is the source of truth (it's backed up and restored); use it when it differs. */
export function syncFromSettings(a?: Partial<Appearance>) {
  if (!a?.theme) return
  if (a.theme !== current.theme || (a.mode ?? 'system') !== current.mode) applyAppearance({ theme: a.theme as ThemeId, mode: a.mode ?? 'system' })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Current appearance; re-renders when it changes. */
export function useAppearance() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

/** A theme colour as a plain value (for chart libraries that draw with attributes, not CSS). */
export function useThemeColors<K extends string>(names: readonly K[]): Record<K, string> {
  const a = useAppearance()
  const vars = derivedVars(themeById(a.theme), a.resolved)
  return Object.fromEntries(names.map((n) => [n, vars[n] ?? ''])) as Record<K, string>
}

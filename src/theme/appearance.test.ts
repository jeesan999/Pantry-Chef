import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, applyAppearance, initAppearance, resolveMode, syncFromSettings } from './appearance'
import { themeById } from './themes'

let systemDark = false
const listeners: Array<() => void> = []
beforeEach(() => {
  localStorage.clear()
  systemDark = false
  listeners.length = 0
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') && systemDark, addEventListener: (_: string, l: () => void) => listeners.push(l) }))
})
const root = () => document.documentElement
const v = (k: string) => root().style.getPropertyValue(k)

describe('appearance', () => {
  it('applies a theme and mode to the page and remembers it', () => {
    applyAppearance({ theme: 'midnight', mode: 'dark' })
    expect(root().dataset).toMatchObject({ theme: 'midnight', mode: 'dark' })
    expect(v('--color-white')).toBe(themeById('midnight').dark['--color-white'])
    expect(root().style.colorScheme).toBe('dark')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toMatchObject({ theme: 'midnight', mode: 'dark', resolved: 'dark' })
    expect(stored.vars['--color-leaf-700']).toBe(themeById('midnight').dark['--color-leaf-700'])
  })

  it('system mode follows the device, including changes while open', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'ocean', mode: 'system' }))
    initAppearance()
    expect(root().dataset.mode).toBe('light')
    systemDark = true
    listeners.forEach((l) => l())
    expect(root().dataset.mode).toBe('dark')
    expect(v('--color-white')).toBe(themeById('ocean').dark['--color-white'])
    expect(resolveMode('light')).toBe('light')
  })

  it('unknown or missing values fall back safely; Settings wins when it differs', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    initAppearance()
    expect(root().dataset.theme).toBe('fresh')
    syncFromSettings({ theme: 'sage', mode: 'light' })
    expect(root().dataset).toMatchObject({ theme: 'sage', mode: 'light' })
    applyAppearance({ theme: 'nope' as never, mode: 'light' })
    expect(root().dataset.theme).toBe('fresh')
  })
})

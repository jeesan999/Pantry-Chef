/**
 * Colour themes. Every colour class in the app reads a CSS variable (Tailwind v4: bg-stone-50 ->
 * var(--color-stone-50)), so a theme is a set of variable values. Semantic roles of the scales:
 *   white          card surface          stone-50   page background     stone-100  subtle fill
 *   stone-200/300  borders               stone-400  faint text          stone-500/600 secondary text
 *   stone-700..900 body text, headings   ink        default text
 *   leaf-*         accent (buttons, links, highlights)   ember-*  warm highlight (training, warnings)
 *   red-* orange-* sky-*  status colours                on-accent text on filled accent buttons
 * Night variants keep the same roles with inverted lightness, so every screen stays readable.
 */
export type ThemeId = 'fresh' | 'slate' | 'sage' | 'ocean' | 'midnight'
export type Mode = 'light' | 'dark'
export type ModePref = Mode | 'system'
export type Vars = Record<string, string>

type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>
const stone = (s: Scale, prefix = 'stone') => Object.fromEntries(Object.entries(s).map(([k, v]) => [`--color-${prefix}-${k}`, v]))

// ---------- neutrals ----------
const WARM_LIGHT: Scale = { 50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#6f6863', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917' }
const COOL_LIGHT: Scale = { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#5f6b7d', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a' }
const DUSK_LIGHT: Scale = { 50: '#eceef4', 100: '#e2e5ee', 200: '#d2d6e3', 300: '#bcc2d4', 400: '#8e95ab', 500: '#5b6278', 600: '#474d63', 700: '#363b4f', 800: '#232738', 900: '#151826' }

// night neutrals: 50 = page, white = card, then rising lightness for text
const darkNeutral = (page: string, card: string, s: Omit<Scale, 50>) => ({ '--color-white': card, ...stone({ 50: page, ...s } as Scale) })
const WARM_DARK = darkNeutral('#121412', '#1b1e1c', { 100: '#242826', 200: '#2f3431', 300: '#3e4440', 400: '#7f8781', 500: '#9ea69f', 600: '#b6bdb7', 700: '#ced4cf', 800: '#e2e7e3', 900: '#f1f4f1' })
const COOL_DARK = darkNeutral('#0f1318', '#171c23', { 100: '#212833', 200: '#2c3542', 300: '#3b4656', 400: '#7c8898', 500: '#9aa6b5', 600: '#b3bdca', 700: '#cdd5df', 800: '#e1e7ee', 900: '#f1f4f8' })
const OLIVE_DARK = darkNeutral('#131410', '#1c1e18', { 100: '#262921', 200: '#32362b', 300: '#424739', 400: '#838a77', 500: '#a1a895', 600: '#b9bfae', 700: '#d0d5c7', 800: '#e4e8dc', 900: '#f2f4ee' })
const NAVY_DARK = darkNeutral('#0a0e1a', '#121829', { 100: '#1b2338', 200: '#263049', 300: '#34405e', 400: '#76819f', 500: '#97a1bd', 600: '#b2bad1', 700: '#ccd2e3', 800: '#e0e4f0', 900: '#f0f2f9' })

// ---------- accents (leaf-*) and warm highlight (ember-*) ----------
type Accent = Omit<Scale, 400>
const accent = (a: Accent) => Object.fromEntries(Object.entries(a).map(([k, v]) => [`--color-leaf-${k}`, v]))
const ember = (e400: string, e500: string, e600: string) => ({ '--color-ember-400': e400, '--color-ember-500': e500, '--color-ember-600': e600 })

// status colours
const STATUS_LIGHT: Vars = {
  '--color-red-50': '#fef2f2', '--color-red-100': '#fee2e2', '--color-red-200': '#fecaca', '--color-red-300': '#fca5a5',
  '--color-red-600': '#dc2626', '--color-red-700': '#b91c1c', '--color-red-800': '#991b1b', '--color-red-900': '#7f1d1d',
  '--color-orange-50': '#fff7ed', '--color-orange-100': '#ffedd5', '--color-orange-200': '#fed7aa', '--color-orange-300': '#fdba74',
  '--color-orange-800': '#9a3412', '--color-orange-900': '#7c2d12',
  '--color-sky-100': '#e0f2fe', '--color-sky-700': '#0369a1',
}
const STATUS_DARK: Vars = {
  '--color-red-50': '#2b1615', '--color-red-100': '#3b1c1a', '--color-red-200': '#5c2b27', '--color-red-300': '#7d3b35',
  '--color-red-600': '#f87171', '--color-red-700': '#fca5a5', '--color-red-800': '#fecaca', '--color-red-900': '#fee2e2',
  '--color-orange-50': '#2a1d10', '--color-orange-100': '#3a2915', '--color-orange-200': '#5b3e1e', '--color-orange-300': '#7a5427',
  '--color-orange-800': '#fdba74', '--color-orange-900': '#fed7aa',
  '--color-sky-100': '#10283b', '--color-sky-700': '#7dd3fc',
}

export interface ThemeDef { id: ThemeId; name: string; blurb: string; light: Vars; dark: Vars }

const def = (
  id: ThemeId, name: string, blurb: string,
  l: { neutral: Scale; accent: Accent; ember: [string, string, string]; chart?: Vars },
  d: { neutral: Vars; accent: Accent; ember: [string, string, string] },
): ThemeDef => ({
  id, name, blurb,
  light: { '--color-white': '#ffffff', ...stone(l.neutral), '--color-ink': l.neutral[900], ...accent(l.accent), ...ember(...l.ember), ...STATUS_LIGHT, '--color-on-accent': '#ffffff' },
  dark: { ...d.neutral, '--color-ink': d.neutral['--color-stone-900'], ...accent(d.accent), ...ember(...d.ember), ...STATUS_DARK, '--color-on-accent': d.neutral['--color-stone-50'] },
})

export const THEMES: ThemeDef[] = [
  def('fresh', 'Fresh', 'Clean whites with a garden green',
    { neutral: WARM_LIGHT, accent: { 50: '#f0f7f1', 100: '#dcefe0', 200: '#b9dec2', 300: '#8cc79c', 500: '#3f8f57', 600: '#2e7445', 700: '#245c38', 800: '#1b4429', 900: '#14321f' }, ember: ['#f0a35a', '#c96a1c', '#b05a14'] },
    { neutral: WARM_DARK, accent: { 50: '#14251a', 100: '#1b3322', 200: '#26472f', 300: '#356344', 500: '#55a06d', 600: '#6dba86', 700: '#88cf9d', 800: '#a9dfb8', 900: '#c9eed3' }, ember: ['#f5b77a', '#f0a35a', '#f3b274'] }),
  def('slate', 'Slate', 'Neutral greys with a calm blue',
    { neutral: COOL_LIGHT, accent: { 50: '#f0f4f9', 100: '#dfe7f1', 200: '#c3d1e3', 300: '#97aecb', 500: '#4f6d93', 600: '#3e5a7d', 700: '#2f4764', 800: '#24374e', 900: '#172536' }, ember: ['#f2b25c', '#b9701d', '#a8641a'] },
    { neutral: COOL_DARK, accent: { 50: '#141e2c', 100: '#1b283a', 200: '#253751', 300: '#334b6d', 500: '#5e83b0', 600: '#7b9cc6', 700: '#9cb6d8', 800: '#bccee6', 900: '#dbe5f2' }, ember: ['#f5c27f', '#f2b25c', '#f4bd73'] }),
  def('sage', 'Sage', 'Olive and terracotta, earthy and warm',
    { neutral: WARM_LIGHT, accent: { 50: '#f3f5ee', 100: '#e4e9d8', 200: '#c9d4b2', 300: '#a7b886', 500: '#6b7f45', 600: '#566a35', 700: '#44552a', 800: '#35421f', 900: '#232c15' }, ember: ['#e39a7b', '#c96a46', '#a3502d'] },
    { neutral: OLIVE_DARK, accent: { 50: '#1b2014', 100: '#232a1a', 200: '#323c24', 300: '#475433', 500: '#8a9f60', 600: '#a2b67a', 700: '#b9ca95', 800: '#cfdbb3', 900: '#e3ebd2' }, ember: ['#eab39b', '#e39a7b', '#e8a78b'] }),
  def('ocean', 'Ocean', 'Fresh teal with a coral accent',
    { neutral: COOL_LIGHT, accent: { 50: '#eef7fa', 100: '#d5ecf3', 200: '#aad7e6', 300: '#73bbd3', 500: '#2a8bab', 600: '#1f7290', 700: '#195a73', 800: '#14485c', 900: '#0c2f3d' }, ember: ['#f59f8b', '#d2593e', '#b84a33'] },
    { neutral: COOL_DARK, accent: { 50: '#0f2129', 100: '#132b36', 200: '#1a3d4c', 300: '#235569', 500: '#3fa6c7', 600: '#5bbad8', 700: '#7fcde6', 800: '#a6dfef', 900: '#cdeef7' }, ember: ['#f7b4a4', '#f59f8b', '#f6ab99'] }),
  def('midnight', 'Midnight', 'A darker palette with soft indigo',
    { neutral: DUSK_LIGHT, accent: { 50: '#eef0fb', 100: '#dde1f6', 200: '#bcc3ec', 300: '#929cdc', 500: '#5a63b8', 600: '#474f9e', 700: '#383f82', 800: '#2c3166', 900: '#1d2145' }, ember: ['#f0b06a', '#a9661c', '#a6651d'] },
    { neutral: NAVY_DARK, accent: { 50: '#161b36', 100: '#1d2346', 200: '#29305e', 300: '#384180', 500: '#7a84d6', 600: '#959ee2', 700: '#b0b7ec', 800: '#cacff4', 900: '#e2e5fa' }, ember: ['#f5c58f', '#f0b06a', '#f3bc7f'] }),
]

// Midnight's "light" variant sits on darker dusk surfaces: cards are a soft off-white
THEMES[4].light['--color-white'] = '#f7f8fc'

export const DEFAULT_THEME: ThemeId = 'fresh'
export const themeById = (id: string): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** Colours for charts and indicators, per mode (read through CSS variables by components). */
export function derivedVars(t: ThemeDef, mode: Mode): Vars {
  const v = t[mode]
  return {
    ...v,
    '--chart-series': v['--color-leaf-600'],
    '--chart-grid': v['--color-stone-200'],
    '--chart-axis': v['--color-stone-500'],
    '--chart-dots': v['--color-stone-400'],
    '--chart-cursor': v['--color-stone-100'],
    '--nut-energy': v['--color-ember-500'],
    '--nut-protein': v['--color-leaf-600'],
    '--nut-carbs': mode === 'dark' ? '#e9c25a' : '#b7860b',
    '--nut-fat': mode === 'dark' ? '#b9a2f5' : '#7c3aed',
    '--art-mix': mode === 'dark' ? '16%' : '100%',
    '--art-ink': mode === 'dark' ? '55%' : '100%',
  }
}

// ---------- contrast (WCAG 2) ----------
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Text/background pairs the app uses, with the minimum contrast each needs. */
export const CONTRAST_PAIRS: Array<[fg: string, bg: string, min: number, what: string]> = [
  ['--color-ink', '--color-white', 7, 'body text on cards'],
  ['--color-stone-900', '--color-stone-50', 7, 'headings on the page'],
  ['--color-stone-800', '--color-white', 7, 'strong text on cards'],
  ['--color-stone-700', '--color-white', 4.5, 'text on cards'],
  ['--color-stone-600', '--color-white', 4.5, 'secondary text on cards'],
  ['--color-stone-500', '--color-white', 4.5, 'muted text on cards'],
  ['--color-stone-500', '--color-stone-50', 4.5, 'muted text on the page'],
  ['--color-stone-700', '--color-stone-100', 4.5, 'text on subtle fills'],
  ['--color-leaf-700', '--color-white', 4.5, 'links and accent text'],
  ['--color-leaf-900', '--color-stone-50', 7, 'page titles'],
  ['--color-leaf-700', '--color-leaf-50', 4.5, 'accent text on accent tint'],
  ['--color-leaf-900', '--color-leaf-50', 4.5, 'notices on accent tint'],
  ['--color-on-accent', '--color-leaf-700', 4.5, 'primary buttons'],
  ['--color-on-accent', '--color-leaf-600', 3, 'primary buttons (hover)'],
  ['--color-red-700', '--color-red-50', 4.5, 'error text'],
  ['--color-red-700', '--color-white', 4.5, 'error text on cards'],
  ['--color-red-900', '--color-red-50', 4.5, 'error notices'],
  ['--color-orange-900', '--color-orange-50', 4.5, 'warning notices'],
  ['--color-ember-600', '--color-white', 3, 'warm highlights'],
  ['--color-on-accent', '--color-ember-500', 3, 'training-day switch'],
  ['--color-sky-700', '--color-sky-100', 4.5, 'info badges'],
]

export function contrastProblems(): string[] {
  const out: string[] = []
  for (const t of THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      const v = t[mode]
      for (const [fg, bg, min, what] of CONTRAST_PAIRS) {
        const c = contrast(v[fg], v[bg])
        if (c < min) out.push(`${t.name} ${mode}: ${what} ${c.toFixed(2)} < ${min}`)
      }
    }
  }
  return out
}

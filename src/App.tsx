import { useState } from 'react'
import { BookOpen, CalendarDays, ChefHat, Ellipsis, House, Refrigerator, ScanLine, Settings, ShoppingCart, Target, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Sheet, cx } from './components/ui'
import { Logo } from './components/Logo'
import { ModeToggle } from './screens/settings/AppearanceCard'
import TodayScreen from './screens/Today'
import PlanScreen from './screens/Plan'
import RecipesScreen from './screens/Recipes'
import RecipeDetailScreen from './screens/RecipeDetail'
import RecipeEditScreen from './screens/RecipeEdit'
import PantryScreen from './screens/Pantry'
import ScanScreen from './screens/Scan'
import ShoppingScreen from './screens/Shopping'
import ExpensesScreen from './screens/Expenses'
import ProgressScreen from './screens/Progress'
import GoalsScreen from './screens/Goals'
import ChefScreen from './screens/Chef'
import SettingsScreen from './screens/Settings'

/** The 11 screens. On phones the first four sit in the bottom bar and the rest under More; on wide screens all are in the sidebar. */
export const SCREENS: ReadonlyArray<{ path: string; label: string; icon: LucideIcon; main: boolean; group: 'Daily' | 'Shopping' | 'You' }> = [
  { path: '/', label: 'Today', icon: House, main: true, group: 'Daily' },
  { path: '/plan', label: 'Plan', icon: CalendarDays, main: true, group: 'Daily' },
  { path: '/recipes', label: 'Recipes', icon: BookOpen, main: true, group: 'Daily' },
  { path: '/pantry', label: 'Pantry', icon: Refrigerator, main: true, group: 'Daily' },
  { path: '/scan', label: 'Scan Receipt', icon: ScanLine, main: false, group: 'Shopping' },
  { path: '/shopping', label: 'Shopping List', icon: ShoppingCart, main: false, group: 'Shopping' },
  { path: '/expenses', label: 'Expenses', icon: Wallet, main: false, group: 'Shopping' },
  { path: '/progress', label: 'Progress', icon: TrendingUp, main: false, group: 'You' },
  { path: '/goals', label: 'Goals & Targets', icon: Target, main: false, group: 'You' },
  { path: '/chef', label: 'Chef', icon: ChefHat, main: false, group: 'You' },
  { path: '/settings', label: 'Settings', icon: Settings, main: false, group: 'You' },
]

const isActive = (path: string, pathname: string) => (path === '/' ? pathname === '/' : pathname.startsWith(path))

function BottomNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const extra = SCREENS.filter((s) => !s.main)
  const inMore = extra.some((s) => isActive(s.path, loc.pathname))
  const tab = (active: boolean, Icon: LucideIcon, label: string) => (
    <span className={cx('flex flex-col items-center gap-1 text-[11px] font-medium transition-colors', active ? 'text-leaf-700' : 'text-stone-500')}>
      <span className={cx('flex h-8 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-leaf-100')}>
        <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      </span>
      {label}
    </span>
  )
  return (
    <>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {SCREENS.filter((s) => s.main).map((s) => (
            <NavLink key={s.path} to={s.path} end={s.path === '/'} className="flex min-h-16 items-center justify-center">
              {({ isActive: a }) => tab(a, s.icon, s.label)}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMore(true)} className="flex min-h-16 items-center justify-center" aria-haspopup="dialog">
            {tab(inMore, Ellipsis, 'More')}
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More">
        <div className="mb-3 flex justify-center"><Logo size={72} /></div>
        <div className="grid grid-cols-3 gap-2">
          {extra.map((s) => (
            <button
              key={s.path}
              type="button"
              onClick={() => {
                setMore(false)
                nav(s.path)
              }}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-2 text-center text-sm font-medium text-stone-700 transition hover:border-leaf-200 hover:bg-leaf-50"
            >
              <s.icon className="h-6 w-6 text-leaf-700" strokeWidth={1.8} aria-hidden />
              {s.label}
            </button>
          ))}
        </div>
        <ModeToggle className="mt-3 w-full justify-center border border-stone-200" />
      </Sheet>
    </>
  )
}

/** Wide screens: every screen in a sidebar, grouped. */
function SideNav() {
  const loc = useLocation()
  const groups = ['Daily', 'Shopping', 'You'] as const
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-stone-200 bg-white px-3 py-5 lg:flex">
      <div className="mb-6 flex items-center gap-2.5 px-3">
        <Logo size={44} eager decorative />
        <span className="text-lg font-semibold tracking-tight text-stone-900">Pantry Chef</span>
      </div>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-stone-500">{g}</p>
          {SCREENS.filter((s) => s.group === g).map((s) => {
            const a = isActive(s.path, loc.pathname)
            return (
              <NavLink key={s.path} to={s.path} end={s.path === '/'}
                className={cx('flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors', a ? 'bg-leaf-100 text-leaf-800' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900')}>
                <s.icon className="h-[18px] w-[18px]" strokeWidth={a ? 2.2 : 1.8} aria-hidden />
                {s.label}
              </NavLink>
            )
          })}
        </div>
      ))}
      <div className="mt-auto border-t border-stone-200 pt-3"><ModeToggle className="w-full" /></div>
    </nav>
  )
}

export default function App() {
  return (
    <HashRouter>
      <SideNav />
      <main className="min-h-full lg:pl-60">
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/recipes" element={<RecipesScreen />} />
          <Route path="/recipes/new" element={<RecipeEditScreen />} />
          <Route path="/recipes/:id" element={<RecipeDetailScreen />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditScreen />} />
          <Route path="/pantry" element={<PantryScreen />} />
          <Route path="/scan" element={<ScanScreen />} />
          <Route path="/shopping" element={<ShoppingScreen />} />
          <Route path="/expenses" element={<ExpensesScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/goals" element={<GoalsScreen />} />
          <Route path="/chef" element={<ChefScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Routes>
      </main>
      <BottomNav />
    </HashRouter>
  )
}

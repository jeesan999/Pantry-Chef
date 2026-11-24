import { useState, type ReactNode } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Sheet, cx } from './components/ui'
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

/** The 11 screens. The first four sit in the bottom bar; the rest are under More. */
export const SCREENS = [
  { path: '/', label: 'Today', icon: 'M3 12l9-8 9 8M5 10v10h14V10', main: true },
  { path: '/plan', label: 'Plan', icon: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4', main: true },
  { path: '/recipes', label: 'Recipes', icon: 'M6 3h10l3 3v15H6zM9 8h7M9 12h7M9 16h4', main: true },
  { path: '/pantry', label: 'Pantry', icon: 'M5 3h14v18H5zM5 10h14M5 16h14M9 6.5h2M9 13h2', main: true },
  { path: '/scan', label: 'Scan Receipt', icon: 'M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M7 12h10', main: false },
  { path: '/shopping', label: 'Shopping List', icon: 'M5 6h14l-1.5 9h-11zM8 20a1 1 0 100-2M17 20a1 1 0 100-2', main: false },
  { path: '/expenses', label: 'Expenses', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', main: false },
  { path: '/progress', label: 'Progress', icon: 'M3 17l6-6 4 4 8-8M15 7h6v6', main: false },
  { path: '/goals', label: 'Goals & Targets', icon: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 16a4 4 0 110-8 4 4 0 010 8z', main: false },
  { path: '/chef', label: 'Chef', icon: 'M7 10a4 4 0 118-1 3 3 0 112 5v5H7v-5a3 3 0 010-4zM7 16h10', main: false },
  { path: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .2-1.5-1.5L16.7 4l-3-1-1 2h-1.4l-1-2-3 1 .2 2.7L7 8.2 5 8 4 11l2 1v1.4l-2 1 1 3 2-.2 1.5 1.5L8.3 21l3 1 1-2h1.4l1 2 3-1-.2-2.7L18 15.8l2 .2 1-3-2-1z', main: false },
] as const

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-6 w-6', className)} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function BottomNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const extra = SCREENS.filter((s) => !s.main)
  const inMore = extra.some((s) => loc.pathname.startsWith(s.path))
  const tab = (active: boolean, children: ReactNode) => (
    <span className={cx('flex flex-col items-center gap-0.5 text-[11px] font-medium', active ? 'text-leaf-700' : 'text-stone-500')}>{children}</span>
  )
  return (
    <>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {SCREENS.filter((s) => s.main).map((s) => (
            <NavLink key={s.path} to={s.path} end={s.path === '/'} className="flex min-h-16 items-center justify-center">
              {({ isActive }) => tab(isActive, <><Icon d={s.icon} />{s.label}</>)}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMore(true)} className="flex min-h-16 items-center justify-center" aria-haspopup="dialog">
            {tab(inMore, <><Icon d="M5 12h.01M12 12h.01M19 12h.01" className="stroke-[3]" />More</>)}
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More">
        <div className="grid grid-cols-3 gap-2">
          {extra.map((s) => (
            <button
              key={s.path}
              type="button"
              onClick={() => {
                setMore(false)
                nav(s.path)
              }}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-stone-50 p-2 text-center text-sm font-medium text-stone-700 hover:bg-leaf-50"
            >
              <Icon d={s.icon} className="text-leaf-700" />
              {s.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <main className="min-h-full">
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

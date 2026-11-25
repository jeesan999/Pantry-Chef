import { useLiveQuery } from 'dexie-react-hooks'
import Fuse from 'fuse.js'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RecipeArt } from '../components/RecipeArt'
import { Badge, Button, Input, Page, Select, cx } from '../components/ui'
import { db, repo } from '../db/instance'
import { allRatings } from '../lib/ratings'
import type { SlotTag } from '../db/types'
import { useAllRecipeNutrition, usePantrySuggestions } from '../lib/hooks'

export const TAG_LABEL: Record<SlotTag, string> = {
  breakfast: 'Breakfast',
  smoko: 'Smoko',
  'pre-workout': 'Pre-workout',
  'post-workout': 'Post-workout lunch',
  lunch: 'Lunch',
  'low-carb-dinner': 'Low-carb dinner',
  dinner: 'Dinner',
}

export default function RecipesScreen() {
  const recipes = useLiveQuery(() => db.recipes.orderBy('name').toArray())
  const nutrition = useAllRecipeNutrition()
  const [q, setQ] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [tag, setTag] = useState<SlotTag | ''>('')
  const [fromPantry, setFromPantry] = useState(false)
  const pantry = usePantrySuggestions()
  const ratings = useLiveQuery(() => allRatings(repo))
  const cover = new Map((pantry ?? []).map((p, i) => [p.recipe.id, { ...p, rank: i }]))

  const cuisines = useMemo(() => [...new Set((recipes ?? []).map((r) => r.cuisine))].sort(), [recipes])
  const fuse = useMemo(() => new Fuse(recipes ?? [], { keys: ['name', 'cuisine'], threshold: 0.35 }), [recipes])
  const list = (q ? fuse.search(q).map((x) => x.item) : recipes ?? [])
    .filter((r) => !cuisine || r.cuisine === cuisine)
    .filter((r) => !tag || r.slotTags.includes(tag))
    .filter((r) => !fromPantry || cover.has(r.id))
    .sort((a, b) => (fromPantry ? cover.get(a.id)!.rank - cover.get(b.id)!.rank : 0))

  return (
    <Page title="Recipes" subtitle={recipes ? `${recipes.length} recipes` : ' '} action={<Link to="/recipes/new"><Button>Add</Button></Link>}>
      <div className="space-y-2">
        <Input placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={cuisine} onChange={(e) => setCuisine(e.target.value)} aria-label="Cuisine">
            <option value="">All cuisines</option>
            {cuisines.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value as SlotTag | '')} aria-label="Meal">
            <option value="">All meals</option>
            {(Object.keys(TAG_LABEL) as SlotTag[]).map((t) => <option key={t} value={t}>{TAG_LABEL[t]}</option>)}
          </Select>
        </div>
        <label className={cx('flex min-h-10 w-fit items-center gap-2 rounded-full border px-3 text-sm', fromPantry ? 'border-leaf-500 bg-leaf-50 text-leaf-700' : 'border-stone-300 text-stone-600')}>
          <input type="checkbox" className="sr-only" checked={fromPantry} onChange={(e) => setFromPantry(e.target.checked)} />
          From my pantry{pantry ? ` (${pantry.length})` : ''}
        </label>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {list.map((r) => {
          const n = nutrition?.get(r.id)?.perServing
          return (
            <li key={r.id}>
              <Link to={`/recipes/${r.id}`} className="block overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <RecipeArt recipe={r} className="aspect-[4/3] w-full" />
                <div className="p-2.5">
                  <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-stone-800">{r.name}</p>
                  <p className="tabular mt-1 text-xs text-stone-500">
                    {n ? `${Math.round(n.proteinG)} g protein · ${Math.round(n.energyKcal)} kcal` : '…'}
                  </p>
                  <div className={cx('mt-1.5 flex flex-wrap gap-1')}>
                    {r.fixedSlot && <Badge>fixed</Badge>}
                    {ratings?.get(r.id)?.flags.includes('favourite') && <Badge tone="red">♥ favourite</Badge>}
                    {ratings?.get(r.id)?.flags.includes('do_not_recommend') && <Badge>not suggested</Badge>}
                    {cover.get(r.id) && <Badge tone="ember">{Math.round(cover.get(r.id)!.coverage * 100)}% in stock</Badge>}
                    <Badge tone="leaf">{r.cuisine}</Badge>
                  </div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
      {list.length === 0 && <p className="text-center text-sm text-stone-500">No recipes match.</p>}
    </Page>
  )
}

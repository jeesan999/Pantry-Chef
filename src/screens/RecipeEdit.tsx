import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FoodPicker } from '../components/FoodPicker'
import { Button, Card, Field, Input, Notice, Page, Select } from '../components/ui'
import { db, repo } from '../db/instance'
import { newId, nowIso } from '../db/repo'
import type { Food, QtyUnit, Recipe, RecipeIngredient, SlotTag } from '../db/types'
import { recipeNutrition } from '../lib/nutrition'
import { TAG_LABEL } from './Recipes'

interface Line { key: string; food?: Food; label: string; quantity: string; unit: QtyUnit; weighed: 'raw' | 'cooked'; optional: boolean }

export default function RecipeEditScreen() {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(async () => {
    if (!id) return null
    const r = await db.recipes.get(id)
    if (!r) return null
    const ings = (await db.recipe_ingredients.where('recipeId').equals(id).toArray()).sort((a, b) => a.sort - b.sort)
    const foods = await db.foods.bulkGet(ings.map((i) => i.foodId ?? ''))
    return { r, ings, foods }
  }, [id])
  const cuisines = useLiveQuery(async () => [...new Set((await db.recipes.toArray()).map((r) => r.cuisine))].sort())
  const yields = useLiveQuery(() => db.cooking_yields.toArray())

  const [name, setName] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [tags, setTags] = useState<SlotTag[]>([])
  const [prep, setPrep] = useState('10')
  const [cook, setCook] = useState('15')
  const [servings, setServings] = useState('1')
  const [method, setMethod] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState(!id)

  useEffect(() => {
    if (!existing || loaded) return
    const { r, ings, foods } = existing
    setName(r.name); setCuisine(r.cuisine); setTags(r.slotTags); setPrep(String(r.prepMin)); setCook(String(r.cookMin)); setServings(String(r.servings)); setMethod(r.method.join('\n'))
    setLines(ings.map((i, k) => ({ key: i.id, food: foods[k] ?? undefined, label: i.label, quantity: String(i.quantity), unit: i.unit, weighed: i.weighed, optional: i.optional })))
    setLoaded(true)
  }, [existing, loaded])

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const recipeId = id ?? ''

  const toIngredients = (rid: string): RecipeIngredient[] =>
    lines.filter((l) => l.food && Number(l.quantity) > 0).map((l, i) => ({
      id: newId(), recipeId: rid, foodId: l.food!.id, label: l.label || l.food!.name, quantity: Number(l.quantity), unit: l.unit, weighed: l.weighed, optional: l.optional, sort: i,
    }))

  const preview = (() => {
    const ings = toIngredients('preview')
    const map = new Map(lines.filter((l) => l.food).map((l) => [l.food!.id, l.food!]))
    return recipeNutrition(ings, map, Number(servings) || 1, yields ?? [])
  })()

  const save = async () => {
    setError(undefined)
    if (!name.trim() || !cuisine.trim()) return setError('Name and cuisine are required.')
    if (tags.length === 0) return setError('Pick at least one meal this recipe suits.')
    if (!lines.some((l) => l.food)) return setError('Add at least one ingredient.')
    const incomplete = lines.find((l) => !l.food || !(Number(l.quantity) > 0))
    if (incomplete) return setError(`Finish or remove the ingredient line "${incomplete.label || 'unnamed'}".`)
    const rid = recipeId || newId()
    const base = existing?.r
    const rec: Recipe = {
      id: rid, name: name.trim(), cuisine: cuisine.trim(), method: method.split('\n').map((s) => s.trim()).filter(Boolean),
      prepMin: Number(prep) || 0, cookMin: Number(cook) || 0, servings: Number(servings) || 1, slotTags: tags,
      photo: base?.photo, starter: base?.starter ?? false, createdAt: base?.createdAt ?? nowIso(), updatedAt: nowIso(),
    }
    try {
      await repo.tx(async () => {
        if (base) await repo.update('recipes', rid, rec)
        else await repo.insert('recipes', rec)
        await db.recipe_ingredients.where('recipeId').equals(rid).delete()
        for (const ing of toIngredients(rid)) await repo.insert('recipe_ingredients', ing)
      })
      nav(`/recipes/${rid}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (id && !loaded) return <Page title="Edit recipe">{null}</Page>
  return (
    <Page title={id ? 'Edit recipe' : 'New recipe'}>
      {error && <Notice tone="red">{error}</Notice>}
      <Card>
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Cuisine">
            <Input list="cuisines" value={cuisine} onChange={(e) => setCuisine(e.target.value)} />
            <datalist id="cuisines">{cuisines?.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Prep (min)"><Input inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} /></Field>
            <Field label="Cook (min)"><Input inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} /></Field>
            <Field label="Servings"><Input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-stone-700">Suits</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TAG_LABEL) as SlotTag[]).filter((t) => t !== 'breakfast').map((t) => (
                <label key={t} className={`flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm ${tags.includes(t) ? 'border-leaf-500 bg-leaf-50 text-leaf-700' : 'border-stone-300 text-stone-600'}`}>
                  <input type="checkbox" className="sr-only" checked={tags.includes(t)} onChange={(e) => setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} />
                  {TAG_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card title="Ingredients" action={<span className="tabular text-xs text-stone-500">{Math.round(preview.perServing.proteinG)} g protein · {Math.round(preview.perServing.energyKcal)} kcal / serving</span>}>
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.key} className="rounded-xl border border-stone-200 p-3">
              <button className="mb-2 w-full text-left text-sm font-medium text-leaf-700" onClick={() => setPicking(l.key)}>
                {l.food ? l.food.name : 'Choose food…'}
              </button>
              <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                <Input placeholder="Label, e.g. Chicken breast" value={l.label} onChange={(e) => setLine(l.key, { label: e.target.value })} aria-label="Label" />
                <Input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                <Select value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value as QtyUnit })} aria-label="Unit">
                  <option value="g">g</option><option value="ml">ml</option><option value="unit">each</option>
                </Select>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <label className="flex items-center gap-1.5 text-stone-600">
                  <input type="checkbox" checked={l.weighed === 'cooked'} onChange={(e) => setLine(l.key, { weighed: e.target.checked ? 'cooked' : 'raw' })} /> weighed cooked
                </label>
                <label className="flex items-center gap-1.5 text-stone-600">
                  <input type="checkbox" checked={l.optional} onChange={(e) => setLine(l.key, { optional: e.target.checked })} /> optional
                </label>
                <button className="text-red-600" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        {preview.missing.length > 0 && <div className="mt-2"><Notice tone="red">{preview.missing.join('; ')}</Notice></div>}
        <Button variant="secondary" className="mt-3 w-full" onClick={() => { const key = newId(); setLines([...lines, { key, label: '', quantity: '', unit: 'g', weighed: 'raw', optional: false }]); setPicking(key) }}>
          Add ingredient
        </Button>
      </Card>

      <Card title="Method">
        <Field label="One step per line">
          <textarea className="block min-h-40 w-full rounded-xl border border-stone-300 p-3" value={method} onChange={(e) => setMethod(e.target.value)} />
        </Field>
      </Card>

      <Button className="w-full" onClick={save}>Save recipe</Button>
      <FoodPicker open={picking !== null} onClose={() => setPicking(null)} onPick={(f) => { if (picking) setLine(picking, { food: f, label: lines.find((l) => l.key === picking)?.label || f.name.split(',')[0] }); setPicking(null) }} />
    </Page>
  )
}

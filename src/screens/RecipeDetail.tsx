import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { RecipeArt } from '../components/RecipeArt'
import { RatingControls } from '../components/RatingControls'
import { Badge, Button, Card, Notice, Page, fmt } from '../components/ui'
import { db, repo } from '../db/instance'
import { nowIso } from '../db/repo'
import { downscaleImage } from '../lib/image'
import { ingredientGrams, recipeNutrition, scaleNutrients } from '../lib/nutrition'
import { TAG_LABEL } from './Recipes'

export default function RecipeDetailScreen() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [servings, setServings] = useState<number | null>(null)
  const [error, setError] = useState<string>()
  const data = useLiveQuery(async () => {
    const recipe = await db.recipes.get(id)
    if (!recipe) return null
    const ings = (await db.recipe_ingredients.where('recipeId').equals(id).toArray()).sort((a, b) => a.sort - b.sort)
    const foods = await db.foods.bulkGet(ings.map((i) => i.foodId ?? ''))
    const yields = await db.cooking_yields.toArray()
    const foodMap = new Map(foods.filter((f) => !!f).map((f) => [f!.id, f!]))
    return { recipe, ings, foodMap, yields, n: recipeNutrition(ings, foodMap, recipe.servings, yields) }
  }, [id])

  if (data === undefined) return <Page title="">{null}</Page>
  if (data === null) return <Page title="Recipe not found"><Link to="/recipes" className="text-leaf-700 underline">Back to recipes</Link></Page>
  const { recipe, ings, foodMap, yields, n } = data
  const s = servings ?? recipe.servings
  const k = s / recipe.servings
  const per = n.perServing
  const total = scaleNutrients(n.total, k)

  const onPhoto = async (f?: File) => {
    if (!f) return
    try {
      await repo.update('recipes', recipe.id, { photo: await downscaleImage(f), updatedAt: nowIso() })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const onDelete = async () => {
    if (!confirm(`Delete "${recipe.name}"?`)) return
    try {
      await repo.remove('recipes', recipe.id)
      nav('/recipes')
    } catch (e) {
      setError(`Cannot delete: ${(e as Error).message}. It is used in a meal plan.`)
    }
  }

  return (
    <Page title={recipe.name} subtitle={<span className="flex flex-wrap gap-1">{recipe.slotTags.map((t) => <Badge key={t} tone="leaf">{TAG_LABEL[t]}</Badge>)}</span>}>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="relative overflow-hidden rounded-2xl">
        <RecipeArt recipe={recipe} className="aspect-[16/9] w-full" />
        <label className="absolute bottom-2 right-2 cursor-pointer rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-stone-700 shadow">
          {recipe.photo ? 'Replace photo' : 'Add your photo'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} />
        </label>
      </div>

      <div className="tabular flex justify-between rounded-2xl bg-white px-4 py-3 text-sm text-stone-600 shadow-sm">
        <span>{recipe.cuisine}</span><span>Prep {recipe.prepMin} min</span><span>Cook {recipe.cookMin} min</span>
      </div>

      <Card title="Per serving" action={n.approximate ? <Badge tone="ember">approximate</Badge> : <Badge tone="leaf">AFCD</Badge>}>
        <dl className="tabular grid grid-cols-3 gap-y-2 text-sm">
          <Stat k="Energy" v={fmt.kcal(per.energyKcal)} />
          <Stat k="Protein" v={fmt.g(per.proteinG)} />
          <Stat k="Carbs" v={fmt.g(per.carbsG)} />
          <Stat k="Fat" v={fmt.g(per.fatG)} />
          <Stat k="Sat fat" v={fmt.g(per.satFatG)} />
          <Stat k="Fibre" v={fmt.g(per.fibreG)} />
          <Stat k="Sugars" v={fmt.g(per.sugarsG)} />
          <Stat k="Added sugar" v={fmt.g(per.addedSugarG)} />
          <Stat k="Sodium" v={`${Math.round(per.sodiumMg)} mg`} />
        </dl>
        {n.approximate && <p className="mt-2 text-xs text-stone-500">Some ingredients use interim values until the AFCD data is imported.</p>}
        {n.missing.length > 0 && <Notice tone="red">Not counted: {n.missing.join('; ')}</Notice>}
      </Card>

      <Card
        title="Ingredients"
        action={
          <div className="flex items-center gap-2 text-sm">
            <button className="h-9 w-9 rounded-full bg-stone-100" aria-label="Fewer servings" onClick={() => setServings(Math.max(0.5, s - 0.5))}>−</button>
            <span className="tabular w-20 text-center">{s} serving{s === 1 ? '' : 's'}</span>
            <button className="h-9 w-9 rounded-full bg-stone-100" aria-label="More servings" onClick={() => setServings(s + 0.5)}>+</button>
          </div>
        }
      >
        <ul className="divide-y divide-stone-100 text-sm">
          {ings.map((i) => {
            const f = i.foodId ? foodMap.get(i.foodId) : undefined
            let grams: number | null = null
            try { grams = f ? ingredientGrams({ ...i, weighed: 'raw' }, f, yields) * k : null } catch { grams = null }
            const qty = i.quantity * k
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span className={i.optional ? 'text-stone-500' : 'text-stone-800'}>
                  {i.label}{i.optional && ' (optional)'}
                  {f && <span className="block text-xs text-stone-400">{f.name}{f.source === 'interim' ? ' · interim' : ''}</span>}
                </span>
                <span className="tabular shrink-0 text-right text-stone-600">
                  {i.unit === 'unit' ? `${+qty.toFixed(2)}` : `${Math.round(qty)} ${i.unit}`}
                  {i.weighed === 'cooked' && ' cooked'}
                  {i.unit === 'unit' && grams !== null && <span className="block text-xs text-stone-400">≈ {Math.round(grams)} g</span>}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="tabular mt-2 text-xs text-stone-500">Whole recipe at {s} servings: {fmt.kcal(total.energyKcal)}, {fmt.g(total.proteinG)} protein</p>
      </Card>

      {!recipe.fixedSlot && <RatingControls recipeId={recipe.id} />}

      <Card title="Method">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-700">
          {recipe.method.map((m, i) => <li key={i}>{m}</li>)}
        </ol>
      </Card>

      <div className="flex gap-2">
        {recipe.fixedSlot ? (
          <Link to="/settings" className="flex-1"><Button variant="secondary" className="w-full">Edit breakfast quantities in Settings</Button></Link>
        ) : (
          <>
            <Link to={`/recipes/${recipe.id}/edit`} className="flex-1"><Button variant="secondary" className="w-full">Edit</Button></Link>
            <Button variant="danger" onClick={onDelete}>Delete</Button>
          </>
        )}
      </div>
    </Page>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{k}</dt>
      <dd className="font-medium text-stone-800">{v}</dd>
    </div>
  )
}

/** Your ratings of recipes: one row per recipe, changed in place. The planner and Chef read them. */
import { newId, nowIso, type Repo } from '../db/repo'
import type { RatingFlag, RecipeRating } from '../db/types'

export const FLAG_LABEL: Record<RatingFlag, string> = {
  favourite: 'Favourite',
  cook_again: 'Cook again',
  do_not_recommend: 'Don’t suggest',
  too_expensive: 'Too expensive',
  too_slow: 'Too slow',
  needs_flavour: 'Needs flavour',
  too_repetitive: 'Too often',
}

export async function getRating(repo: Repo, recipeId: string): Promise<RecipeRating | undefined> {
  const rows = await repo.db.recipe_ratings.where('recipeId').equals(recipeId).toArray()
  return rows.sort((a, b) => b.at.localeCompare(a.at))[0]
}

export async function allRatings(repo: Repo): Promise<Map<string, RecipeRating>> {
  const rows = (await repo.db.recipe_ratings.toArray()).sort((a, b) => a.at.localeCompare(b.at))
  return new Map(rows.map((r) => [r.recipeId, r])) // latest wins
}

/** Set stars and/or turn flags on or off. Returns the previous rating, for undo. */
export async function rate(
  repo: Repo,
  recipeId: string,
  change: { stars?: RecipeRating['stars'] | null; on?: RatingFlag[]; off?: RatingFlag[] },
): Promise<RecipeRating | undefined> {
  return repo.tx(async () => {
    const prev = await getRating(repo, recipeId)
    let flags = new Set(prev?.flags ?? [])
    for (const f of change.off ?? []) flags.delete(f)
    for (const f of change.on ?? []) flags.add(f)
    // opposites can't both hold
    if (change.on?.includes('do_not_recommend')) flags = new Set([...flags].filter((f) => f !== 'favourite' && f !== 'cook_again'))
    if (change.on?.some((f) => f === 'favourite' || f === 'cook_again')) flags.delete('do_not_recommend')
    const stars = change.stars === null ? undefined : change.stars ?? prev?.stars
    const next: RecipeRating = { id: prev?.id ?? newId(), recipeId, stars, flags: [...flags], at: nowIso() }
    if (prev) await repo.update('recipe_ratings', prev.id, next)
    else await repo.insert('recipe_ratings', next)
    return prev
  })
}

/** Put a rating back as it was (or remove it if there was none). */
export async function restoreRating(repo: Repo, recipeId: string, prev: RecipeRating | undefined): Promise<void> {
  const cur = await getRating(repo, recipeId)
  if (prev) await repo.update('recipe_ratings', prev.id, prev)
  else if (cur) await repo.remove('recipe_ratings', cur.id)
}

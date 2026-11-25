import { describe, expect, it } from 'vitest'
import { openDb } from './schema'
import { newId, nowIso, Repo } from './repo'
import { SETTINGS_ID, ensureStarterRecipes, seedIfEmpty } from './seed'
import { LIBRARY_RECIPES } from '../data/library'

describe('recipe library on an existing install', () => {
  it('adds the new recipes once, never re-adds a deleted starter, never touches your own recipes', async () => {
    const db = openDb(`lib-${newId()}`)
    await db.open()
    const repo = new Repo(db)
    await seedIfEmpty(repo, '2026-11-20')
    // make it look like an install from before the library: no new recipes, no version recorded
    for (const r of LIBRARY_RECIPES) await repo.remove('recipes', `recipe:${r.key}`)
    await repo.update('settings', SETTINGS_ID, { recipeLibrary: undefined })
    await repo.remove('recipes', 'recipe:au-chicken-rice-bowl') // a starter the user deleted
    await repo.insert('recipes', { id: 'mine', name: 'My curry', cuisine: 'Indian', method: ['Cook it.'], prepMin: 5, cookMin: 20, servings: 2, slotTags: ['dinner'], starter: false, createdAt: nowIso(), updatedAt: nowIso() })
    const before = await repo.db.recipes.count()

    expect(await ensureStarterRecipes(repo)).toBe(LIBRARY_RECIPES.length)
    expect(await repo.db.recipes.count()).toBe(before + LIBRARY_RECIPES.length)
    expect(await repo.get('recipes', 'recipe:au-chicken-rice-bowl')).toBeUndefined()
    expect((await repo.get('recipes', 'mine'))!.name).toBe('My curry')
    expect((await repo.get('recipes', 'recipe:cn-kung-pao-chicken'))).toMatchObject({ protein: 'chicken', technique: 'stir-fry', cuisine: 'Chinese' })
    expect(await ensureStarterRecipes(repo)).toBe(0) // only once
    expect(await repo.checkIntegrity()).toEqual([])
  })
})

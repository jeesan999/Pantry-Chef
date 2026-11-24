import type { Repo } from '../db/repo'
import { nowIso } from '../db/repo'
import type { Food, Nutrients } from '../db/types'
import { INTERIM_FOOD_ID } from './interimFoods'

export type AfcdRow = [string, string, number, number, number, number, number, number, number, number, number]
export interface AfcdData {
  release: string | null
  importedAt?: string
  foods: AfcdRow[]
}
export type AfcdMap = Record<string, { afcdKey: string; afcdName: string } | null>

export const AFCD_ATTRIBUTION =
  'Nutrient data: Food Standards Australia New Zealand (2025), Australian Food Composition Database – Release 3. Used and adapted under licence; derived data shared under the same licence.'

export function afcdNutrients(r: AfcdRow): Nutrients {
  const [, , kj, protein, fat, sat, carbs, sugars, added, fibre, sodium] = r
  return {
    energyKj: kj,
    energyKcal: Math.round((kj / 4.184) * 10) / 10,
    proteinG: protein,
    fatG: fat,
    satFatG: sat,
    carbsG: carbs,
    sugarsG: sugars,
    addedSugarG: added,
    fibreG: fibre,
    sodiumMg: sodium,
  }
}

/**
 * Load bundled AFCD data into the database. Interim foods that have a match are overwritten
 * in place (same id, so recipes keep working); every other AFCD food is added as afcd:<key>.
 * Safe to run again: existing AFCD rows are refreshed, nothing is duplicated.
 */
export async function applyAfcd(repo: Repo, data: AfcdData, map: AfcdMap): Promise<{ replaced: number; added: number }> {
  if (!data.release || data.foods.length === 0) return { replaced: 0, added: 0 }
  const byKey = new Map(data.foods.map((r) => [r[0], r]))
  let replaced = 0
  let added = 0
  await repo.tx(async () => {
    const claimed = new Set<string>()
    for (const [interimKey, m] of Object.entries(map)) {
      if (!m) continue
      const row = byKey.get(m.afcdKey)
      const id = INTERIM_FOOD_ID(interimKey)
      const existing = await repo.get('foods', id)
      if (!row || !existing || claimed.has(m.afcdKey)) continue
      claimed.add(m.afcdKey)
      // If an earlier run added this AFCD food separately, fold it into the interim row.
      const dup = await repo.db.foods.where('afcdKey').equals(m.afcdKey).first()
      if (dup && dup.id !== id) {
        const used = await repo.db.recipe_ingredients.where('foodId').equals(dup.id).count()
        const prods = await repo.db.products.where('foodId').equals(dup.id).count()
        if (used + prods === 0) await repo.db.foods.delete(dup.id)
        else continue
      }
      await repo.update('foods', id, { afcdKey: row[0], name: row[1], source: 'afcd', per100g: afcdNutrients(row), updatedAt: nowIso() })
      replaced++
    }
    for (const row of data.foods) {
      if (claimed.has(row[0])) continue
      const id = `afcd:${row[0]}`
      const food: Food = {
        id,
        afcdKey: row[0],
        name: row[1],
        source: 'afcd',
        state: /\braw\b/i.test(row[1]) ? 'raw' : /cooked|boiled|grilled|baked|fried|roasted|steamed/i.test(row[1]) ? 'cooked' : 'na',
        ediblePortion: 1,
        per100g: afcdNutrients(row),
        updatedAt: nowIso(),
      }
      const existing = await repo.get('foods', id)
      if (existing) await repo.update('foods', id, { name: food.name, per100g: food.per100g, updatedAt: food.updatedAt })
      else {
        await repo.insert('foods', food)
        added++
      }
    }
  })
  return { replaced, added }
}

/** Load the bundled AFCD files (split into their own chunk) and apply them once per release. */
export async function ensureAfcdLoaded(repo: Repo): Promise<{ replaced: number; added: number } | null> {
  const [{ default: data }, { default: map }] = await Promise.all([import('./afcd.json'), import('./afcdMap.json')])
  const d = data as unknown as AfcdData
  if (!d.release) return null
  const stamp = `afcd-applied:${d.importedAt}`
  if (localStorageSafe.get(stamp)) return null
  const res = await applyAfcd(repo, d, map as AfcdMap)
  localStorageSafe.set(stamp, '1')
  return res
}

const localStorageSafe = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* storage unavailable: AFCD is simply re-applied next start, which is harmless */
    }
  },
}

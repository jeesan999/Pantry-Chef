import { useLiveQuery } from 'dexie-react-hooks'
import { db, repo, today } from '../db/instance'
import { CONTRACT_VERSION } from '../engines/contract'
import { dayChoices } from './schedule'
import { PROFILE_ID, SETTINGS_ID } from '../db/seed'
import type { RecipeNutrition } from './nutrition'
import { loadPantrySuggestions, loadRecipeNutrition } from './rank'

export const useProfile = () => useLiveQuery(() => db.profile.get(PROFILE_ID))
export const useSettings = () => useLiveQuery(() => db.settings.get(SETTINGS_ID))
// Records made under an older contract version are ignored, so a fresh proposal is asked for.
const current = <T extends { targetSet: { contractVersion: number } }>(r?: T) => (r && r.targetSet.contractVersion === CONTRACT_VERSION ? r : null)
export const useApprovedTargets = () =>
  useLiveQuery(async () => current((await db.nutrition_targets.where('status').equals('approved').toArray())[0]))
export const useProposedTargets = () =>
  useLiveQuery(async () => current((await db.nutrition_targets.where('status').equals('proposed').toArray())[0]))
export const useDayChoices = (dates: string[]) => useLiveQuery(() => dayChoices(repo, dates), [dates.join()])

/** Per-serving nutrition for every recipe, recalculated whenever foods or ingredients change. */
export function useAllRecipeNutrition(): Map<string, RecipeNutrition> | undefined {
  return useLiveQuery(() => loadRecipeNutrition(repo))
}

/** Recipes ranked by how much of each is in the pantry (see lib/suggest.ts). */
export function usePantrySuggestions(limit = 64) {
  return useLiveQuery(() => loadPantrySuggestions(repo, today(), limit), [limit])
}

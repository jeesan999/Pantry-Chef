import { repo } from '../db/instance'
import { SETTINGS_ID } from '../db/seed'
import { applyAppearance, type Appearance } from './appearance'

/** Apply now and remember it (Settings is backed up; localStorage paints it before the app loads). */
export async function saveAppearance(a: Appearance) {
  applyAppearance(a)
  try {
    await repo.update('settings', SETTINGS_ID, { appearance: a })
  } catch {
    // settings not there yet (first start): the choice still applies and is in localStorage
  }
}

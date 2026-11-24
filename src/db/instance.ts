import { openDb } from './schema'
import { Repo } from './repo'
import { Pantry } from './pantry'

/** The app's single database connection, repository and pantry ledger. */
export const db = openDb()
export const repo = new Repo(db)
export const pantry = new Pantry(repo)

/** Today's date in the device's local time zone, YYYY-MM-DD. */
export function today(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

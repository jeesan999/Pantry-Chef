import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { initAppearance, syncFromSettings } from './theme/appearance'
import App from './App'
import { repo, today } from './db/instance'
import { SETTINGS_ID, ensureInterimFoods, seedIfEmpty } from './db/seed'
import { ensureAfcdLoaded } from './data/afcd'

async function start() {
  initAppearance()
  const root = createRoot(document.getElementById('root')!)
  try {
    await seedIfEmpty(repo, today())
    syncFromSettings((await repo.get('settings', SETTINGS_ID))?.appearance as never)
    await ensureInterimFoods(repo)
    await ensureAfcdLoaded(repo)
    // Ask the browser not to clear this site's data under storage pressure.
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false)
  } catch (e) {
    root.render(
      <div className="p-6 text-red-800">
        <h1 className="text-lg font-semibold">The app could not open its database</h1>
        <p className="mt-2 text-sm">{(e as Error).message}</p>
      </div>,
    )
    return
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start()

import { defineConfig } from '@playwright/test'

// Uses an installed Chrome when PW_CHROME is set (Playwright's own browser download may be unavailable).
const executablePath = process.env.PW_CHROME || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath } },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true },
  projects: [
    // Samsung Galaxy S23 Ultra in Chrome: 1440 x 3088 px at DPR 3.75 = 384 x 823 CSS px.
    { name: 's23-ultra', use: { viewport: { width: 384, height: 823 }, deviceScaleFactor: 3.75, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
})

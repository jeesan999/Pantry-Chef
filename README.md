# Personal Chef

An installable, offline-first web app for meal planning, nutrition targets, pantry and grocery costs.
All data stays on your device. No accounts, API keys or paid services. Once installed, the app makes
no network requests (a Content Security Policy blocks them).

## Status: Phase 5 (shopping list)

- 11 screens with navigation; Today, Plan, Recipes, Pantry, Goals & Targets, Progress (weigh-ins) and Settings work now;
  Scan Receipt, Expenses and Shopping List work too; Chef (Phase 6) is a labelled shell.
- Expenses: spending by week, month and year, by store, category and food type; weekly and monthly budgets with
  alerts (also on Today); manual expenses; price history; estimated cost per meal and per day; protein per dollar.
  The calculations are pure functions in `src/engines/cost/engine.ts`; meal costs use the latest price paid and are
  marked partial, never guessed, when an ingredient has no price yet.
- Shopping List: built from the meals planned for this week, next week or chosen days (plus the fixed breakfast),
  minus pantry stock that is still in date on the day of each meal, with estimated costs from your own prices.
  Tick items off, add extras; updating the list keeps both. Scanning a receipt ticks what it bought.
  The list builder is a pure function in `src/engines/shopping/engine.ts`. The automatic meal planner is Phase 8.
- 30-table IndexedDB database (Dexie) with foreign keys, validation, transactions and an append-only pantry ledger
  enforced in `src/db/repo.ts` and `src/db/pantry.ts`.
- Engine A (Nutrition) in `src/engines/nutrition/engine.ts`: pure functions, emits the `TargetSet` contract in
  `src/engines/contract.ts`. Targets are proposed, then approved; only approval assigns a version.
- 64 starter recipes across 8 cuisines plus the fixed breakfast (`src/data/recipes.ts`).

## Run it

```bash
npm install
npm run dev          # development server
npm test             # unit + database tests (Vitest, fake-indexeddb)
npm run build && PW_CHROME=/path/to/chrome npx playwright test   # browser tests, phone + desktop
```

## Import AFCD Release 3

Until this is done, foods use **interim** values (approximate, shown with an "approximate" badge).

1. Download the AFCD Release 3 nutrient file (Excel) from foodstandards.gov.au.
2. Run `node scripts/import-afcd.mjs "path/to/AFCD Release 3 - Nutrient profiles.xlsx"`.
3. Check the printed match report (each interim food and the AFCD food it maps to); edit
   `src/data/afcdMap.json` if a match is wrong.
4. Rebuild. On next start the app overwrites the interim values in place (recipes keep working) and adds every
   other AFCD food.

Nutrient data: Food Standards Australia New Zealand (2025), Australian Food Composition Database – Release 3,
used and adapted under its licence (attribution required; derived data shared under the same licence).

## Deploy to GitHub Pages

```bash
BASE_PATH=/<repo-name>/ npm run build
```

Publish the `dist/` folder to the `gh-pages` branch (or use a Pages workflow). Then open the site in Chrome on
the phone and choose **Install app**.

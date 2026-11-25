# Personal Chef

An installable, offline-first web app for meal planning, nutrition targets, pantry and grocery costs.
All data stays on your device. No accounts, API keys or paid services. Once installed, the app makes
no network requests (a Content Security Policy blocks them).

## Status: Phase 10 (backup & restore)

- 11 screens with navigation; Today, Plan, Recipes, Pantry, Goals & Targets, Progress (weigh-ins) and Settings work now;
  Scan Receipt, Expenses, Shopping List, Chef and Progress work too.
- Expenses: spending by week, month and year, by store, category and food type; weekly and monthly budgets with
  alerts (also on Today); manual expenses; price history; estimated cost per meal and per day; protein per dollar.
  The calculations are pure functions in `src/engines/cost/engine.ts`; meal costs use the latest price paid and are
  marked partial, never guessed, when an ingredient has no price yet.
- Shopping List: built from the meals planned for this week, next week or chosen days (plus the fixed breakfast),
  minus pantry stock that is still in date on the day of each meal, with estimated costs from your own prices.
  Tick items off, add extras; updating the list keeps both. Scanning a receipt ticks what it bought.
  The list builder is a pure function in `src/engines/shopping/engine.ts`. The automatic meal planner is Phase 8.
- Chef: type commands in your own words, e.g. “swap tonight’s dinner”, “something with salmon for lunch tomorrow”,
  “make tomorrow a rest day”, “train Saturday at 6am”, “use up what expires soon”, “what can I make with chicken
  and rice?”, “add milk to the shopping list”, “I threw out the spinach”, “I weigh 80.4 kg”, “what’s for dinner?”,
  “how much budget is left?”. A rule-based interpreter (`src/engines/chef/`) runs on the phone: no AI service, no
  network. Nothing changes until you tap “Do it”, and every change can be undone. Marking meals as eaten is a later
  phase.
- Progress: 7-day average weight (morning weigh-ins preferred), 4-week trend in kg/week, weight and waist charts,
  monthly table, target weight with progress and an estimated finish date, and delete for wrong entries. A targets
  check compares the trend with what your targets expect and, when they disagree by 100+ kcal a day, offers to
  recalibrate maintenance (activity factor, at most 10% a step; your goal % is unchanged). It assumes you ate to plan
  and only takes effect when you approve the proposal on Goals. Logic: `src/engines/progress/engine.ts`.
- Meal planner (Plan screen, or tell Chef “plan my week”): fills smoko, lunch and dinner for this or next week to
  fit each day’s targets (slot ranges, day totals, fibre and other limits), uses food dated soon first with simulated
  pantry stock, keeps variety (at most twice a week, never two days running), follows your recipe ratings, and only
  nudges towards cheaper meals. You get a draft: lock, swap or clear meals, then accept; undo is available. After new
  targets are approved, Today and Plan offer to re-portion upcoming meals. Rate recipes on their page or tell Chef
  (“I loved the salmon don”, “don’t suggest tacos again”). Logic: `src/engines/planner/engine.ts`.
- Eating log (Today, or tell Chef “I ate lunch”, “had half my dinner”, “skipped smoko”, “I had a banana”): mark
  meals eaten (all, ¾, half, ¼) or skipped, and add quick foods by amount. Food leaves the pantry soonest-dated first;
  the uneaten part of a cooked meal is recorded as leftover waste; missing stock never blocks. Nutrition and cost are
  frozen when logged, each day keeps a nutritional record, and every log can be undone. Today can step back 7 days and
  shows eaten or planned totals. Progress calibrates maintenance from real intake once 10 days are fully logged.
  Logic: `src/engines/eating/engine.ts`, `src/lib/eating.ts`. The database is now schema version 2.
- Backup & restore (Settings): a .zip of every table plus recipe photos and receipt images, with a manifest and
  SHA-256 checksums; “Data only (JSON)” and, where supported, “Share backup…”. Restoring checks the file (app, version,
  checksums, every row, every link), shows a preview, keeps a safety copy of what was there, then replaces all data in
  one transaction (rolled back on any problem); “Undo restore” brings the safety copy back. Older backups are upgraded
  on the way in; backups from a newer app are refused. Today reminds you when a backup is due (every 7 days by
  default), and Chef answers “back up my data”. Logic: `src/engines/backup/format.ts`, `src/lib/backup.ts`.
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

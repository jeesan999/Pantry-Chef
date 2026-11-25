import { expect, test, type Page } from '@playwright/test'

const SCREENS = ['Scan Receipt', 'Shopping List', 'Expenses', 'Progress', 'Goals & Targets', 'Chef', 'Settings']

let errors: string[] = []
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
})
test.afterEach(() => {
  expect(errors, 'no console errors').toEqual([])
})

async function approveTargets(page: Page) {
  await page.goto('/#/goals')
  await expect(page.getByText('awaiting approval')).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Current targets')).toBeVisible()
}

test('first run proposes 2,690 kcal maintenance; approval makes it v1', async ({ page }) => {
  await page.goto('/#/goals')
  await expect(page.getByText(/2,690 kcal\s*maintenance/)).toBeVisible()
  await expect(page.getByText(/add up to 127 g/)).toBeVisible()
  await expect(page.getByText('2,690 kcal').first()).toBeVisible() // every day, training or rest
  await expect(page.getByText('no limit').first()).toBeVisible() // saturated fat: tracked, not limited
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('v1', { exact: true })).toBeVisible()
  await expect(page.getByText('awaiting approval')).toHaveCount(0)
})

test('goal change: fat loss proposes 2,290 kcal and approval makes v2', async ({ page }) => {
  await approveTargets(page)
  await page.getByLabel('Goal type').selectOption('fat_loss')
  await page.getByRole('button', { name: 'Propose new targets for this goal' }).click()
  await expect(page.getByText(/−\s*15% for fat loss/)).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('v2', { exact: true })).toBeVisible()
})

test('Today: fixed breakfast plus a chosen lunch updates the totals', async ({ page }) => {
  await approveTargets(page)
  await page.goto('/#/')
  await expect(page.getByText('Fixed breakfast: eggs, avocado, bacon')).toBeVisible()
  const energy = page.getByRole('img', { name: /^Energy/ })
  const before = Number((await energy.getAttribute('aria-label'))!.match(/Energy (\d+)/)![1])
  expect(before).toBeGreaterThan(550)
  await page.getByRole('button', { name: 'Choose' }).nth(1).click() // lunch
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText(/Portions are scaled/)).toBeVisible()
  const first = sheet.getByRole('button').first()
  const name = (await first.locator('p').first().textContent())!
  await first.click()
  await expect(page.getByText(name)).toBeVisible()
  await expect.poll(async () => Number((await energy.getAttribute('aria-label'))!.match(/Energy (\d+)/)![1])).toBeGreaterThan(before + 300)
})

test('Recipes: 153 recipes, filter by cuisine, open and scale a recipe', async ({ page }) => {
  await page.goto('/#/recipes')
  await expect(page.getByText('153 recipes')).toBeVisible()
  await page.getByLabel('Cuisine').selectOption('Korean')
  await expect(page.locator('ul li a')).toHaveCount(15) // 8 original + 7 added
  await page.getByText('Beef bibimbap').click()
  await expect(page.getByRole('heading', { name: 'Beef bibimbap' })).toBeVisible()
  await expect(page.getByText('approximate')).toBeVisible()
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(page.getByText('1.5 servings', { exact: true })).toBeVisible()
  await expect(page.getByText(/Whole recipe at 1.5 servings/)).toBeVisible()
})

test('Pantry: add, use, undo; ledger history is kept', async ({ page }) => {
  await page.goto('/#/pantry')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByLabel('What did you buy?').fill('Chicken breast fillets')
  await page.getByRole('button', { name: /Add “Chicken breast fillets” as a new item/ }).click()
  await page.getByLabel('Quantity').fill('1000')
  await page.getByLabel('Total paid ($)').fill('12.50')
  await page.getByRole('button', { name: 'Add to pantry' }).click()
  await expect(page.getByText('Chicken breast fillets')).toBeVisible()
  await expect(page.getByText(/\$12\.50 at cost/)).toBeVisible()
  await page.getByText('Chicken breast fillets').click()
  await page.getByLabel(/Amount/).fill('300')
  await page.getByRole('button', { name: 'Use', exact: true }).click()
  await expect(page.getByText(/700 g left/)).toBeVisible()
  await expect(page.getByText(/Used -300 g/)).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(page.getByText(/1000 g left/)).toBeVisible()
  await expect(page.getByText(/Undone \+300 g/)).toBeVisible()
})

test('Plan: any day can be switched between training and rest, without re-approval', async ({ page }) => {
  await approveTargets(page)
  await page.goto('/#/plan')
  const sub = page.locator('header h1 + div')
  const count = async () => Number((await sub.textContent())!.match(/(\d) training/)![1])
  const groups = page.getByRole('group', { name: 'Day type' })
  await expect(groups).toHaveCount(7)
  const before = await count()
  // find a rest day and make it a training day
  let idx = -1
  for (let i = 0; i < 7; i++) if ((await groups.nth(i).getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')) === 'true') { idx = i; break }
  expect(idx).toBeGreaterThanOrEqual(0)
  await groups.nth(idx).getByRole('button', { name: 'Training' }).click()
  await expect.poll(count).toBe(before + 1)
  // and a training day back to rest
  await groups.nth(idx).getByRole('button', { name: 'Rest' }).click()
  await expect.poll(count).toBe(before)
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.locator('h1')).toHaveText('Next week')
  await page.goto('/#/goals')
  await expect(page.getByText('v1', { exact: true })).toBeVisible()
  await expect(page.getByText('awaiting approval')).toHaveCount(0)
})

test('Today: switch today to rest and back', async ({ page }) => {
  await approveTargets(page)
  await page.goto('/#/')
  const group = page.getByRole('group', { name: 'Day type' })
  await group.getByRole('button', { name: 'Rest' }).click()
  await expect(group.getByRole('button', { name: 'Rest' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/easy to digest/)).toHaveCount(0)
  await group.getByRole('button', { name: /^Training/ }).click()
  await expect(group.getByRole('button', { name: /^Training/ })).toHaveAttribute('aria-pressed', 'true')
  // symbols show amount, target and status in words; the overview lists every nutrient with its difference
  await expect(page.getByRole('img', { name: /^Protein \d+ of \d+ g, \d+%, (low|on track|reached|over)$/ })).toBeVisible()
  await page.getByText(/^Nutrition overview/).click()
  const overview = page.getByRole('table', { name: /nutrition for/ })
  await expect(overview.getByText('Carbs (daily minimum)')).toBeVisible()
  for (const n of ['Calories', 'Fibre', 'Saturated fat', 'Added sugar']) await expect(overview.getByRole('rowheader', { name: new RegExp(`^${n}`) })).toBeVisible()
  await expect(overview.getByText(/natural · .* added/)).toBeVisible()
  await expect(overview.getByText(/significantly below|slightly below|on target|above/).first()).toBeVisible()
})

async function addToPantry(page: Page, name: string, qty: string, cost: string) {
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByLabel('What did you buy?').fill(name)
  await page.getByRole('button', { name: new RegExp(`Add “${name}” as a new item`) }).click()
  await page.getByLabel('Quantity').fill(qty)
  await page.getByLabel('Total paid ($)').fill(cost)
  await page.getByRole('button', { name: 'Add to pantry' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('groceries by their receipt names link to foods and drive recipe suggestions', async ({ page }) => {
  await page.goto('/#/pantry')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByLabel('What did you buy?').fill('Chicken Breast Fillets 1kg')
  await page.getByRole('button', { name: /Add “Chicken Breast Fillets 1kg” as a new item/ }).click()
  await expect(page.getByText('Matched from the name; tap to change.')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Chicken, breast, lean flesh, raw')).toBeVisible()
  await page.getByRole('dialog').press('Escape')
  await addToPantry(page, 'Chicken Breast Fillets 1kg', '1000', '13')
  await addToPantry(page, 'Jasmine Rice 1kg', '1000', '3.50')
  await expect(page.getByText('Cook from your pantry')).toBeVisible()
  await expect(page.getByText(/% in stock/).first()).toBeVisible()
  await page.goto('/#/recipes')
  await page.getByText(/^From my pantry/).click()
  const cards = page.locator('ul li a')
  expect(await cards.count()).toBeGreaterThan(0)
  await expect(cards.first().getByText(/% in stock/)).toBeVisible()
})

test('manual entry: type-ahead suggests foods and sauces; add several in a row', async ({ page }) => {
  await page.goto('/#/pantry')
  await page.getByRole('button', { name: 'Add' }).click()
  const box = page.getByLabel('What did you buy?')
  await box.fill('soy')
  const list = page.getByRole('listbox', { name: 'Suggestions' })
  await expect(list.getByRole('option').first()).toContainText('Soy sauce')
  await list.getByRole('button', { name: /Soy sauce/ }).first().click()
  await expect(page.getByText(/From the food list: Sauce, soy/)).toBeVisible()
  await expect(page.getByLabel('Unit')).toHaveValue('ml') // a liquid defaults to ml
  await page.getByLabel('Quantity').fill('250')
  await page.getByLabel('Total paid ($)').fill('4')
  await page.getByRole('button', { name: 'Add and enter another' }).click()
  await expect(page.getByText('Added 1: Soy sauce, reduced salt')).toBeVisible()
  await page.getByLabel('What did you buy?').fill('mayo')
  await expect(list.getByRole('option').first()).toContainText('Mayonnaise')
  await page.getByLabel('What did you buy?').fill('chick')
  await list.getByRole('button', { name: /^Chicken breast/ }).click()
  await expect(page.getByLabel('Location')).toHaveValue('fridge')
  await page.getByLabel('Quantity').fill('500')
  await page.getByRole('button', { name: 'Add to pantry', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Soy sauce, reduced salt')).toBeVisible()
  await expect(page.getByText('Chicken breast', { exact: true })).toBeVisible()
  // the second time, it is offered as bought before
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByLabel('What did you buy?').fill('soy')
  await expect(list.getByRole('option').first()).toContainText('bought before')
})

test('scan a receipt photo: read on the phone, check, save to pantry; the same photo is refused next time', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/#/scan')
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByLabel('Store')).toHaveValue('Woolworths')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-11-25')
  await expect(page.getByText(/\$49\.88 ✓/)).toBeVisible() // lines add up to the total
  const names = await page.getByLabel('Name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  expect(names).toEqual(expect.arrayContaining(['Bananas Cavendish', 'Chicken Breast Fillets 1kg', 'Jasmine Rice 2kg']))
  // dish liquid is not food: unticked
  const dish = page.locator('section', { has: page.getByText(/^Receipt: .*Fairy Dish Liquid/) })
  await expect(dish.getByRole('checkbox', { name: 'Food: add to my pantry' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Save to pantry and expenses' }).click()
  await expect(page.getByText(/6 items added to your pantry from Woolworths/)).toBeVisible()
  await page.getByRole('button', { name: 'Scan another' }).click()
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText(/This photo was already added: Woolworths/)).toBeVisible()
  await page.goto('/#/pantry')
  await expect(page.getByText('Chicken Breast Fillets 1kg')).toBeVisible()
  await expect(page.getByText('Cook from your pantry')).toBeVisible()
  // the receipt is in Expenses: total for its month, household split, a price, a protein-per-dollar row
  await page.goto('/#/expenses')
  await page.getByRole('radio', { name: 'Month' }).click()
  while (!(await page.getByText(/^Nov 2026/).isVisible())) await page.getByRole('button', { name: 'Previous period' }).click()
  await expect(page.getByTestId('period-total')).toHaveText('$49.88')
  await page.getByRole('radio', { name: 'Category' }).click()
  await expect(page.getByText('$6.50 · 13%')).toBeVisible() // household share
  await expect(page.getByText(/after discounts · 1 purchase/)).toBeVisible() // price history
  await expect(page.getByText(/g \/ \$/).first()).toBeVisible()
})

test('Shopping list: build from planned meals, tick, add an extra, kept on reload, ticked by a scanned receipt', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.setFixedTime(new Date('2026-11-26T10:00:00'))
  await approveTargets(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Choose' }).nth(1).click() // lunch
  await page.getByRole('dialog').getByRole('button').first().click()
  await page.goto('/#/shopping')
  await expect(page.getByText(/Meals from Thu, 26 Nov to Sun, 29 Nov/)).toBeVisible()
  await page.getByRole('button', { name: 'Build list' }).click()
  await expect(page.getByRole('status')).toHaveText(/Built from 1 planned meal and 4 breakfasts: \d+ to buy/)
  await expect(page.getByRole('heading', { name: 'Dairy & eggs' })).toBeVisible()
  const avocado = page.getByRole('checkbox', { name: /^Avocado/ })
  await expect(avocado).toBeVisible()
  const eggs = page.getByRole('checkbox', { name: /^Eggs/ })
  await eggs.check()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('What do you need?').fill('Dish liquid')
  await page.getByRole('button', { name: 'Add “Dish liquid”' }).click()
  await expect(page.getByText('Added: Dish liquid')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /^Eggs/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Dish liquid/ })).toBeVisible()
  // updating keeps the tick and the extra
  await page.getByRole('button', { name: 'Update list' }).click()
  await expect(page.getByRole('checkbox', { name: /^Eggs/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Dish liquid/ })).toBeVisible()
  // scanning the receipt ticks the avocado it bought
  await page.goto('/#/scan')
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Save to pantry and expenses' }).click()
  await expect(page.getByText(/Ticked \d+ items? on your shopping list/)).toBeVisible()
  await page.getByRole('link', { name: 'shopping list', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: /^Avocado/ })).toBeChecked()
})

test('Progress: trend from 4 weeks of weigh-ins, calibration proposed and approved, goal target, delete', async ({ page }) => {
  // fat loss approved on 20 Oct
  await page.clock.setFixedTime(new Date('2026-10-20T08:00:00'))
  await approveTargets(page)
  await page.getByLabel('Goal type').selectOption('fat_loss')
  await page.getByRole('button', { name: 'Propose new targets for this goal' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('v2', { exact: true })).toBeVisible()
  const before = await page.getByText(/kcal\s*maintenance/).first().textContent()
  // 29 mornings of flat weight up to 26 Nov, written straight to the app's database
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('personal-chef'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
    const tx = db.transaction('weight_measurements', 'readwrite')
    for (let i = 0; i < 29; i++) {
      const d = new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10)
      tx.objectStore('weight_measurements').put({ id: `w${i}`, profileId: 'profile:me', date: d, weightKg: i % 2 ? 81.3 : 80.9, timeOfDay: 'morning' })
    }
    await new Promise((ok) => { tx.oncomplete = ok })
    db.close()
  })
  await page.clock.setFixedTime(new Date('2026-11-26T08:00:00'))
  await page.goto('/#/progress')
  await page.reload()
  await expect(page.getByTestId('avg-weight')).toHaveText(/^81\.\d kg$/)
  await expect(page.getByTestId('trend')).toHaveText('steady')
  await expect(page.getByRole('img', { name: /Weight chart: \d+ weigh-ins/ })).toBeVisible()
  // flat weight on a deficit: maintenance was overestimated
  await expect(page.getByText(/your targets would give losing/)).toBeVisible()
  await page.getByRole('button', { name: 'Propose new targets' }).click()
  await page.getByRole('link', { name: 'Review and approve them on Goals' }).click()
  await expect(page.getByText(/assumes you ate to plan/)).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('v3', { exact: true })).toBeVisible()
  await expect(page.getByText(/calibrated from your weight trend/)).toBeVisible()
  expect(await page.getByText(/kcal\s*maintenance/).first().textContent()).not.toBe(before)
  // goal target
  await page.goto('/#/progress')
  await page.getByRole('button', { name: 'Set a target' }).click()
  await page.getByLabel('Target weight (kg)').fill('78')
  await page.getByRole('button', { name: 'Save targets' }).click()
  await expect(page.getByText(/kg to go/)).toBeVisible()
  await expect(page.getByText(/trend isn’t heading towards the target/)).toBeVisible()
  // delete a weigh-in
  await expect(page.getByRole('button', { name: 'Show all 29' })).toBeVisible()
  await page.getByRole('button', { name: /^Delete 8\d\.\d kg on/ }).first().click()
  await expect(page.getByRole('button', { name: 'Show all 28' })).toBeVisible()
})

test('Planner: draft, lock, swap, accept, undo; ratings keep a recipe out; Chef plans next week; re-portion after new targets', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(new Date('2026-11-23T07:00:00')) // Monday morning: the whole week is ahead
  await approveTargets(page)
  await page.goto('/#/plan')
  await page.getByRole('button', { name: 'Plan this week' }).click()
  await expect(page.getByText('Draft plan')).toBeVisible()
  await expect(page.getByText(/^21 meals suggested/)).toBeVisible()
  await expect(page.getByText('suggested', { exact: true })).toHaveCount(21)
  // lock Monday's smoko, swap Monday's lunch
  const monLunch = page.getByTestId('slot-2026-11-23|lunch')
  await page.getByRole('button', { name: 'Lock Smoko on Mon, 23 Nov' }).click()
  await expect(page.getByTestId('slot-2026-11-23|smoko').getByText('locked')).toBeVisible()
  await expect(page.getByText('suggested', { exact: true })).toHaveCount(20) // the draft has re-planned around the lock
  const before = await monLunch.locator('span.block').first().textContent()
  await page.getByRole('button', { name: 'Swap Lunch on Mon, 23 Nov' }).click()
  await expect(monLunch.locator('span.block').first()).not.toHaveText(before!)
  await page.getByRole('button', { name: 'Accept plan' }).click()
  await expect(page.getByText(/Plan saved: 21 meals/)).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText('Nothing chosen yet.')).toHaveCount(0)
  await page.goto('/#/plan')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText(/Undone: the week is as it was/)).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText('Nothing chosen yet.')).toHaveCount(3)

  // "Don't suggest" keeps a recipe out of plans
  await page.goto('/#/recipes/recipe:au-chicken-rice-bowl')
  await page.getByRole('button', { name: 'Don’t suggest' }).click()
  await expect(page.getByRole('button', { name: '✓ Don’t suggest' })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/#/plan')
  await page.getByRole('button', { name: 'Plan this week' }).click()
  await expect(page.getByText(/^21 meals suggested/)).toBeVisible()
  await expect(page.getByText('Lemon chicken, rice and greens bowl')).toHaveCount(0)
  await page.getByRole('button', { name: 'Discard' }).click()

  // Chef plans next week
  await page.goto('/#/chef')
  await page.getByLabel('Message Chef').fill('plan next week')
  await page.getByLabel('Message Chef').press('Enter')
  await expect(page.getByText(/^Plan 21 meals, Mon 30 Nov to Sun 6 Dec\?$/)).toBeVisible()
  await page.getByRole('button', { name: 'Do it' }).click()
  await expect(page.getByText(/Planned 21 meals/)).toBeVisible()

  // new targets: upcoming meals were portioned for the old ones
  await page.goto('/#/goals')
  await page.getByLabel('Goal type').selectOption('muscle_gain')
  await page.getByRole('button', { name: 'Propose new targets for this goal' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('v2', { exact: true })).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText(/Your targets changed \(now v2\)\. 21 upcoming meals/)).toBeVisible()
  await page.getByRole('button', { name: 'Re-portion upcoming meals' }).click()
  await expect(page.getByText(/Re-portioned \d+ meals? for your new targets/)).toBeVisible()
})

test('Plan: 4-day view, generate, copy/change/clear/suggest a meal with undo, bulk prep, generate shopping list, edit the list', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(new Date('2026-11-26T07:00:00')) // Thursday morning
  await approveTargets(page)
  await page.goto('/#/plan')
  await page.getByRole('radio', { name: '4 days' }).click()
  await expect(page.locator('h1')).toHaveText('Next 4 days')
  await expect(page.getByRole('group', { name: 'Day type' })).toHaveCount(4)
  await page.getByRole('button', { name: 'Plan 4 days' }).click()
  await expect(page.getByText(/^12 meals suggested/)).toBeVisible()
  await page.getByRole('button', { name: 'Accept plan' }).click()
  await expect(page.getByText(/Plan saved: 12 meals/)).toBeVisible()
  const thuLunch = page.getByTestId('meal-2026-11-26|lunch')
  await expect(thuLunch.getByText(/\d+ to buy|in pantry/)).toBeVisible()
  await expect(page.getByLabel('Planned totals for Thu, 26 Nov')).toContainText('Protein')
  await expect(page.getByText('From your pantry')).toBeVisible()

  // copy Thursday's lunch to the other three days, then undo
  const name = (await thuLunch.getByRole('link').textContent())!
  await page.getByRole('button', { name: 'Options for Lunch on Thu, 26 Nov' }).click()
  await page.getByRole('button', { name: 'Copy to other days' }).click()
  await page.getByRole('button', { name: 'Copy to 3 days' }).click()
  await expect(page.getByRole('status')).toContainText('Copied to 3 days')
  await expect(page.getByTestId('meal-2026-11-29|lunch').getByRole('link')).toHaveText(name)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Change undone.')).toBeVisible()
  await expect(page.getByTestId('meal-2026-11-29|lunch').getByRole('link')).not.toHaveText(name)

  // change via the recipe browser: filters, missing ingredients shown before choosing
  await page.getByRole('button', { name: 'Options for Dinner on Fri, 27 Nov' }).click()
  await page.getByRole('button', { name: 'Change recipe' }).click()
  await expect(page.getByText(/Still needed that day/)).toBeVisible()
  await page.getByRole('radio', { name: 'All in pantry' }).click()
  await expect(page.getByText(/^0 recipes/)).toBeVisible() // empty pantry
  await page.getByRole('radio', { name: 'Needs shopping' }).click()
  await page.getByLabel('Search recipes').fill('galbi')
  await expect(page.getByText(/Missing: /).first()).toBeVisible()
  await page.getByRole('button', { name: /^Choose Galbi/ }).first().click()
  await expect(page.getByRole('status')).toContainText('Dinner on Fri, 27 Nov set.')
  await expect(page.getByTestId('meal-2026-11-27|dinner').getByRole('link')).toContainText(/Galbi/)

  // leave a meal unplanned, then ask for a suggestion
  await page.getByRole('button', { name: 'Options for Smoko on Sat, 28 Nov' }).click()
  await page.getByRole('button', { name: 'Leave unplanned' }).click()
  await expect(page.getByTestId('meal-2026-11-28|smoko')).toContainText('Not planned')
  await page.getByRole('button', { name: 'Suggest Smoko on Sat, 28 Nov' }).click()
  await expect(page.getByTestId('meal-2026-11-28|smoko').getByRole('link')).toBeVisible()

  // bulk prep: combined ingredients, cook schedule, list for those meals
  await page.getByRole('button', { name: 'Bulk prep' }).click()
  await expect(page.getByRole('heading', { name: 'Ingredients, combined' })).toBeVisible()
  await expect(page.getByText(/servings? for/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Shopping list for these meals' }).click()
  await expect(page).toHaveURL(/#\/shopping/)
  await expect(page.getByRole('status')).toContainText(/Built from \d+ planned meals?/)

  // weekly list from the plan, then edit it
  await page.goto('/#/plan')
  await page.getByRole('button', { name: 'Generate shopping list' }).click()
  await expect(page.getByRole('status')).toContainText(/Built from 12 planned meals and 4 breakfasts/)
  const first = page.getByRole('button', { name: /^Change amount of / }).first()
  const item = (await first.getAttribute('aria-label'))!.replace('Change amount of ', '')
  await first.click()
  await page.getByLabel(/^Amount/).fill('999')
  await page.getByRole('button', { name: 'Save amount' }).click()
  await expect(page.getByText('amount changed by you')).toBeVisible()
  await page.getByRole('button', { name: `Remove ${item}` }).click()
  await expect(page.getByText(/1 plan item removed by you/)).toBeVisible()
  await page.getByRole('button', { name: 'Put back' }).click()
  await expect(page.getByRole('button', { name: `Remove ${item}` })).toBeVisible()
  // nothing was taken from the pantry
  await page.goto('/#/pantry')
  await expect(page.getByText(/Used -/)).toHaveCount(0)
})

test('Eating: half a lunch from the pantry with leftover waste, undo, a snack, yesterday’s breakfast, Chef “I had a banana”', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.setFixedTime(new Date('2026-11-26T15:00:00'))
  await approveTargets(page)
  await page.goto('/#/scan')
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Save to pantry and expenses' }).click()
  await expect(page.getByText(/items added to your pantry/)).toBeVisible()

  await page.goto('/#/')
  await page.getByRole('button', { name: 'Choose' }).nth(1).click() // lunch
  await page.getByRole('dialog').getByRole('button', { name: /Lemon chicken, rice and greens bowl/ }).click()
  await page.getByRole('button', { name: 'Mark Lunch eaten' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('radio', { name: 'Half' }).click()
  await expect(sheet.getByText('From your pantry')).toBeVisible()
  await expect(sheet.getByText(/Chicken breast: 1\d\d g/)).toBeVisible()
  await expect(sheet.getByText(/leftover waste/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText('eaten · Half')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Eaten', checked: true })).toBeVisible()
  await page.goto('/#/expenses')
  const thrown = page.getByText('Food thrown out', { exact: true }).locator('xpath=following-sibling::dd')
  await expect(thrown).not.toHaveText('$0.00')
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Undo Lunch' }).click()
  await expect(page.getByText('eaten · Half')).toHaveCount(0)
  await page.goto('/#/expenses')
  await expect(thrown).toHaveText('$0.00')

  // a snack from the pantry
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Add food' }).click()
  await page.getByLabel('Search foods').fill('banana')
  await page.getByRole('option', { name: /Bananas Cavendish/ }).click()
  await expect(page.getByText(/From my pantry/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Added: Bananas Cavendish')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Undo Bananas Cavendish' })).toBeVisible()

  // yesterday's breakfast
  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.locator('h1')).toHaveText('Yesterday')
  await page.getByRole('button', { name: 'Mark Breakfast eaten' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText('eaten', { exact: true })).toBeVisible()

  // Chef logs a quick food
  await page.goto('/#/chef')
  await page.getByLabel('Message Chef').fill('I had a banana')
  await page.getByLabel('Message Chef').press('Enter')
  await expect(page.getByText(/^Log 1 .*banana.* as a snack\?$/i)).toBeVisible()
  await page.getByRole('button', { name: 'Do it' }).click()
  await expect(page.getByText(/^Logged .*banana.*kcal/i)).toBeVisible()
})

test('Backup: zip with a photo, restore brings deleted data back, undo restore, a damaged file is refused, reminder', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.clock.setFixedTime(new Date('2026-11-26T09:00:00'))
  await approveTargets(page)
  // a weigh-in and a recipe photo
  await page.goto('/#/progress')
  await page.getByLabel('Weight (kg)').fill('80.4')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Delete 80\.4 kg/ })).toBeVisible()
  await page.goto('/#/recipes/recipe:au-chicken-rice-bowl')
  await page.locator('input[type=file]').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByRole('img', { name: 'Lemon chicken, rice and greens bowl' })).toBeVisible()

  // back up
  await page.goto('/#/settings')
  await expect(page.getByTestId('last-backup')).toHaveText('never')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Back up now (with photos)' }).click()
  const file = info.outputPath('backup.zip')
  await (await dl).saveAs(file)
  await expect(page.getByText(/Saved personal-chef-backup-2026-11-26\.zip/)).toBeVisible()
  await expect(page.getByTestId('last-backup')).not.toHaveText('never')

  // lose some data, then restore
  await page.goto('/#/progress')
  await page.getByRole('button', { name: /^Delete 80\.4 kg/ }).click()
  await expect(page.getByText('No measurements yet', { exact: false })).toBeVisible()
  await page.goto('/#/settings')
  await page.getByLabel('Choose a backup file').setInputFiles(file)
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Restore this backup?')).toBeVisible()
  await expect(sheet.getByRole('row', { name: /Weigh-ins 1 0/ })).toBeVisible()
  await expect(sheet.getByText(/1 photo/)).toBeVisible()
  await sheet.getByLabel('Type REPLACE to confirm').fill('replace')
  await sheet.getByRole('button', { name: 'Replace all data on this phone' }).click()
  await expect(page.getByText(/^Restored\./)).toBeVisible()
  await page.goto('/#/progress')
  await expect(page.getByRole('button', { name: /^Delete 80\.4 kg/ })).toBeVisible()
  await page.goto('/#/recipes/recipe:au-chicken-rice-bowl')
  await expect(page.getByRole('img', { name: 'Lemon chicken, rice and greens bowl' })).toBeVisible() // the photo came back

  // undo the restore: back to the state just before it (no weigh-in)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Undo restore' }).click()
  await expect(page.getByText('Your data is back as it was before the restore.')).toBeVisible()
  await page.goto('/#/progress')
  await expect(page.getByText('No measurements yet', { exact: false })).toBeVisible()

  // a damaged file changes nothing
  const bad = info.outputPath('bad.zip')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(bad, 'PK this is not really a zip')
  await page.goto('/#/settings')
  await page.getByLabel('Choose a backup file').setInputFiles(bad)
  await expect(page.getByText('This backup can’t be restored')).toBeVisible()
  await expect(page.getByText('Nothing on this phone was changed.')).toBeVisible()

  // a week and a day later, Today reminds
  await page.clock.setFixedTime(new Date('2026-12-04T09:00:00'))
  await page.goto('/#/')
  await page.reload()
  await expect(page.getByText('Last backup 8 days ago.')).toBeVisible()
})

test('Appearance: theme and night mode persist across reloads; system mode follows the device; quick toggle', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/#/settings')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-mode', 'light') // default: follow the system
  await page.getByRole('radio', { name: /^Midnight theme/ }).click()
  await page.getByRole('radio', { name: 'Night', exact: true }).click()
  await expect(html).toHaveAttribute('data-theme', 'midnight')
  await expect(html).toHaveAttribute('data-mode', 'dark')
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await expect.poll(bg).toBe('rgb(10, 14, 26)') // after the short colour fade
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'midnight')
  await expect(html).toHaveAttribute('data-mode', 'dark')
  await expect.poll(bg).toBe('rgb(10, 14, 26)') // after the short colour fade
  await expect(page.getByRole('radio', { name: /^Midnight theme/ })).toHaveAttribute('aria-checked', 'true')

  // system mode tracks the device as it changes
  await page.getByRole('radio', { name: 'System', exact: true }).click()
  await expect(html).toHaveAttribute('data-mode', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(html).toHaveAttribute('data-mode', 'dark')

  // one-tap toggle from the navigation (More on phones, sidebar on wide screens)
  await page.goto('/#/')
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(html).toHaveAttribute('data-mode', 'light')
})

test('Suggestions and pantry check: suggested lunch, use it, missing ingredients highlighted, add to list; nothing deducted', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.setFixedTime(new Date('2026-11-26T12:30:00'))
  await approveTargets(page)
  await page.goto('/#/scan')
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Save to pantry and expenses' }).click()
  await expect(page.getByText(/items added to your pantry/)).toBeVisible()
  const stock = async () => page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok) => { const r = indexedDB.open('personal-chef'); r.onsuccess = () => ok(r.result) })
    const rows: Array<{ id: string; remaining: number }> = await new Promise((ok) => { const q = db.transaction('inventory_lots').objectStore('inventory_lots').getAll(); q.onsuccess = () => ok(q.result) })
    db.close()
    return JSON.stringify(rows.map((r) => [r.id, r.remaining]).sort())
  })
  const before = await stock()

  await page.goto('/#/')
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Suggested for lunch' }) })
  await expect(card.getByText(/Still needed today:/)).toBeVisible()
  await expect(card.getByRole('button')).toHaveCount(3)
  await expect(card.getByText(/All in pantry|\d+ to buy/).first()).toBeVisible()
  const name = (await card.getByRole('button').first().locator('span.truncate').textContent())!
  await card.getByRole('button').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('columnheader', { name: 'Pantry' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Use for lunch' }).click()
  await expect(page.locator('section', { has: page.getByText('Lunch', { exact: true }) }).getByText(name)).toBeVisible()

  // the lunch card's pantry chip opens the ingredient check; add what's missing to the list
  await page.getByRole('button', { name: `Pantry check for ${name}` }).click()
  const missing = sheet.getByText('Missing', { exact: true })
  if (await missing.count()) {
    await expect(missing.first()).toBeVisible()
    await sheet.getByRole('button', { name: /^Add \d+ missing to shopping list$/ }).click()
    await expect(sheet.getByText(/^Added \d+ items? to your shopping list\.$/)).toBeVisible()
  }
  await page.keyboard.press('Escape')

  // the recipe page shows the same check
  await page.goto('/#/recipes/recipe:au-chicken-rice-bowl')
  const row = (n: string) => page.getByRole('row', { name: new RegExp(`^(available|partly available|missing) ${n}`) })
  await expect(row('Chicken breast')).toContainText('Available')
  await expect(row('Broccoli')).toContainText('Missing')
  await page.getByRole('link', { name: 'Show recipes I can make now' }).click()
  await expect(page.getByRole('checkbox', { name: /Can make now/ })).toBeChecked()

  // looking, suggesting and adding to a list took nothing from the pantry
  expect(await stock()).toBe(before)
})

async function tellChef(page: Page, text: string) {
  await page.getByLabel('Message Chef').fill(text)
  await page.getByLabel('Message Chef').press('Enter')
}

test('Chef: rest day with confirm and undo, swap a meal, add to the shopping list, not understood', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-26T10:00:00')) // Thursday; Friday is a usual training day
  await approveTargets(page)
  await page.goto('/#/chef')
  await expect(page.getByRole('button', { name: 'Make tomorrow a rest day' })).toBeVisible() // starter chip
  await tellChef(page, 'make tomorrow a rest day')
  await expect(page.getByText('Make tomorrow a rest day?')).toBeVisible()
  await expect(page.getByText(/Tomorrow: training .* → rest/)).toBeVisible()
  await page.getByRole('button', { name: 'Do it' }).click()
  await expect(page.getByText(/Tomorrow is now a rest day/)).toBeVisible()
  await page.goto('/#/plan')
  await expect(page.getByText(/3 training, 4 rest/)).toBeVisible()
  // the conversation and its undo survive switching screens
  await page.goto('/#/chef')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText(/Tomorrow is back to training/)).toBeVisible()
  await page.goto('/#/plan')
  await expect(page.getByText(/4 training, 3 rest/)).toBeVisible()

  await page.goto('/#/chef')
  await tellChef(page, "swap tonight's dinner")
  const options = page.getByRole('log').locator(':scope > li').last().getByRole('button')
  await expect(options).toHaveCount(3)
  const pick = (await options.nth(1).locator('span').first().textContent())!
  await options.nth(1).click()
  await expect(page.getByText(`${pick} is on tonight’s dinner`, { exact: false })).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText(pick, { exact: true })).toBeVisible()

  await page.goto('/#/chef')
  await tellChef(page, 'add milk to the shopping list')
  await page.getByRole('button', { name: 'Do it' }).last().click()
  await expect(page.getByText(/Added .*milk.* to the shopping list/i)).toBeVisible()
  await page.goto('/#/shopping')
  await expect(page.getByRole('checkbox', { name: /milk/i })).toBeVisible()

  await page.goto('/#/chef')
  await tellChef(page, 'chicken')
  await expect(page.getByText(/didn’t understand/)).toBeVisible()
  await expect(page.getByRole('log').locator(':scope > li').last().getByRole('button')).toHaveCount(3)
})

test('Expenses: add by hand, set a budget, get warned on Today, delete', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-26T10:00:00'))
  await page.goto('/#/expenses')
  await expect(page.getByTestId('period-total')).toHaveText('$0.00')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Where').fill('Farmers market')
  await page.getByLabel('Amount ($)').fill('1234.5')
  await page.getByLabel('Category').selectOption('Groceries')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByTestId('period-total')).toHaveText('$1,234.50')
  await page.getByRole('button', { name: 'Set budget' }).click()
  await page.getByLabel('Weekly budget ($)').fill('1000')
  await page.getByRole('button', { name: 'Save budgets' }).click()
  await expect(page.getByText(/Over this week's budget by \$234\.50/)).toBeVisible()
  await expect(page.getByText('over budget')).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText(/Over this week's budget/)).toBeVisible()
  await page.getByRole('link', { name: 'See expenses' }).click()
  await page.getByRole('button', { name: /Delete Farmers market/ }).click()
  await expect(page.getByTestId('period-total')).toHaveText('$0.00')
  await expect(page.getByText(/Over this week's budget/)).toHaveCount(0)
})

test('scan a hard photo (faded, tilted, shadowed): still reads the shop correctly', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/#/scan')
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-coles-hard.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByLabel('Store')).toHaveValue('Coles')
  await expect(page.getByText(/\$25\.23 ✓/)).toBeVisible()
})

test('receipt scanning works with the network off (after install)', async ({ page, context }) => {
  test.setTimeout(120_000)
  await page.goto('/#/scan')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // wait until the OCR engine and English model are in the offline cache
  await expect.poll(async () => page.evaluate(async () => {
    const keys = await caches.keys()
    for (const k of keys) {
      const c = await caches.open(k)
      const urls = (await c.keys()).map((r) => r.url)
      if (urls.some((u) => u.includes('eng.traineddata.gz')) && urls.some((u) => u.includes('relaxedsimd-lstm'))) return true
    }
    return false
  }), { timeout: 60_000 }).toBe(true)
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await page.getByLabel('Choose a receipt photo').setInputFiles('e2e/fixtures/test-receipt-woolworths.jpg')
  await expect(page.getByText('Check the receipt')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/\$49\.88 ✓/)).toBeVisible()
  await context.setOffline(false)
})

test('all 11 screens open from the navigation', async ({ page }) => {
  await page.goto('/#/')
  const wide = (page.viewportSize()?.width ?? 0) >= 1024 // wide screens: sidebar with every screen; phones: bottom bar + More
  for (const n of ['Plan', 'Recipes', 'Pantry', 'Today']) {
    await page.getByRole('navigation').getByRole('link', { name: n }).click()
    await expect(page.locator('h1')).toBeVisible()
  }
  for (const s of SCREENS) {
    if (wide) await page.getByRole('navigation').getByRole('link', { name: s }).click()
    else {
      await page.getByRole('button', { name: 'More' }).click()
      await page.getByRole('dialog').getByRole('button', { name: s }).click()
    }
    await expect(page.locator('h1')).toHaveText(s === 'Goals & Targets' ? 'Goals & Targets' : s)
  }
})

test('Settings: profile shows 5 ft 11 in and confirming clears the banner', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByText('5 ft 11 in')).toBeVisible()
  await expect(page.getByText('Age 41')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and save profile' }).click()
  await expect(page.getByText(/Saved\./).first()).toBeVisible()
  await page.getByRole('button', { name: 'Check data integrity' }).click()
  await expect(page.getByText('All links between records are sound.')).toBeVisible()
})

test('works offline after install', async ({ page, context }) => {
  await page.goto('/#/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('h1')).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('h1')).toHaveText('Today')
  await page.goto('/#/recipes')
  await expect(page.getByText('153 recipes')).toBeVisible()
  await context.setOffline(false)
})

test('Content Security Policy blocks calls to outside servers', async ({ page }) => {
  await page.goto('/#/')
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return 'reached'
    } catch {
      return 'blocked'
    }
  })
  expect(result).toBe('blocked')
  errors = errors.filter((e) => !/Content Security Policy|example\.com|Failed to fetch/.test(e))
})

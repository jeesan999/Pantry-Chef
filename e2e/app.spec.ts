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

test('Recipes: 65 recipes, filter by cuisine, open and scale a recipe', async ({ page }) => {
  await page.goto('/#/recipes')
  await expect(page.getByText('65 recipes')).toBeVisible()
  await page.getByLabel('Cuisine').selectOption('Korean')
  await expect(page.locator('ul li a')).toHaveCount(8)
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
  const sub = page.locator('header p')
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
  await expect(page.getByText('Carbs (daily minimum)')).toBeVisible()
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

test('all 11 screens open from the navigation', async ({ page }) => {
  await page.goto('/#/')
  for (const n of ['Plan', 'Recipes', 'Pantry', 'Today']) {
    await page.getByRole('navigation').getByRole('link', { name: n }).click()
    await expect(page.locator('h1')).toBeVisible()
  }
  for (const s of SCREENS) {
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('dialog').getByRole('button', { name: s }).click()
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
  await expect(page.getByText('65 recipes')).toBeVisible()
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

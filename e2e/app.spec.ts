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
  await expect(page.getByText('2,838 kcal').first()).toBeVisible()
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
  await page.getByLabel('Product').fill('Chicken breast fillets')
  await page.getByRole('button', { name: /Create “Chicken breast fillets”/ }).click()
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

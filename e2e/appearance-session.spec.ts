import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const key = (id: string) => `soveris-smartlaunch-appearance:user:${id}`
async function mockApplication(page: Page) {
  await page.route('**/api/backoffice/**', async route => {
    if (route.request().url().endsWith('/auth/login')) {
      const { email } = route.request().postDataJSON()
      const id = email.startsWith('a@') ? 'account-a' : 'account-b'
      return route.fulfill({ json: { accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresIn: 3600,
        user: { id, role: 'Admin', displayName: id, clientId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } } })
    }
    return route.fulfill({ json: route.request().url().includes('/health') ? { status: 'healthy', database: 'ok', redis: 'ok' }
      : { fromDate: null, toDate: null, totalPageViews: 7600, totalSubmissions: 1248, verifiedSubmissions: 1032, verificationRate: .827, conversionRate: .164 } })
  })
}
async function login(page: Page, account: 'a' | 'b') {
  await page.getByLabel('Email address').fill(`${account}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill('Fixture-password-123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('1,248')).toBeVisible()
}
async function logout(page: Page) {
  await page.getByRole('button', { name: /User menu:/ }).click()
  await page.getByRole('menuitem', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
}
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}

test('login branding follows live System and preserves form input at narrow sizes', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('soveris-backoffice-appearance', 'dark'))
  await page.goto('/login')
  await expect(page).toHaveTitle('Soveris SmartLaunch')
  await expect(page.getByRole('heading', { name: 'SmartLaunch', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Soveris', exact: true })).toBeVisible()
  await expect(page.getByText('Sign in to manage your workspace.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Back.?office/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Appearance' })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.name)
  await page.screenshot({ path: info.outputPath('login.png'), fullPage: true })
  await page.getByLabel('Email address').fill('operator@example.test')
  await page.getByLabel('Password', { exact: true }).fill('keep-this-draft')
  const opposite = info.project.name === 'light' ? 'dark' : 'light'
  await page.emulateMedia({ colorScheme: opposite })
  await expect(page.locator('html')).toHaveAttribute('data-theme', opposite)
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('keep-this-draft')
  await page.emulateMedia({ colorScheme: info.project.name as 'light' | 'dark' })
  for (const size of [{ width: 320, height: 780 }, { width: 780, height: 320 }]) {
    await page.setViewportSize(size)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Sign in', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeInViewport()
  }
  await page.setViewportSize({ width: 320, height: 780 })
  await page.getByLabel('Email address').fill(''); await page.getByLabel('Password', { exact: true }).fill('')
  await page.screenshot({ path: info.outputPath('login-narrow.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
})

test('accounts retain independent choices, logout restores System, another browser remains independent', async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: 'light' }); await mockApplication(page); await page.goto('/login')
  await page.evaluate(key => localStorage.setItem(key, 'dark'), key('account-a'))
  await login(page, 'a'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('link', { name: 'Soveris SmartLaunch Dashboard' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'SmartLaunch', exact: true })).toBeVisible()
  await expect(page.getByText(/Back.?office/i)).toHaveCount(0)
  await logout(page); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await login(page, 'b'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await logout(page); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await login(page, 'a'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload(); await expect(page.getByText('1,248')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(key => localStorage.getItem(key), key('account-b'))).toBe('light')
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5194', colorScheme: 'light' })
  try {
    const other = await context.newPage(); await mockApplication(other); await other.goto('/login'); await login(other, 'a')
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'light')
    await choose(other, 'Light')
    expect(await page.evaluate(key => localStorage.getItem(key), key('account-a'))).toBe('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally { await context.close() }
  // Authenticated direct login visits still use System; returning to the app restores A.
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/LOGIN/')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.goto('/dashboard'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.evaluate(() => dispatchEvent(new Event('auth:cleared')))
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

for (const session of ['{invalid', JSON.stringify({ state: { user: { id: 'account-a' } }, version: 0 })]) test(`anonymous prepaint ignores saved account when session is ${session}`, async ({ page }, info) => {
  await page.addInitScript(({ session, key }) => {
    localStorage.setItem('backoffice-auth-persist', session); localStorage.setItem(key, 'dark')
  }, { session, key: key('account-a') })
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/assets/*.js', async route => { await gate; await route.continue() })
  await page.goto('/dashboard', { waitUntil: 'commit' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.name)
  expect(await page.locator('#root').textContent()).toBe('')
  release(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.name)
})

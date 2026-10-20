import { installCurrentSession } from './currentSession'
import { test, expect, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { installSession, mockReports, reportsPath, ACTOR } from './reportMocks'
const fixture = JSON.parse(readFileSync(new URL('../src/api/__fixtures__/domains-http.json', import.meta.url), 'utf8'))
const body = (name: string) => JSON.parse(fixture.cases.find((item: { name: string }) => item.name === name).responseBody)
const domain = body('detail'), capabilities = body('capabilities')
const key = `soveris-smartlaunch-appearance:user:${ACTOR}`
async function scan(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
}
async function dashboard(page: Page) {
  await installSession(page)
  await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ fromDate: null, toDate: null, totalPageViews: 7600, totalSubmissions: 1248, verifiedSubmissions: 1032, verificationRate: .827, conversionRate: .164 }) }))
}
async function domains(page: Page) {
  await installCurrentSession(page, {clientId:domain.clientId,displayName:'Domain operator'})

  let reads = 0
  await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/, route => {
    reads++
    const path = new URL(route.request().url()).pathname
    const response = path.endsWith('/capabilities') ? capabilities : path.endsWith(`/domains/${domain.id}`) ? domain : { items: [domain], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
  return () => reads
}

async function expectHoverFeedback(page: Page, button: Locator, enabled = true) {
  await button.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  const before = await button.evaluate(el => getComputedStyle(el).backgroundColor)
  if (enabled) await button.hover()
  else {
    // Native disabled controls cannot use the enabled-action checks.
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  }
  if (enabled) await expect(button).not.toHaveCSS('background-color', before)
  else await expect(button).toHaveCSS('background-color', before)
}

test('Products and editor actions provide hover feedback without changing drafts', async ({ page }) => {
  await installSession(page)
  const clientId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', productId = '11111111-2222-3333-4444-555555555555'
  const content = JSON.parse(readFileSync(new URL('../src/contracts/product-content/v1/fixtures/valid/origin-full.json', import.meta.url), 'utf8'))
  const product = { id: productId, clientId, name: 'Origin', slug: 'origin', status: 'active', publicationStatus: 'published',
    revision: 3, contentSchemaVersion: 1, contentRevision: 1, draftSchemaVersion: 1, draftRevision: 7,
    completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null,
    createdAt: '2026-09-12T00:00:00.000000', updatedAt: '2026-09-12T00:00:00.000000' }
  const writes: string[] = []
  await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/, route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') writes.push(path)
    const body = path.endsWith('/product-removals') ? { items: [], nextCursor: null }
      : path.endsWith(`/content/${productId}`) ? { productId, schemaVersion: 1, revision: 1, content, draft: { schemaVersion: 1, revision: 7, content } }
      : path.endsWith(`/products/${productId}`) ? product
      : path.endsWith('/me/timezone') ? { timeZone: 'UTC' }
      : { items: [product], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 }
    return route.fulfill({ json: body })
  })
  await page.goto('/products')
  await expect(page.getByRole('button', { name: 'Edit Origin', exact: true }).first()).toBeVisible()
  for (const name of ['Create product', 'Refresh', 'Edit Origin', 'Remove Origin', 'Check removal status']) {
    await expectHoverFeedback(page, page.getByRole('button', { name, exact: true }).first())
  }
  await page.getByRole('button', { name: 'Edit Origin', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Edit Origin' })
  await dialog.getByLabel('Hero title').fill('Keep this draft while hovering')
  for (const name of ['Update identity', 'Archive product', 'Close', 'Save draft', 'Update published']) {
    const button = dialog.getByRole('button', { name, exact: true })
    await expectHoverFeedback(page, button, await button.isEnabled())
  }
  await expect(dialog.getByLabel('Hero title')).toHaveValue('Keep this draft while hovering')
  expect(writes).toEqual([])
})

test('shared button hover preserves semantic contrast, selection and disabled states', async ({ page }) => {
  await dashboard(page); await page.goto('/dashboard'); await expect(page.getByText('1,248')).toBeVisible()
  // Exercise actual built CSS, including unlayered feature styles and legacy
  // hover utilities that otherwise override a shared default.
  const cases = [
    ['neutral', 'border border-control text-foreground', ''],
    ['primary', 'bg-primary-solid text-on-accent', ''],
    ['primary-alternate', 'bg-primary-hover text-on-accent', ''],
    ['danger', 'bg-danger-solid hover:bg-danger-solid text-on-accent', ''],
    ['warning', 'bg-warning-solid text-on-accent', ''],
    ['success', 'bg-success-solid text-on-accent', ''],
    ['info', 'bg-info-solid text-on-accent', ''],
    ['selected', 'bg-primary-solid text-on-accent', ''],
    ['danger-outline', 'border border-danger-line text-danger', ''],
    ['muted', 'text-muted', ''],
    ['report', '', 'billing-reports'],
    ['anomaly', '', 'anomaly-confirmation'],
    ['native-disabled', 'bg-primary-solid text-on-accent hover:bg-primary-hover', ''],
    ['aria-disabled', 'bg-danger-solid text-on-accent hover:bg-danger-solid', ''],
    ['fieldset-disabled', 'bg-primary-solid text-on-accent', ''],
    ['navigation-scrim', 'bg-overlay/40', ''],
  ]
  await page.evaluate(cases => {
    const section = document.createElement('section'); section.dataset.hoverMatrix = 'true'
    for (const [id, classes, scope] of cases) {
      const container = document.createElement(id === 'fieldset-disabled' ? 'fieldset' : 'div')
      if (container instanceof HTMLFieldSetElement) container.disabled = true
      container.className = scope
      const button = document.createElement('button'); button.textContent = id; button.dataset.hoverCase = id
      button.className = `min-h-11 min-w-11 rounded px-4 ${classes}`
      if (id === 'native-disabled') button.disabled = true
      if (id === 'aria-disabled') button.setAttribute('aria-disabled', 'true')
      if (id === 'selected') button.setAttribute('aria-pressed', 'true')
      container.append(button); section.append(container)
    }
    document.querySelector('main')!.append(section)
  }, cases)
  for (const [id] of cases) {
    const button = page.locator(`[data-hover-case="${id}"]`)
    const interactive = !id.endsWith('disabled') && id !== 'navigation-scrim'
    await expectHoverFeedback(page, button, interactive)
    if (interactive) {
      const contrast = await button.evaluate(el => {
        const luminance = (color: string) => (color.match(/[\d.]+/g)!.slice(0, 3).map(Number))
          .map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
        const style = getComputedStyle(el), values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b)
        return (values[1] + .05) / (values[0] + .05)
      })
      expect(contrast, `${id} hovered text contrast`).toBeGreaterThanOrEqual(4.5)
    }
  }
  await expect(page.locator('[data-hover-case="selected"]')).toHaveAttribute('aria-pressed', 'true')
  const neutral = page.locator('[data-hover-case="neutral"]')
  await neutral.focus(); await expect(neutral).toBeFocused()
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await expectHoverFeedback(page, neutral)
  await expect(neutral).toBeFocused()
  await expectHoverFeedback(page, page.locator('[data-hover-case="native-disabled"]'), false)
})

test('dashboard previews, APG menus, persistence, fallback route and logout clearing', async ({ page }, info) => {
  await dashboard(page); await page.goto('/themes')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('1,248')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Themes', exact: true })).toHaveCount(0)
  await expect(page.getByText('Logged in as')).toHaveCount(0)
  await scan(page)
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true })
  const appearance = page.getByRole('button', { name: 'Appearance', exact: true })
  await appearance.focus(); await page.keyboard.press('Enter'); await scan(page)
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused()
  await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(appearance).toBeFocused(); await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: 'Analytics', exact: true }).click()
  await appearance.click(); await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /User menu/ })).toBeFocused()
  await page.keyboard.press('Space'); await expect(page.getByRole('menu', { name: 'User menu' })).toContainText('Admin'); await scan(page)
  await page.getByRole('menuitem', { name: 'Logout' }).click(); await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('1,248')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.name)
  expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token'))).toBeNull()
  await page.goBack(); await expect(page).toHaveURL(/\/login$/)
})

test('header menus switch through pointerless activation without losing focus', async ({ page }) => {
  await dashboard(page); await page.goto('/dashboard'); await expect(page.getByText('1,248')).toBeVisible()
  const appearance = page.getByRole('button', { name: 'Appearance', exact: true })
  const user = page.getByRole('button', { name: /User menu:/ })
  await appearance.click(); await user.evaluate(el => el.click())
  await expect(page.getByRole('menu', { name: 'User menu' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Logout' })).toBeFocused()
  await appearance.evaluate(el => el.click())
  await expect(page.getByRole('menu', { name: 'Appearance' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused()
})

test('header tooltips survive pointer transfer and Escape dismisses them without moving focus', async ({ page }) => {
  await dashboard(page); await page.goto('/dashboard'); await expect(page.getByText('1,248')).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true })
  const tooltip = page.locator('.header-tooltip')
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await trigger.hover(); await expect(tooltip).toBeVisible()
  const box = (await tooltip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape'); await expect(tooltip).toHaveCount(0)
  await page.mouse.move(0, 0); await trigger.focus(); await expect(tooltip).toBeVisible()
  await page.keyboard.press('Escape'); await expect(tooltip).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('long identity menu keeps Logout reachable in short desktop viewports', async ({ page }) => {
  await installCurrentSession(page, {displayName:'Long account name '.repeat(5).trim(),email:'a'.repeat(60)+'@'+'b'.repeat(50)+'.example.test'})

  await page.route(/\/api\/(?!backoffice\/auth\/(?:current|revoke)(?:[?]|$))/, route => route.fulfill({ status: 503, json: {} }))
  await page.setViewportSize({ width: 1280, height: 260 }); await page.goto('/dashboard')
  await page.getByRole('button', { name: /User menu:/ }).click()
  const menu = page.getByRole('menu', { name: 'User menu' }), logout = page.getByRole('menuitem', { name: 'Logout' })
  await expect(logout).toBeInViewport({ ratio: 1 })
  expect(await menu.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  for (const height of [200, 360]) {
    await page.setViewportSize({ width: 1280, height })
    await logout.scrollIntoViewIfNeeded(); await expect(logout).toBeInViewport({ ratio: 1 })
    await expect.poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(height)
  }
})

test('representative Domains, form and narrow previews; live System changes preserve dialog state and inertness', async ({ page }, info) => {
  const reads = await domains(page)
  await page.goto('/domains'); await expect(page.getByRole('link', { name: domain.host }).first()).toBeVisible(); await scan(page)
  await page.screenshot({ path: info.outputPath('domains-list.png'), fullPage: true })
  await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Claim domain' }), field = dialog.getByLabel('Hostname')
  await field.fill('draft.example.test'); await scan(page)
  await page.screenshot({ path: info.outputPath('form-modal.png'), fullPage: true })
  const before = reads(), mode = info.project.name === 'dark' ? 'light' : 'dark'
  await page.emulateMedia({ colorScheme: mode })
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
  await expect(field).toHaveValue('draft.example.test'); await expect(field).toBeFocused()
  expect(await page.locator('#root').evaluate(el => el.inert)).toBe(true)
  expect(reads()).toBe(before)
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Claim domain', exact: true })).toBeFocused()
  await page.emulateMedia({ colorScheme: info.project.name as 'light' | 'dark' })
  await page.getByRole('link', { name: domain.host }).first().click()
  await expect(page.getByRole('heading', { name: 'DNS instructions and check history' })).toBeVisible(); await scan(page)
  await page.screenshot({ path: info.outputPath('domains-detail.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 780 }); await scan(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.screenshot({ path: info.outputPath('narrow-navigation.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click(); await scan(page)
  await page.screenshot({ path: info.outputPath('narrow-menu.png') })
})

test('dense Billing preview preserves precision, structured narrow view and filters during switching', async ({ page }, info) => {
  await installSession(page); const mock = mockReports(); mock.maximum(100); mock.large(); await mock.install(page)
  await page.goto(reportsPath()); await expect(page.getByRole('heading', { name: 'Full-window credit totals' })).toBeVisible()
  await scan(page)
  await page.screenshot({ path: info.outputPath('billing-overview.png') })
  await page.locator('.report-table-scroll').first().evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84))
  await page.screenshot({ path: info.outputPath('billing-dense.png') })
  const field = page.getByLabel('Provider (exact match)'); await field.fill('unsaved filter')
  const count = mock.requests.length
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('menuitemradio', { name: info.project.name === 'dark' ? 'Light' : 'Dark' }).click()
  await expect(field).toHaveValue('unsaved filter'); expect(mock.requests.length).toBe(count)
  await page.setViewportSize({ width: 320, height: 780 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const path of ['/login', '/log%69n', '/%6cogin', '/dashboard', '/forbidden']) for (const stored of [null, 'invalid', 'light', 'dark']) test(`built prepaint ${path} with stored ${stored}`, async ({ page }, info) => {
  await dashboard(page)
  await page.addInitScript(({ stored, key }) => { if (stored !== null) localStorage.setItem(key, stored) }, { stored, key })
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/assets/*.js', async route => { await gate; await route.continue() })
  await page.goto(path, { waitUntil: 'commit' })
  const isLogin = path !== '/dashboard' && path !== '/forbidden'
  const expected = info.project.name
  await expect(page.locator('html')).toHaveAttribute('data-theme', expected)
  expect(await page.locator('#root').textContent()).toBe('')
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(expected === 'dark' ? 'rgb(17, 29, 43)' : 'rgb(244, 247, 250)')
  await page.screenshot({ path: info.outputPath(`prepaint-${stored}.png`) })
  release(); await expect(isLogin ? page.getByRole('button', { name: 'Sign in', exact: true }) : path === '/dashboard' ? page.getByText('1,248') : page.getByRole('heading', { name: '403 — Access Denied' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', !isLogin && (stored === 'light' || stored === 'dark') ? stored : expected); await scan(page)
  if (isLogin) {
    const opposite = info.project.name === 'light' ? 'dark' : 'light'
    await page.emulateMedia({ colorScheme: opposite })
    await expect(page.locator('html')).toHaveAttribute('data-theme', opposite)
  }
})

test('blocked appearance reads/writes remain usable, explicit unsaved override ignores OS changes', async ({ page }) => {
  await dashboard(page)
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = function(k) { if (k === key) throw Error('blocked'); return get.call(this, k) }
    Storage.prototype.setItem = function(k, v) { if (k === key) throw Error('blocked'); set.call(this, k, v) }
  }, key)
  await page.goto('/dashboard'); await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click(); await expect(page.getByRole('status')).toContainText('could not be saved')
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('appearance and menu acknowledgement meet local 100ms p95 budget', async ({ page }, info) => {
  await dashboard(page); await page.goto('/dashboard'); await expect(page.getByText('1,248')).toBeVisible()
  const samples = await page.evaluate(async ({ key }) => {
    const menuSamples: number[] = [], selectionSamples: number[] = []
    const rendered = async (check: () => boolean) => {
      // Allow a rendering opportunity between callbacks, then check the actual
      // committed DOM/style result. This is a local fixture measurement only.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!check()) throw Error('Expected appearance feedback was not rendered')
    }
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Appearance"]')!
    for (let i = 0; i < 30; i++) {
      let start = performance.now(); trigger.click()
      await rendered(() => trigger.getAttribute('aria-expanded') === 'true' &&
        !!document.querySelector('[role="menu"]')?.getBoundingClientRect().height)
      menuSamples.push(performance.now() - start)
      const mode = i % 2 ? 'dark' : 'light'
      start = performance.now(); (document.querySelectorAll('[role="menuitemradio"]')[i % 2 + 1] as HTMLButtonElement).click()
      await rendered(() => trigger.getAttribute('aria-expanded') === 'false' && !document.querySelector('[role="menu"]') &&
        document.documentElement.dataset.theme === mode && getComputedStyle(document.documentElement).colorScheme === mode &&
        localStorage.getItem(key) === mode)
      selectionSamples.push(performance.now() - start)
    }
    return { menuSamples, selectionSamples }
  }, { key })
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]
  const menuP95 = p95(samples.menuSamples), selectionP95 = p95(samples.selectionSamples)
  const samplePath = info.outputPath('feedback-samples.json')
  writeFileSync(samplePath, JSON.stringify({ ...samples, menuP95, selectionP95, measurement: 'two animation frames plus committed DOM/style checks', browser: await page.evaluate(() => navigator.userAgent), profile: 'local built mocked dashboard' }, null, 2))
  await info.attach('feedback-samples', { path: samplePath, contentType: 'application/json' })
  expect(menuP95, 'menu acknowledgement p95').toBeLessThanOrEqual(100)
  expect(selectionP95, 'appearance selection acknowledgement p95').toBeLessThanOrEqual(100)
})

test('unavailable storage and media API safely initialize login and forbidden screens', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError') } })
    Object.defineProperty(window, 'matchMedia', { value: undefined })
  })
  await page.goto('/login'); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.goto('/forbidden'); await expect(page.getByRole('heading', { name: '403 — Access Denied' })).toBeVisible()
  await scan(page)
})

for (const displayName of ['', 'Long operator name '.repeat(8)]) test(`narrow user identity safely handles ${displayName ? 'long names' : 'missing names'}`, async ({ page }) => {
  const email = 'long.operator.address.for.appearance@example.test'
  await installCurrentSession(page, {displayName,email})

  await page.route(/\/api\/(?!backoffice\/auth\/(?:current|revoke)(?:[?]|$))/, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await page.setViewportSize({ width: 320, height: 780 }); await page.goto('/dashboard')
  await page.getByRole('button', { name: /User menu/ }).click()
  const menu = page.getByRole('menu', { name: 'User menu' })
  await expect(menu).toContainText(email); await expect(menu).toContainText('Admin')
  await expect(page.getByRole('menuitem', { name: 'Logout' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: /User menu/ })).toBeFocused()
})

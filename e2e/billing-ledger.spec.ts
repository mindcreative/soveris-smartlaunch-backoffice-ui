import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'
const ledgerPath = `/billing/clients/${CLIENT_ID}/ledger`

function ledgerBody(nextCursor: string | null = null, ledgerId = '77777777-7777-7777-7777-777777777779'): string {
  return `{"items":[{"ledgerId":"${ledgerId}","creditAccountId":"${ACCOUNT_ID}","jobId":"22222222-2222-2222-2222-222222222222","reservationId":null,"adjustmentId":null,"operationId":"88888888-8888-8888-8888-888888888888","transactionType":"reservation_committed","amount":20.0000,"balanceAfter":99999999999999.9999,"ruleId":null,"ruleVersion":null,"actorUserId":null,"reason":"A long untrusted reason that must remain visible and wrap without changing record meaning.","createdAt":"2026-08-24T07:00:00+00:00"}],"asOf":"2026-08-24T08:00:00+00:00","nextCursor":${nextCursor === null ? 'null' : JSON.stringify(nextCursor)}}`
}

async function installAdminSession(page: Page): Promise<void> {
  await page.addInitScript(({ clientId }) => {
    const user = {
      id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
      clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600,
    }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId: CLIENT_ID })
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
}

test.beforeEach(async ({ page }) => { await installAdminSession(page) })

test('renders exact semantic ledger fields on a direct route and preserves workspace history', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    requests.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: ledgerBody() })
  })
  await page.route('**/api/billing/clients/*/account', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Credit account not configured"}' })
  })

  await page.goto(ledgerPath)
  await expect(page.getByRole('heading', { name: 'Ledger history' })).toBeFocused()
  await expect(page.getByRole('table', { name: 'Newest-first immutable Billing ledger operations' })).toBeVisible()
  await expect(page.getByText('+20.0000').first()).toBeVisible()
  await expect(page.getByText('99,999,999,999,999.9999').first()).toBeVisible()
  await expect(page.getByRole('table').getByText('Reservation committed / hold released')).toBeVisible()
  await expect(page.getByText('No actor recorded').first()).toBeVisible()
  await expect(page.getByText(ACCOUNT_ID).first()).toBeVisible()
  expect(new URL(requests[0]!).search).toBe('')
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('link', { name: 'Account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Credit account not configured' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Ledger history' })).toBeFocused()
})

test('normalizes filters, keeps validation local, and clears into a fresh traversal', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const filtered = url.searchParams.has('transactionType')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: filtered ? '{"items":[],"asOf":"2026-08-24T08:00:00+00:00","nextCursor":null}' : ledgerBody(),
    })
  })
  await page.goto(ledgerPath)
  await expect(page.getByRole('table')).toBeVisible()

  await page.getByLabel('Credit account ID').fill('bad-guid')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByRole('alert')).toBeFocused()
  expect(requests).toHaveLength(1)

  await page.getByLabel('Credit account ID').fill(ACCOUNT_ID.toUpperCase())
  await page.getByLabel('Transaction type').selectOption('promotion')
  await page.getByLabel('Page size').selectOption('50')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByRole('heading', { name: 'No ledger operations match these filters' })).toBeVisible()
  expect(requests[1]?.searchParams.get('creditAccountId')).toBe(ACCOUNT_ID)
  expect(requests[1]?.searchParams.get('transactionType')).toBe('promotion')
  expect(requests[1]?.searchParams.get('pageSize')).toBe('50')
  expect(requests[1]?.searchParams.has('cursor')).toBe(false)
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await expect(page.getByRole('table')).toBeVisible()
  expect(requests[2]?.search).toBe('')
  await expect(page.getByRole('heading', { name: 'Filter ledger operations' })).toBeFocused()
})

test('uses cursor-only continuation and requires explicit fresh start after a continuation 400', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    if (url.searchParams.has('cursor')) {
      await route.fulfill({ status: 400, contentType: 'application/problem+json', body: '{"title":"Invalid ledger query"}' })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: ledgerBody('opaque +/ cursor') })
    }
  })
  await page.goto(ledgerPath)
  await page.getByRole('button', { name: 'Load more' }).click()

  await expect(page.getByText('This ledger view can no longer be continued')).toBeVisible()
  await expect(page.getByText('+20.0000').first()).toBeVisible()
  expect([...requests[1]!.searchParams.keys()]).toEqual(['cursor'])
  expect(requests[1]!.searchParams.get('cursor')).toBe('opaque +/ cursor')
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('button', { name: 'Start fresh' }).click()
  await expect.poll(() => requests.length).toBe(3)
  expect(requests[2]?.search).toBe('')
})

test('retains rows through a transient continuation failure, retries the cursor, and focuses the end', async ({ page }) => {
  let cursorRequests = 0
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.searchParams.has('cursor')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: ledgerBody('same-opaque-cursor') })
      return
    }
    cursorRequests += 1
    if (cursorRequests <= 2) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Unavailable"}' })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: ledgerBody(null, '77777777-7777-7777-7777-777777777778'),
    })
  })
  await page.goto(ledgerPath)
  await page.getByRole('button', { name: 'Load more' }).click()

  await expect(page.getByText('More ledger operations could not be loaded')).toBeVisible()
  await expect(page.getByText('+20.0000').first()).toBeVisible()
  await expect(page.getByText('This view may be stale.')).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('button', { name: 'Retry loading more' }).click()
  await expect(page.locator('p[role="status"]').filter({ hasText: 'End of ledger results.' })).toBeFocused()
  expect(cursorRequests).toBe(3)
})

test('loading, empty, denied, and initial error states pass accessibility scans', async ({ page }) => {
  let mode: 'loading' | 'empty' | 'denied' | 'error' = 'loading'
  let release: (() => void) | undefined
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    if (mode === 'loading') await new Promise<void>((resolve) => { release = resolve })
    if (mode === 'empty' || mode === 'loading') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[],"asOf":"2026-08-24T08:00:00+00:00","nextCursor":null}' })
    } else {
      await route.fulfill({ status: mode === 'denied' ? 403 : 500, contentType: 'application/json', body: '{"error":"Unavailable"}' })
    }
  })
  await page.goto(ledgerPath)
  await expect(page.getByRole('status', { name: 'Loading ledger operations…' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  mode = 'empty'
  release?.()
  await expect(page.getByRole('heading', { name: 'No ledger operations' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  mode = 'denied'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)
  mode = 'error'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ledger unavailable' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)
})

test('320px reflow, text spacing, forced colours, reduced motion, keyboard, and targets remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/billing/clients/*/ledger*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: ledgerBody() })
  })
  await page.goto(ledgerPath)
  await expect(page.getByRole('list', { name: 'Newest-first immutable Billing ledger operations' })).toBeVisible()
  await expect(page.getByRole('table')).toBeHidden()

  await page.addStyleTag({ content: `html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }` })
  const overflowMetrics = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
    elements: [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect()
      return { tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 60), left: rect.left, right: rect.right }
    }).filter(({ left, right }) => left < 0 || right > window.innerWidth + 1),
  }))
  expect(overflowMetrics.document, JSON.stringify(overflowMetrics.elements, null, 2)).toBe(overflowMetrics.viewport)
  expect(overflowMetrics.body, JSON.stringify(overflowMetrics.elements, null, 2)).toBe(overflowMetrics.viewport)
  const sizes = await page.locator('a:visible, button:visible, input:visible, select:visible').evaluateAll((elements) =>
    elements.map((element) => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height } }))
  expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  const stateBorder = await page.locator('.state-indicator').first().evaluate((element) => getComputedStyle(element).borderTopStyle)
  expect(stateBorder).not.toBe('none')
  await page.getByRole('button', { name: 'Apply filters' }).focus()
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeFocused()
  await expectNoSeriousAxeViolations(page)
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'
const accountPath = (clientId: string) => `/billing/clients/${clientId}/account`

function snapshotBody(clientId: string, ownedBalance = '99999999999999.9999'): string {
  const availableBalance = ownedBalance === '99999999999999.9999'
    ? '99999999999979.9999'
    : ownedBalance
  return `{"creditAccountId":"11111111-2222-3333-4444-555555555555","clientId":"${clientId}","ownedBalance":${ownedBalance},"activelyReservedAmount":20.0000,"availableBalance":${availableBalance},"activeReservationCount":0,"status":"active","asOf":"2026-08-24T07:00:00+00:00"}`
}

async function installAdminSession(page: Page): Promise<void> {
  await page.addInitScript(({ clientId }) => {
    const user = {
      id: 'operator',
      email: 'operator@example.com',
      displayName: 'Operator',
      role: 'Admin',
      clientId,
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresIn: 3600,
    }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: {
        accessToken: 'test-token',
        refreshTokenValue: 'test-refresh',
        user,
      },
      version: 0,
    }))
  }, { clientId: CLIENT_A })
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await installAdminSession(page)
})

test('renders exact configured values and preserves Client context through history', async ({ page }) => {
  await page.route('**/api/billing/clients/*/account', async (route) => {
    const match = route.request().url().match(/clients\/([^/]+)\/account/)
    const clientId = match?.[1] ?? CLIENT_A
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: snapshotBody(clientId, clientId === CLIENT_A ? '99999999999999.9999' : '42.0000'),
    })
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByRole('heading', { name: 'Account overview' })).toBeFocused()
  await expect(page.getByText('99,999,999,999,999.9999')).toBeVisible()
  await expect(page.getByText(`Selected Client: ${CLIENT_A}`)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Billing' }).first()).toHaveAttribute('aria-current', 'page')
  await expectNoAxeViolations(page)

  await page.goto(accountPath(CLIENT_B))
  await expect(page.getByText('42.0000').first()).toBeVisible()
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await page.goBack()
  await expect(page.getByText('99,999,999,999,999.9999')).toBeVisible()
  await expect(page.getByText(`Selected Client: ${CLIENT_A}`)).toBeVisible()
})

test('loading and not-configured states pass automated accessibility scans', async ({ page }) => {
  let releaseLoading: (() => void) | undefined
  await page.route('**/api/billing/clients/*/account', async (route) => {
    await new Promise<void>((resolve) => { releaseLoading = resolve })
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Credit account not configured' }),
    })
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByRole('status')).toContainText('Loading account snapshot')
  await expectNoAxeViolations(page)

  releaseLoading?.()
  await expect(page.getByRole('heading', { name: 'Credit account not configured' })).toBeVisible()
  await expect(page.getByText(/No zero balance has been inferred/)).toBeVisible()
  await expectNoAxeViolations(page)
})

test('permission-denied and transient-error states are accessible and expose no values', async ({ page }) => {
  let status = 403
  await page.route('**/api/billing/clients/*/account', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: status === 403 ? 'Insufficient permissions' : 'Generic server error',
      }),
    })
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByText('99,999,999,999,999.9999')).toHaveCount(0)
  await expectNoAxeViolations(page)

  status = 500
  await page.goto(accountPath(CLIENT_B))
  await expect(page.getByRole('heading', { name: 'Account snapshot unavailable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('failed refresh keeps same-Client values with a stale warning', async ({ page }) => {
  let requestCount = 0
  await page.route('**/api/billing/clients/*/account', async (route) => {
    requestCount += 1
    if (requestCount === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: snapshotBody(CLIENT_A, '10.0000') })
      return
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Generic server error"}' })
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByText('10.0000').first()).toBeVisible()
  await page.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(page.getByText(/Refresh failed\. Cached snapshot may be stale/)).toBeVisible()
  await expect(page.getByText('10.0000').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Account snapshot unavailable' })).toHaveCount(0)
  await expectNoAxeViolations(page)
})

test('mobile navigation is keyboard-safe and does not create horizontal page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.route('**/api/billing/clients/*/account', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: snapshotBody(CLIENT_A, '10.0000') })
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByText('10.0000').first()).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Mobile navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Mobile navigation' })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoAxeViolations(page)
})

test('reflow, text spacing, motion, forced colours, targets, and feedback remain usable', async ({ page }) => {
  // A 320 CSS-pixel viewport is the reflow width produced by 400% zoom on a 1280px desktop.
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  let requestCount = 0
  await page.route('**/api/billing/clients/*/account', async (route) => {
    requestCount += 1
    if (requestCount === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: snapshotBody(CLIENT_A, '10.0000') })
      return
    }
    await new Promise(() => undefined)
  })

  await page.goto(accountPath(CLIENT_A))
  await expect(page.getByText('10.0000').first()).toBeVisible()

  const targetSizes = await page.locator('a:visible, button:visible').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label') ?? element.textContent?.trim(), width: rect.width, height: rect.height }
    })
  )
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)

  await page.addStyleTag({ content: `
    html { font-size: 200% !important; }
    * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }
  ` })

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Account overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh snapshot' })).toBeVisible()

  const menuFeedbackMs = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')
    if (!trigger) throw new Error('Mobile navigation trigger was not rendered')
    const started = performance.now()
    trigger.click()
    while (!document.querySelector('aside[aria-label="Mobile navigation"]')) {
      await new Promise(requestAnimationFrame)
    }
    return performance.now() - started
  })
  expect(menuFeedbackMs).toBeLessThan(100)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(page.getByRole('status', { name: 'Refreshing account snapshot' })).toBeVisible({ timeout: 500 })

  const reducedMotionDuration = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'animate-spin'
    document.body.append(probe)
    const duration = getComputedStyle(probe).animationDuration
    probe.remove()
    return duration
  })
  expect(reducedMotionDuration).toBe('1e-05s')

  const forcedColourBorder = await page.locator('.state-indicator').first().evaluate((element) =>
    getComputedStyle(element).borderTopStyle
  )
  expect(forcedColourBorder).not.toBe('none')
})

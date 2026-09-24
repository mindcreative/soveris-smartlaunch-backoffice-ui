import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT = '11111111-2222-4333-8444-555555555555'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const ADJUSTMENT = '0199b9d2-a9b1-7000-8000-000000000003'
const LEDGER = '0199b9d2-a9b1-7000-8000-000000000004'
const AT = '2026-09-24T12:00:00.123456Z'
const accountPath = `/billing/clients/${CLIENT}/account`

async function installSession(page: Page, role: 'Admin' | 'Viewer' = 'Admin'): Promise<void> {
  await page.addInitScript(({ clientId, actorId, actorRole }) => {
    const user = { id: actorId, email: 'operator@example.test', displayName: 'Operator',
      role: actorRole, clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId: CLIENT, actorId: ACTOR, actorRole: role })
}

function accountBody(committed = false): string {
  return `{"creditAccountId":"${ACCOUNT}","clientId":"${CLIENT}","ownedBalance":${committed ? '74.5000' : '100.0000'},"activelyReservedAmount":20.0000,"availableBalance":${committed ? '54.5000' : '80.0000'},"activeReservationCount":1,"status":"active","asOf":"2026-09-24T12:${committed ? '01' : '00'}:00.000000","walletVersion":${committed ? '13' : '12'}}`
}

function previewBody(amount = '-25.5000', walletVersion = '12', eligible = true): string {
  const projectedOwned = amount === '-80.0001' ? '19.9999' : '74.5000'
  const projectedAvailable = amount === '-80.0001' ? '-0.0001' : '54.5000'
  return `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","walletVersion":${walletVersion},"asOf":"${AT}","amount":${amount},"currentOwnedBalance":100.0000,"currentReservedBalance":20.0000,"currentAvailableBalance":80.0000,"projectedOwnedBalance":${projectedOwned},"projectedReservedBalance":20.0000,"projectedAvailableBalance":${projectedAvailable},"maximumSafeDebit":80.0000,"minimumAllowedAmount":-80.0000,"walletInvariantEligible":${eligible},"ineligibilityCode":${eligible ? 'null' : '"insufficient_available_credits"'}}`
}

function receiptBody(operationId: string): string {
  return `{"schemaVersion":1,"operationId":"${operationId}","adjustmentId":"${ADJUSTMENT}","ledgerId":"${LEDGER}","clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","amount":-25.5000,"reason":"Correct duplicate allocation","performedBy":"${ACTOR}","walletVersionBefore":12,"walletVersionAfter":13,"beforeOwnedBalance":100.0000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":80.0000,"afterOwnedBalance":74.5000,"afterReservedBalance":20.0000,"afterAvailableBalance":54.5000,"operationAsOf":"${AT}"}`
}

function historyBody(operationId: string, committed: boolean): string {
  const item = `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","operationId":"${operationId}","adjustmentId":"${ADJUSTMENT}","ledgerId":"${LEDGER}","operationType":"original","amount":-25.5000,"reason":"Correct duplicate allocation","performedBy":"${ACTOR}","expectedWalletVersion":12,"walletVersionBefore":12,"walletVersionAfter":13,"beforeOwnedBalance":100.0000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":80.0000,"afterOwnedBalance":74.5000,"afterReservedBalance":20.0000,"afterAvailableBalance":54.5000,"operationAsOf":"${AT}","originalAdjustmentId":null,"reversalAdjustmentId":null}`
  return `{"items":[${committed ? item : ''}],"asOf":"${AT}","nextCursor":null}`
}

async function json(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body })
}

async function accountRoute(page: Page, committed: () => boolean): Promise<void> {
  await page.route('**/api/backoffice/clients/*/billing/account', (route) =>
    json(route, accountBody(committed())))
}

async function openFilledForm(page: Page, amount = '-25.5000'): Promise<void> {
  await page.goto(accountPath)
  await page.getByRole('button', { name: 'Adjust credits' }).click()
  await page.getByLabel('Adjustment amount').fill(amount)
  await page.getByLabel('Reason').fill('Correct duplicate allocation')
  await page.getByRole('button', { name: 'Preview adjustment' }).click()
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await installSession(page)
  await page.route('**/api/backoffice/me/timezone', (route) => {
    throw new Error(`Unexpected timezone request: ${route.request().url()}`)
  })
})

test('previews, explicitly confirms once, and separates receipt from authoritative refresh', async ({ page }) => {
  let committed = false
  let commandBody = ''
  let operationId = ''
  let previewCount = 0
  const accountRequestStates: boolean[] = []
  await page.route('**/api/backoffice/clients/*/billing/account', (route) => {
    accountRequestStates.push(committed)
    return json(route, accountBody(committed))
  })
  await page.route('**/api/billing/clients/*/credit-adjustments/preview', async (route) => {
    previewCount += 1
    expect(route.request().method()).toBe('POST')
    expect(route.request().postData()).toBe('{"amount":-25.5000,"reason":"Correct duplicate allocation"}')
    await json(route, previewBody())
  })
  await page.route(/\/api\/billing\/clients\/[^/]+\/credit-adjustments$/, async (route) => {
    commandBody = route.request().postData() ?? ''
    const match = /"operationId":"([^"]+)"/.exec(commandBody)
    operationId = match?.[1] ?? ''
    expect(operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(commandBody).toBe(`{"operationId":"${operationId}","expectedWalletVersion":12,"amount":-25.5000,"reason":"Correct duplicate allocation"}`)
    committed = true
    await json(route, receiptBody(operationId))
  })
  await page.route('**/api/billing/clients/*/adjustments?*', (route) => {
    expect(route.request().url()).toContain(`operationId=${operationId}`)
    expect(route.request().url()).toContain('pageSize=1')
    return json(route, historyBody(operationId, committed))
  })

  await openFilledForm(page)
  const dialog = page.getByRole('dialog', { name: 'Confirm credit adjustment' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect(dialog).toContainText(CLIENT)
  await expect(dialog).toContainText(ACCOUNT)
  await expect(dialog).toContainText('Reserved balance — unchanged')
  await expectNoAxeViolations(page)
  await dialog.getByRole('button', { name: 'Confirm adjustment' }).click()
  await expect(page.getByText('Credit adjustment committed')).toBeVisible()
  await expect(page.getByText('The authoritative Account refresh completed.')).toBeVisible()
  expect(accountRequestStates.at(-1)).toBe(true)
  await expect(page.getByText('74.5000').first()).toBeVisible()
  expect(previewCount).toBe(2)
  expect(commandBody).not.toContain('clientId')
})

test('fails closed for ineligible and changed confirm-time previews', async ({ page }) => {
  let amount = '-80.0001'
  let previewCount = 0
  let commands = 0
  await accountRoute(page, () => false)
  await page.route('**/api/billing/clients/*/credit-adjustments/preview', async (route) => {
    previewCount += 1
    await json(route, amount === '-80.0001'
      ? previewBody(amount, '12', false)
      : previewCount === 2 ? previewBody(amount, '13') : previewBody(amount))
  })
  await page.route(/\/api\/billing\/clients\/[^/]+\/credit-adjustments$/, async (route) => {
    commands += 1
    await route.abort()
  })

  await openFilledForm(page, amount)
  await expect(page.getByRole('dialog').getByText(/not eligible/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm adjustment' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()

  amount = '-25.5000'
  await page.getByLabel('Adjustment amount').fill(amount)
  await page.getByRole('button', { name: 'Preview adjustment' }).click()
  await page.getByRole('button', { name: 'Confirm adjustment' }).click()
  await expect(page.getByText(/account or preview changed/i)).toBeVisible()
  expect(commands).toBe(0)
})

test('keeps one ambiguous UUID and retries the exact byte string', async ({ page }) => {
  let committed = false
  const bodies: string[] = []
  let operationId = ''
  await accountRoute(page, () => committed)
  await page.route('**/api/billing/clients/*/credit-adjustments/preview', (route) =>
    json(route, previewBody()))
  await page.route(/\/api\/billing\/clients\/[^/]+\/credit-adjustments$/, async (route) => {
    const body = route.request().postData() ?? ''
    bodies.push(body)
    operationId ||= /"operationId":"([^"]+)"/.exec(body)?.[1] ?? ''
    if (bodies.length === 1) {
      await json(route, '{"type":"unknown","title":"Outcome unknown","status":503,"code":"credit_adjustment_outcome_unknown"}', 503)
      return
    }
    committed = true
    await json(route, receiptBody(operationId))
  })
  await page.route('**/api/billing/clients/*/adjustments?*', (route) =>
    json(route, historyBody(operationId, committed)))

  await openFilledForm(page)
  await page.getByRole('button', { name: 'Confirm adjustment' }).click()
  await expect(page.getByText('Adjustment outcome is not yet known')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adjust credits' })).toHaveCount(0)
  const persistedBrowserState = await page.evaluate(() =>
    `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`)
  expect(persistedBrowserState).not.toContain('Correct duplicate allocation')
  expect(persistedBrowserState).not.toContain('-25.5000')
  expect(persistedBrowserState).not.toContain(ACCOUNT)
  expect(persistedBrowserState).not.toContain(operationId)
  expect(page.url()).not.toContain(operationId)
  expect(page.url()).not.toContain('25.5000')
  await page.getByRole('button', { name: 'Retry exact adjustment' }).click()
  await expect(page.getByText('Credit adjustment committed')).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('preserves direct routes and adjustment accessibility at reflow and user preference boundaries', async ({ page }) => {
  await accountRoute(page, () => false)
  await page.route('**/api/billing/clients/*/credit-adjustments/preview', (route) =>
    json(route, previewBody()))
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await page.goto(`/billing/clients/${CLIENT.toUpperCase()}/account`)
  await expect(page).toHaveURL(new RegExp(`${CLIENT}/account$`))
  await page.getByRole('button', { name: 'Adjust credits' }).click()
  expect(await page.getByLabel('Adjustment amount').getAttribute('inputmode')).toBe('decimal')
  await page.addStyleTag({ content: `
    html { font-size: 200% !important; }
    * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }
  ` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const targets = await page.locator('button:visible, a:visible, input:visible, textarea:visible').evaluateAll(
    (elements) => elements.map((element) => {
      const rectangle = element.getBoundingClientRect()
      return { width: rectangle.width, height: rectangle.height }
    })
  )
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await expectNoAxeViolations(page)

  await page.getByLabel('Adjustment amount').fill('-25.5000')
  await page.getByLabel('Reason').fill('A deliberately long correction reason that must reflow safely in the confirmation dialog')
  await page.getByRole('button', { name: 'Preview adjustment' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm credit adjustment' })
  await expect(dialog).toBeVisible()
  const dialogBounds = await dialog.boundingBox()
  expect(dialogBounds).not.toBeNull()
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const dialogTargets = await dialog.locator('button:visible, a:visible').evaluateAll(
    (elements) => elements.map((element) => {
      const rectangle = element.getBoundingClientRect()
      return { width: rectangle.width, height: rectangle.height }
    })
  )
  expect(dialogTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await expectNoAxeViolations(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.goto('/billing/clients/not-a-guid/account')
  await expect(page.getByRole('heading', { name: 'Client context unavailable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adjust credits' })).toHaveCount(0)
})

test('keeps direct account access read-only when the actor lacks billing:adjust', async ({ page }) => {
  await installSession(page, 'Viewer')
  await accountRoute(page, () => false)

  await page.goto(accountPath)

  await expect(page.getByRole('heading', { name: 'Account overview' })).toBeVisible()
  await expect(page.getByText('100.0000').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adjust credits' })).toHaveCount(0)
  await expectNoAxeViolations(page)
})

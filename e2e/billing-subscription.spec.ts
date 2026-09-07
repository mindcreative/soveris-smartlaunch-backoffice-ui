import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'
const pathFor = (clientId: string) => `/billing/clients/${clientId}/subscriptions`

function accountBody(clientId: string, owned = '10.0000'): string {
  return `{"creditAccountId":"11111111-2222-3333-4444-555555555555","clientId":"${clientId}","ownedBalance":${owned},"activelyReservedAmount":0.0000,"availableBalance":${owned},"activeReservationCount":0,"status":"active","asOf":"2026-09-06T12:00:00+00:00","walletVersion":1}`
}

function emptyStateBody(clientId: string): string {
  return JSON.stringify({
    clientId, stateAsOf: '2026-09-06T12:00:00+00:00', current: null,
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: '2026-09-06T12:00:00+00:00', nextCursor: null },
  })
}

function historicalStateBody(clientId: string, continuation: boolean): string {
  const subscriptionId = '22222222-2222-3333-8444-555555555555'
  const operationId = '01991f20-1234-7abc-8abc-1234567890ab'
  const entitlements = {
    schemaVersion: 1,
    rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
    featureFlags: { contentGeneration: true, imageGeneration: false },
  }
  const month = continuation ? '2026-08' : '2026-09'
  const nextMonth = continuation ? '2026-09' : '2026-10'
  return JSON.stringify({
    clientId, stateAsOf: '2026-09-06T12:00:00+00:00', current: null,
    pendingChange: null,
    subscriptionHistory: [{
      subscriptionId, creationOperationId: operationId, planTermsOperationId: operationId,
      clientId, planName: 'Historical Pro', cycleCreditAmount: 1250.0000, entitlements,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor: '2026-08-01T00:00:00+00:00', status: 'cancelled',
      validFrom: '2026-08-01T00:00:00+00:00', validTo: '2026-09-05T00:00:00+00:00',
      createdAt: '2026-08-01T00:00:00+00:00', updatedAt: '2026-09-05T00:00:00+00:00',
    }],
    grantHistory: {
      items: [{
        grantId: continuation ? '33333333-3333-4333-8333-555555555554' : '33333333-3333-4333-8333-555555555555',
        grantOperationId: continuation ? '01991f20-2234-7abc-8abc-1234567890aa' : '01991f20-2234-7abc-8abc-1234567890ab',
        subscriptionId, planTermsOperationId: operationId, planNameSnapshot: 'Historical Pro',
        entitlementsSnapshot: entitlements, grantType: 'billing_cycle',
        cycleStart: `${month}-01T00:00:00+00:00`, cycleEnd: `${nextMonth}-01T00:00:00+00:00`,
        creditAmount: 1250.0000,
        ledgerEntryId: continuation ? '44444444-4444-4444-8444-555555555554' : '44444444-4444-4444-8444-555555555555',
        createdAt: `${month}-01T00:00:00+00:00`,
      }],
      historyAsOf: '2026-09-06T12:00:00+00:00', nextCursor: continuation ? null : 'older-page',
    },
  })
}

function receiptBody(body: string, created: boolean): string {
  const request = JSON.parse(body) as {
    creationOperationId: string
    planName: string
    validFrom: string
    validTo: string | null
    entitlements: unknown
  }
  const amount = /"cycleCreditAmount":([^,]+)/.exec(body)?.[1]
  if (!amount) throw new Error('Exact amount was not present in the request')
  const cycleEndDate = new Date(request.validFrom)
  const originalDay = cycleEndDate.getUTCDate()
  cycleEndDate.setUTCDate(1)
  cycleEndDate.setUTCMonth(cycleEndDate.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(cycleEndDate.getUTCFullYear(), cycleEndDate.getUTCMonth() + 1, 0)).getUTCDate()
  cycleEndDate.setUTCDate(Math.min(originalDay, lastDay))
  const cycleEnd = cycleEndDate.toISOString()
  return JSON.stringify({
    created,
    subscription: {
      subscriptionId: '22222222-2222-3333-8444-555555555555',
      creationOperationId: request.creationOperationId,
      planTermsOperationId: request.creationOperationId,
      clientId: CLIENT_A, planName: request.planName, cycleCreditAmount: '__AMOUNT__',
      entitlements: request.entitlements,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor: request.validFrom, status: 'active',
      validFrom: request.validFrom, validTo: request.validTo,
    },
    initialGrant: {
      grantId: '33333333-3333-4333-8333-555555555555',
      grantOperationId: '01991f20-2234-7abc-8abc-1234567890ab',
      ledgerEntryId: '44444444-4444-4444-8444-555555555555',
      planTermsOperationId: request.creationOperationId,
      planNameSnapshot: request.planName, entitlementsSnapshot: request.entitlements,
      grantType: 'billing_cycle', cycleStart: request.validFrom,
      cycleEnd, creditAmount: '__AMOUNT__',
    },
    account: {
      creditAccountId: '11111111-2222-3333-4444-555555555555', clientId: CLIENT_A,
      ownedBalance: '__AMOUNT__', activelyReservedAmount: 0.0000,
      availableBalance: '__AMOUNT__', status: 'active', asOf: '2026-09-06T12:00:01+00:00',
    },
  }).replaceAll('"__AMOUNT__"', amount)
}

async function installSession(page: Page, role: 'Admin' | 'Viewer' = 'Admin'): Promise<void> {
  await page.addInitScript(({ clientId, sessionRole }) => {
    const user = {
      id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: sessionRole,
      clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600,
    }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId: CLIENT_A, sessionRole: role })
}

async function installReads(page: Page): Promise<void> {
  await page.route('**/api/billing/clients/*/account', async (route) => {
    const clientId = /clients\/([^/]+)\/account/.exec(route.request().url())?.[1] ?? CLIENT_A
    await route.fulfill({ status: 200, contentType: 'application/json', body: accountBody(clientId) })
  })
}

async function fillAndReview(page: Page): Promise<void> {
  await page.getByLabel('Plan name').fill('Pro')
  await page.getByLabel('Cycle credit amount').fill('1250.0000')
  await page.getByLabel('Requests per minute').fill('60')
  await page.getByLabel('Concurrent AI operations').fill('4')
  await page.getByLabel('Content generation').check()
  await page.getByLabel('Valid from (UTC)').fill(new Date().toISOString().slice(0, 16))
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm subscription creation' })).toBeVisible()
}

async function confirmSynchronouslyTwice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm creation' }).evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations).toEqual([])
}

test.beforeEach(async ({ page }, testInfo) => {
  await installSession(page, testInfo.title.includes('permission loss') ? 'Viewer' : 'Admin')
  await installReads(page)
})

test('creates one operation with exact closed numeric transport and accessible receipt', async ({ page }) => {
  const bodies: string[] = []
  let releaseCreation: (() => void) | undefined
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    await new Promise<void>((resolve) => { releaseCreation = resolve })
    await route.fulfill({ status: 201, contentType: 'application/json', body: receiptBody(body, true) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirmSynchronouslyTwice(page)
  await expect(page.getByRole('heading', { name: 'Creating subscription' })).toBeVisible({ timeout: 500 })
  expect(bodies).toHaveLength(1)
  releaseCreation?.()
  await expect(page.getByRole('heading', { name: 'Created' })).toBeVisible()
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toContain('"cycleCreditAmount":1250.0000')
  expect(bodies[0]).not.toContain('"clientId"')
  expect(bodies[0]).not.toContain('grantOperationId')
  const request = JSON.parse(bodies[0]!) as Record<string, unknown>
  expect(Object.keys(request).sort()).toEqual([
    'changeEffectivePolicy', 'creationOperationId', 'cycleCreditAmount', 'entitlements',
    'planName', 'prorationPolicy', 'unusedCreditPolicy', 'validFrom', 'validTo',
  ])
  expect(request.creationOperationId).toMatch(/^........-....-7...-[89ab]...-............$/)
  await expect(page.getByText('Original balance outcome')).toBeVisible()
  await expect(page.getByText('Current account snapshot')).toBeVisible()
  await expectNoAxeViolations(page)
})

test('renders a 200 replay as the original operation, not a second creation', async ({ page }) => {
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    const body = route.request().postData() ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: receiptBody(body, false) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('heading', { name: 'Already completed' })).toBeVisible()
  await expect(page.getByText(/No second subscription or grant was created/)).toBeVisible()
})

test('replays the exact in-flight POST after successful auth refresh', async ({ page }) => {
  const bodies: string[] = []
  let postCount = 0
  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'refreshed-token', refreshToken: 'refreshed-refresh' }),
    })
  })
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    if (postCount === 1) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' })
      return
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: receiptBody(body, true) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('heading', { name: 'Created' })).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('network ambiguity retries only the byte-equivalent retained operation', async ({ page }) => {
  const bodies: string[] = []
  let postCount = 0
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    if (postCount === 1) await route.abort('connectionreset')
    else await route.fulfill({ status: 200, contentType: 'application/json', body: receiptBody(body, false) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('heading', { name: 'Outcome unknown' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry exact operation' }).click()
  await expect(page.getByRole('heading', { name: 'Already completed' })).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('stable conflicts and validation failures remain safe and determinate', async ({ page }) => {
  let response = { status: 400, code: 'validation_error' }
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    await route.fulfill({
      status: response.status, contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'raw title', detail: 'raw detail', code: response.code }),
    })
  })
  const cases: Array<[number, string, string]> = [
    [400, 'validation_error', 'Invalid subscription creation request'],
    [404, 'not_configured', 'Billing not configured'],
    [409, 'subscription_operation_conflict', 'Operation identity conflict'],
    [409, 'subscription_current_conflict', 'Current subscription conflict'],
    [409, 'credit_account_inactive', 'Credit account inactive'],
    [409, 'credit_balance_overflow', 'Credit balance capacity conflict'],
    [413, 'HTTP_413', 'Subscription request contract failure'],
    [415, 'HTTP_415', 'Subscription request contract failure'],
  ]
  for (const [status, code, heading] of cases) {
    response = { status, code }
    await page.goto(pathFor(CLIENT_A))
    await fillAndReview(page)
    await page.getByRole('button', { name: 'Confirm creation' }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByText('raw detail')).toHaveCount(0)
  }
})

test('Client switching clears the old draft and never flashes it under the new route', async ({ page }) => {
  let releaseB: (() => void) | undefined
  await page.route('**/api/billing/clients/*/subscriptions*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const clientId = /clients\/([^/]+)\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (clientId === CLIENT_B) await new Promise<void>((resolve) => { releaseB = resolve })
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(clientId) })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByLabel('Plan name').fill('Private Client A plan')
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByText('Private Client A plan')).toHaveCount(0)
  releaseB?.()
  await expect(page.getByLabel('Plan name')).toHaveValue('')
  await page.goBack()
  await expect(page.getByLabel('Plan name')).toHaveValue('')
})

test('loads terminal grant history with the opaque continuation cursor', async ({ page }) => {
  const urls: string[] = []
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    urls.push(route.request().url())
    const continuation = new URL(route.request().url()).searchParams.get('cursor') === 'older-page'
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: historicalStateBody(CLIENT_A, continuation),
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByText('1 validated historical grant record is loaded.')).toBeVisible()
  await page.getByRole('button', { name: 'Load more grant history' }).click()
  await expect(page.getByText('2 validated historical grant records are loaded.')).toBeVisible()
  expect(urls.some((url) => new URL(url).search === '?cursor=older-page')).toBe(true)
})

test('Client switching during POST ignores a late old-Client receipt', async ({ page }) => {
  let releasePost: (() => void) | undefined
  let oldBody = ''
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    const clientId = /clients\/([^/]+)\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(clientId) })
      return
    }
    oldBody = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releasePost = resolve })
    await route.fulfill({ status: 201, contentType: 'application/json', body: receiptBody(oldBody, true) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect.poll(() => Boolean(releasePost)).toBe(true)
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  releasePost?.()
  await expect(page.getByRole('heading', { name: 'Created' })).toHaveCount(0)
  await expect(page.getByLabel('Plan name')).toHaveValue('')
})

test('400% equivalent reflow and text spacing remain keyboard-safe with 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  await fillAndReview(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const targetSizes = await page.locator('a:visible, button:visible, input:not([type="checkbox"]):visible, label:has(input[type="checkbox"]):visible').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  )
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await expectNoAxeViolations(page)
})

test('subscription permission loss denies direct access without exposing private controls', async ({ page }) => {
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    await route.fulfill({
      status: 403, contentType: 'application/json', body: '{"error":"Insufficient permissions"}',
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByLabel('Plan name')).toHaveCount(0)
})

test('500 and malformed success responses stay indeterminate and expose no response material', async ({ page }) => {
  let malformed = false
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    await route.fulfill(malformed
      ? { status: 201, contentType: 'application/json', body: '{"private":"must-not-render"}' }
      : { status: 500, contentType: 'application/problem+json', body: '{"detail":"must-not-render"}' })
  })
  for (const malformedResponse of [false, true]) {
    malformed = malformedResponse
    await page.goto(pathFor(CLIENT_A))
    await fillAndReview(page)
    await page.getByRole('button', { name: 'Confirm creation' }).click()
    await expect(page.getByRole('heading', { name: 'Outcome unknown' })).toBeVisible()
    await expect(page.getByText(/must-not-render/)).toHaveCount(0)
  }
})

test('fresh POST authorization loss clears creation controls and exposes no draft', async ({ page }) => {
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    await route.fulfill({
      status: 403, contentType: 'application/json',
      body: JSON.stringify({ error: 'Insufficient permissions' }),
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillAndReview(page)
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByLabel('Plan name')).toHaveCount(0)
  await expect(page.getByText('1250.0000')).toHaveCount(0)
  await expectNoAxeViolations(page)
})

test('malformed subscription state fails closed without rendering private values', async ({ page }) => {
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ clientId: CLIENT_A, privateBalance: '999999.0000' }),
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('heading', { name: 'Subscription state unavailable' })).toBeVisible()
  await expect(page.getByText('999999.0000')).toHaveCount(0)
  await expect(page.getByLabel('Plan name')).toHaveCount(0)
  await expectNoAxeViolations(page)
})

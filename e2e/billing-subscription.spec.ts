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

type LifecycleStatus = 'active' | 'paused' | 'cancelled' | 'expired'

function lifecycleStateBody(
  clientId: string,
  status: LifecycleStatus,
  validTo: string | null = null,
  stateAsOf = '2026-09-07T09:00:00+00:00'
): string {
  const terminal = status === 'cancelled' || status === 'expired'
  const subscription = {
    subscriptionId: '22222222-2222-3333-8444-555555555555',
    creationOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    clientId, planName: 'Lifecycle Pro', subscriptionTier: 'brand', tierRevision: 0,
    cycleCreditAmount: '__AMOUNT__',
    entitlements: {
      schemaVersion: 1,
      rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
      featureFlags: { contentGeneration: true, imageGeneration: true },
    },
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace',
    unusedCreditPolicy: 'rollover', billingCycleAnchor: '2026-09-01T00:00:00+00:00',
    status, validFrom: '2026-09-01T00:00:00+00:00', validTo,
    createdAt: '2026-09-01T00:00:00+00:00', updatedAt: stateAsOf,
  }
  const grant = {
    grantId: '33333333-3333-4333-8333-555555555555',
    grantOperationId: '01991f20-2234-7abc-8abc-1234567890ab',
    subscriptionId: subscription.subscriptionId,
    planTermsOperationId: subscription.planTermsOperationId,
    planNameSnapshot: subscription.planName,
    subscriptionTierSnapshot: 'brand', tierRevisionSnapshot: 0,
    entitlementsSnapshot: subscription.entitlements,
    grantType: 'billing_cycle',
    cycleStart: '2026-09-01T00:00:00+00:00', cycleEnd: '2026-10-01T00:00:00+00:00',
    creditAmount: '__AMOUNT__',
    ledgerEntryId: '44444444-4444-4444-8444-555555555555',
    createdAt: '2026-09-01T00:00:00+00:00',
  }
  return JSON.stringify({
    clientId, stateAsOf, current: terminal ? null : subscription,
    pendingChange: null, subscriptionHistory: terminal ? [subscription] : [],
    grantHistory: { items: [grant], historyAsOf: stateAsOf, nextCursor: null },
  }).replaceAll('"__AMOUNT__"', '99999999999999.9999')
}

function lifecycleReceiptBody(
  body: string,
  status: LifecycleStatus,
  validTo: string | null = null
): string {
  const request = JSON.parse(body) as {
    lifecycleOperationId: string
    action: 'pause' | 'reactivate' | 'cancel' | 'expire'
    expectedStatus: 'active' | 'paused'
    reason: string
  }
  const operationAsOf = '2026-09-07T09:00:01+00:00'
  return JSON.stringify({
    lifecycleOperationId: request.lifecycleOperationId,
    clientId: CLIENT_A,
    subscriptionId: '22222222-2222-3333-8444-555555555555',
    action: request.action,
    previousStatus: request.expectedStatus,
    status,
    reason: request.reason,
    effectiveAt: request.action === 'expire' ? validTo : operationAsOf,
    operationAsOf,
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
      clientId, planName: 'Historical Pro', subscriptionTier: 'brand_premium', tierRevision: 4,
      cycleCreditAmount: 1250.0000, entitlements,
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
        subscriptionTierSnapshot: 'basic', tierRevisionSnapshot: 1,
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

async function fillDraft(page: Page): Promise<void> {
  await page.getByLabel('Plan name').fill('Pro')
  await page.getByLabel('Cycle credit amount').fill('1250.0000')
  await page.getByLabel('Requests per minute').fill('60')
  await page.getByLabel('Concurrent AI operations').fill('4')
  await page.getByLabel('Content generation').check()
  await page.getByLabel('Valid from (UTC)').fill(new Date().toISOString().slice(0, 16))
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations).toEqual([])
}

test.beforeEach(async ({ page }, testInfo) => {
  await installSession(page, testInfo.title.includes('permission loss') ? 'Viewer' : 'Admin')
  await installReads(page)
})

test('keeps the obsolete tierless creation flow visibly unavailable without a POST', async ({ page }) => {
  const bodies: string[] = []
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    bodies.push(route.request().postData() ?? '')
    await route.fulfill({ status: 400, contentType: 'application/problem+json', body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByText(/creation is temporarily unavailable.*explicit tier/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeDisabled()
  await expect(page.getByRole('combobox')).toHaveCount(0)
  expect(bodies).toEqual([])
  await expectNoAxeViolations(page)
})

test('pauses then reactivates with exact Client-scoped lifecycle commands', async ({ page }) => {
  let status: LifecycleStatus = 'active'
  const bodies: string[] = []
  let releasePause: (() => void) | undefined
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    const request = JSON.parse(body) as { action: string }
    status = request.action === 'pause' ? 'paused' : 'active'
    if (request.action === 'pause') {
      await new Promise<void>((resolve) => { releasePause = resolve })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status) })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByText('99999999999999.9999', { exact: true }).first()).toBeVisible()
  await expectNoAxeViolations(page)
  const pause = page.getByRole('button', { name: 'Pause subscription' })
  await pause.focus()
  await page.evaluate(() => {
    const evidence = window as unknown as { lifecycleAckStart: number; lifecycleAckMs?: number }
    evidence.lifecycleAckStart = performance.now()
    const observer = new MutationObserver(() => {
      if (document.querySelector('[role="dialog"]')) {
        evidence.lifecycleAckMs = performance.now() - evidence.lifecycleAckStart
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() =>
    (window as unknown as { lifecycleAckMs?: number }).lifecycleAckMs ?? Infinity
  )).toBeLessThanOrEqual(100)
  await expect(page.getByRole('button', { name: 'Keep current status', exact: true }).last()).toBeFocused()
  await page.getByLabel('Reason').fill('Temporary administrative hold')
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Applying lifecycle operation' })).toBeVisible({ timeout: 500 })
  await expectNoAxeViolations(page)
  releasePause?.()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue with authoritative state' }).click()
  await expect(page.getByRole('button', { name: 'Reactivate subscription' })).toBeVisible()
  await page.getByRole('button', { name: 'Reactivate subscription' }).click()
  await page.getByLabel('Reason').fill('Administrative hold resolved')
  await page.getByRole('button', { name: 'Confirm Reactivate' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  await expect(page.getByText('paused → active')).toBeVisible()
  await expect(page.getByText('99999999999999.9999', { exact: true }).first()).toBeVisible()

  expect(bodies).toHaveLength(2)
  for (const body of bodies) {
    const request = JSON.parse(body) as Record<string, unknown>
    expect(Object.keys(request).sort()).toEqual([
      'action', 'expectedStatus', 'lifecycleOperationId', 'reason',
    ])
    expect(request.lifecycleOperationId).toMatch(/^........-....-7...-[89ab]...-............$/)
    expect(body).not.toContain('clientId')
    expect(body).not.toContain('subscriptionId')
  }
  await expectNoAxeViolations(page)
})

test('offers only due Expire and Cancel and preserves terminal history', async ({ page }) => {
  const validTo = '2026-09-07T09:00:00+00:00'
  let status: LifecycleStatus = 'active'
  let selectedAction = ''
  await page.route('**/api/billing/clients/*/account', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"detail":"unavailable"}' })
  })
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status, validTo) })
      return
    }
    const body = route.request().postData() ?? ''
    selectedAction = (JSON.parse(body) as { action: string }).action
    status = selectedAction === 'expire' ? 'expired' : 'cancelled'
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status, validTo) })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('button', { name: 'Expire subscription' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause subscription' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Expire subscription' }).click()
  await expect(page.getByRole('dialog')).toContainText(validTo)
  await page.getByLabel('Reason').fill('Finite validity boundary reached')
  await page.getByRole('button', { name: 'Confirm Expire' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  await expect(page.getByText('active → expired')).toBeVisible()
  expect(selectedAction).toBe('expire')
  await expect(page.getByText(/Lifecycle Pro · expired/)).toBeVisible()
  await expect(page.getByText('1 validated historical grant record is loaded.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expire subscription' })).toHaveCount(0)
})

for (const [sourceStatus, action, resultStatus] of [
  ['active', 'cancel', 'cancelled'],
  ['paused', 'expire', 'expired'],
] as const) {
  test(`${sourceStatus} subscriptions can ${action} with terminal receipt evidence`, async ({ page }) => {
    const validTo = action === 'expire' ? '2026-09-07T09:00:00+00:00' : null
    let status: LifecycleStatus = sourceStatus
    await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: lifecycleStateBody(CLIENT_A, status, validTo),
        })
        return
      }
      const body = route.request().postData() ?? ''
      status = resultStatus
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: lifecycleReceiptBody(body, resultStatus, validTo),
      })
    })
    await page.goto(pathFor(CLIENT_A))
    const label = `${action[0]!.toUpperCase()}${action.slice(1)} subscription`
    await page.getByRole('button', { name: label }).click()
    await page.getByLabel('Reason').fill(`${sourceStatus} to ${resultStatus}`)
    await page.getByRole('button', {
      name: `Confirm ${action[0]!.toUpperCase()}${action.slice(1)}`,
    }).click()
    await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
    await expect(page.getByText(`${sourceStatus} → ${resultStatus}`)).toBeVisible()
  })
}

test('cancels a paused subscription after validity and keeps immutable terminal evidence', async ({ page }) => {
  const validTo = '2026-09-07T08:59:59.999999+00:00'
  let status: LifecycleStatus = 'paused'
  let body = ''
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status, validTo) })
      return
    }
    body = route.request().postData() ?? ''
    status = 'cancelled'
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status, validTo) })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('button', { name: 'Expire subscription' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel subscription' }).click()
  await expect(page.getByRole('dialog')).toContainText('paused → cancelled')
  await page.getByLabel('Reason').fill('Operator chose terminal cancellation after validity')
  await page.getByRole('button', { name: 'Confirm Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  await expect(page.getByText('paused → cancelled')).toBeVisible()
  await expect(page.getByText(/Lifecycle Pro · cancelled/)).toBeVisible()
  await expect(page.getByText('1 validated historical grant record is loaded.')).toBeVisible()
  const request = JSON.parse(body) as Record<string, unknown>
  expect(request).toEqual({
    lifecycleOperationId: expect.stringMatching(/^........-....-7...-[89ab]...-............$/),
    action: 'cancel', expectedStatus: 'paused',
    reason: 'Operator chose terminal cancellation after validity',
  })
})

test('recovers lifecycle network ambiguity only through explicit byte-equivalent replay', async ({ page }) => {
  let status: LifecycleStatus = 'active'
  let postCount = 0
  const bodies: string[] = []
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    status = 'paused'
    if (postCount === 1) await route.abort('connectionreset')
    else await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Ambiguous operation recovery')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle outcome unknown' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry exact operation' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0)
  expect(bodies).toHaveLength(1)
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Retry exact operation' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('revalidates stale lifecycle confirmation without sending a command', async ({ page }) => {
  let getCount = 0
  let postCount = 0
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      const status: LifecycleStatus = getCount === 1 ? 'active' : 'paused'
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    postCount += 1
    await route.fulfill({ status: 500, body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('State changed before dispatch')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmation expired' })).toBeVisible()
  expect(postCount).toBe(0)
  await page.getByRole('button', { name: 'Return to refreshed actions' }).click()
  await expect(page.getByRole('button', { name: 'Reactivate subscription' })).toBeVisible()
})

test('replays the byte-identical lifecycle command through one successful auth refresh', async ({ page }) => {
  const bodies: string[] = []
  let postCount = 0
  let status: LifecycleStatus = 'active'
  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'refreshed-token', refreshToken: 'refreshed-refresh' }),
    })
  })
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    if (postCount === 1) {
      await route.fulfill({ status: 401, contentType: 'application/problem+json', body: '{"detail":"expired"}' })
      return
    }
    status = 'paused'
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status) })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Retain this exact reason through refresh')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
  await expect(page.getByText('Retain this exact reason through refresh')).toBeVisible()
})

test('renders lifecycle concurrency conflicts as determinate sanitized states', async ({ page }) => {
  let code = 'subscription_lifecycle_operation_conflict'
  let due = false
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: lifecycleStateBody(
          CLIENT_A, 'active', due ? '2026-09-07T09:00:00+00:00' : null
        ),
      })
      return
    }
    await route.fulfill({
      status: 409, contentType: 'application/problem+json',
      body: JSON.stringify({ code, detail: 'raw private conflict material' }),
    })
  })
  const cases: Array<[string, string, boolean]> = [
    ['subscription_lifecycle_operation_conflict', 'Operation identity conflict', false],
    ['subscription_lifecycle_state_conflict', 'Subscription state changed', false],
    ['subscription_lifecycle_transition_invalid', 'Lifecycle transition unavailable', false],
    ['subscription_validity_ended', 'Subscription validity ended', false],
    ['subscription_expiration_not_due', 'Subscription expiration is not due', true],
  ]
  for (const [nextCode, heading, isDue] of cases) {
    code = nextCode
    due = isDue
    await page.goto(pathFor(CLIENT_A))
    await page.getByRole('button', {
      name: isDue ? 'Expire subscription' : 'Pause subscription',
    }).click()
    await page.getByLabel('Reason').fill(`Review ${nextCode}`)
    await page.getByRole('button', {
      name: isDue ? 'Confirm Expire' : 'Confirm Pause',
    }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByText('raw private conflict material')).toHaveCount(0)
    if (nextCode === 'subscription_lifecycle_state_conflict') await expectNoAxeViolations(page)
  }
})

test('fresh lifecycle authorization loss removes all private lifecycle evidence', async ({ page }) => {
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    await route.fulfill({
      status: 403, contentType: 'application/problem+json',
      body: '{"detail":"raw private authorization detail"}',
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Private reason removed on denial')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByText('Private reason removed on denial')).toHaveCount(0)
  await expect(page.getByText('99999999999999.9999', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pause subscription' })).toHaveCount(0)
})

test('authorization refresh removes an open lifecycle dialog before fresh denial', async ({ page }) => {
  let deny = false
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    await route.fulfill(deny
      ? { status: 403, contentType: 'application/problem+json', body: '{}' }
      : { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Private reason removed by authorization refresh')
  deny = true
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('auth:refreshed', {
      detail: { waitUntil: () => undefined },
    }))
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Private reason removed by authorization refresh')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByText('99999999999999.9999', { exact: true })).toHaveCount(0)
})

test('logout during a lifecycle command aborts the attempt and ignores its late receipt', async ({ page }) => {
  let releasePost: (() => void) | undefined
  let body = ''
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    body = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releasePost = resolve })
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Private in-flight logout reason')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Applying lifecycle operation' })).toBeVisible()
  await expect.poll(() => Boolean(releasePost)).toBe(true)
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Private in-flight logout reason')).toHaveCount(0)
  releasePost?.()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toHaveCount(0)
})

test('keeps a valid lifecycle receipt while a failed authoritative refresh is marked stale', async ({ page }) => {
  let getCount = 0
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      if (getCount > 2) {
        await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"detail":"private refresh failure"}' })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      }
      return
    }
    const body = route.request().postData() ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Receipt survives refresh failure')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toBeVisible()
  await expect(page.getByText(/receipt is valid, but refreshed subscription state is unavailable/i)).toBeVisible()
  await expect(page.getByText('Receipt survives refresh failure')).toBeVisible()
  await expect(page.getByText('private refresh failure')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue with authoritative state' })).toHaveCount(0)
})

test('treats lifecycle 500 and malformed 200 responses as unresolved without blind retry', async ({ page }) => {
  let malformed = false
  const bodies: string[] = []
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    bodies.push(route.request().postData() ?? '')
    await route.fulfill(malformed
      ? { status: 200, contentType: 'application/json', body: '{"private":"malformed receipt material"}' }
      : { status: 500, contentType: 'application/problem+json', body: '{"detail":"private server failure"}' })
  })
  for (const malformedResponse of [false, true]) {
    malformed = malformedResponse
    await page.goto(pathFor(CLIENT_A))
    await page.getByRole('button', { name: 'Pause subscription' }).click()
    await page.getByLabel('Reason').fill('Unresolved lifecycle result')
    await page.getByRole('button', { name: 'Confirm Pause' }).click()
    await expect(page.getByRole('heading', { name: 'Lifecycle outcome unknown' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry exact operation' })).toBeEnabled()
    await expect(page.getByText(/private server failure|malformed receipt material/)).toHaveCount(0)
    expect(bodies).toHaveLength(malformedResponse ? 2 : 1)
  }
})

test('blocks lifecycle replay when unknown-outcome reconciliation is unavailable', async ({ page }) => {
  let getCount = 0
  let postCount = 0
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      if (getCount > 2) {
        await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      }
      return
    }
    postCount += 1
    await route.abort('connectionreset')
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Reconciliation unavailable')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Lifecycle outcome unknown' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry exact operation' })).toBeDisabled()
  await expect(page.getByText(/Reconciliation is unavailable/)).toBeVisible()
  expect(postCount).toBe(1)
})

test('Client switching closes lifecycle dialogs, drops attempts, and ignores late receipts', async ({ page }) => {
  let releasePost: (() => void) | undefined
  let oldBody = ''
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    const clientId = /clients\/([^/]+)\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(clientId, 'active') })
      return
    }
    oldBody = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releasePost = resolve })
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleReceiptBody(oldBody, 'paused') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await page.getByLabel('Reason').fill('Pre-dispatch Client A reason')
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Pre-dispatch Client A reason')).toHaveCount(0)

  await page.goBack()
  await expect(page.getByText(`Selected Client: ${CLIENT_A}`)).toBeVisible()
  await page.getByRole('button', { name: 'Pause subscription' }).click()
  await expect(page.getByLabel('Reason')).toHaveValue('')
  await page.getByLabel('Reason').fill('In-flight Client A reason')
  await page.getByRole('button', { name: 'Confirm Pause' }).click()
  await expect.poll(() => Boolean(releasePost)).toBe(true)
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  releasePost?.()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toHaveCount(0)
  await expect(page.getByText('In-flight Client A reason')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Pause subscription' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Lifecycle operation completed' })).toHaveCount(0)
})

test('lifecycle dialog reflows with long content, text spacing, forced colours, and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/billing/clients/*/subscriptions**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  const trigger = page.getByRole('button', { name: 'Pause subscription' })
  await trigger.click()
  await page.getByLabel('Reason').fill(`Long exact reason ${'😀'.repeat(240)}`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const targetSizes = await page.locator('button:visible, textarea:visible').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  )
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await expectNoAxeViolations(page)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.setViewportSize({ width: 700, height: 320 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await trigger.click()
  await page.getByLabel('Reason').fill('Virtual keyboard viewport simulation')
  await page.getByLabel('Reason').focus()
  await page.setViewportSize({ width: 320, height: 320 })
  await page.getByRole('button', { name: 'Confirm Pause' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Confirm Pause' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoAxeViolations(page)
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

test('400% equivalent reflow and text spacing remain keyboard-safe with 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/billing/clients/*/subscriptions*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  await fillDraft(page)
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeDisabled()
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

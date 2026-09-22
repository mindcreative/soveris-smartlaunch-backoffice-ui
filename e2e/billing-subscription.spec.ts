import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'
const TIER_SUBSCRIPTION = '22222222-2222-3333-8444-555555555555'
const pathFor = (clientId: string) => `/billing/clients/${clientId}/subscriptions`
const CAPABILITY_KEYS = [
  'manual_content_editing', 'ordinary_image_upload', 'ai_content_generation',
  'ai_image_generation', 'ai_source_ingestion', 'client_domain_binding',
  'product_domain_binding', 'analytics', 'ab_testing',
] as const
const CAPABILITY_LIMITS = [
  ['active_products', 'count', 5], ['hostnames', 'count', 5],
  ['storage_bytes', 'bytes', 10485760], ['requests_per_minute', 'requests_per_minute', 60],
  ['concurrent_ai_operations', 'count', 4], ['retention_days', 'days', 30],
] as const

function freemiumCapabilitiesBody(clientId: string): string {
  return JSON.stringify({
    clientId, classificationSource: 'back_office.clients', classification: 'customer',
    classificationRevision: 5, policySource: 'customer_freemium', policyVersion: 'input-04-v1',
    subscription: null,
    flags: CAPABILITY_KEYS.map((key) => ({ key, enabled: key !== 'ai_source_ingestion' })),
    limits: CAPABILITY_LIMITS.map(([key, unit, value]) => ({ key, unit, value })),
    usage: CAPABILITY_LIMITS.map(([key, unit]) => ({
      key, unit, value: 0, measuredAt: '2026-09-06T11:59:00.000000+00:00',
    })),
    operations: CAPABILITY_KEYS.map((key) => {
      const ai = key.startsWith('ai_')
      const source = key === 'ai_source_ingestion'
      return {
        key, outcome: ai ? 'denied' : 'eligible', permission: 'satisfied',
        feature: source ? 'denied' : 'satisfied', entitlement: ai ? 'denied' : 'not_applicable',
        resourceLimit: 'satisfied', provider: ai ? 'satisfied' : 'not_applicable',
        pricing: ai ? 'satisfied' : 'not_applicable',
        funding: ai ? 'available_requires_quote' : 'not_applicable',
        denialConditions: source
          ? ['feature_not_available', 'entitlement_not_available']
          : ai ? ['entitlement_not_available'] : [],
      }
    }),
    evaluatedAt: '2026-09-06T12:00:00.000000+00:00', nextBoundary: null,
  })
}

function paidCapabilitiesBody(clientId: string): string {
  const value = JSON.parse(freemiumCapabilitiesBody(clientId)) as Record<string, unknown>
  value.policySource = 'customer_subscription'
  value.subscription = {
    storedTier: 'brand', effectiveTier: 'brand', status: 'active', tierRevision: 7,
    validFrom: '2026-09-01T00:00:00.000000+00:00', validTo: null,
  }
  value.operations = (value.operations as Array<Record<string, unknown>>).map((operation) => {
    if (operation.key === 'ai_content_generation' || operation.key === 'ai_image_generation') {
      return { ...operation, outcome: 'eligible', entitlement: 'satisfied', denialConditions: [] }
    }
    return operation
  })
  value.nextBoundary = '2026-10-01T00:00:00.000000+00:00'
  return JSON.stringify(value)
}

function tierStateBody(clientId: string, pendingOperationId?: string): string {
  const value = JSON.parse(lifecycleStateBody(
    clientId, 'active', null, '2026-09-20T12:00:00.000000+00:00'
  ).replaceAll('99999999999999.9999', '100.0000')) as Record<string, unknown>
  const current = value.current as Record<string, unknown>
  current.tierRevision = 7
  if (pendingOperationId) {
    value.pendingTierChange = {
      schemaVersion: 1, operationId: pendingOperationId, subscriptionTier: 'basic',
      expectedTierRevision: 7, effectivePolicy: 'next_billing_cycle', effectiveCycleIndex: 2,
      effectiveCycleStart: '2026-10-01T00:00:00.000000+00:00',
      effectiveCycleEnd: '2026-11-01T00:00:00.000000+00:00',
      scheduledAt: '2026-09-20T12:00:00.000000+00:00', reason: 'Administrative tier change',
    }
  }
  return JSON.stringify(value)
}

function tierPreviewBody(
  clientId: string,
  action = 'schedule',
  targetSubscriptionTier = 'basic',
  pendingTierChangeOperationId: string | null = null
): string {
  return JSON.stringify({
    clientId,
    subscriptionId: TIER_SUBSCRIPTION,
    action,
    currentSubscriptionTier: 'brand',
    targetSubscriptionTier,
    effectivePolicy: action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle',
    statusRevision: 4,
    classificationRevision: 5,
    tierRevision: 7,
    pendingTierChangeOperationId,
    policyPublicationId: '55555555-2222-4333-8444-555555555555',
    policyActivationRevision: 9,
    policyVersion: 'input-04-v1',
    policyHash: 'abc', commandEffectiveAt: action === 'apply_immediate' ? null : '2026-10-01T00:00:00.000000+00:00', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    evaluatedAt: '2026-09-20T12:00:00.000000+00:00',
    lossAt: '2026-10-01T00:00:00.000000+00:00',
    accessUntil: '2026-10-08T00:00:00.000000+00:00',
    earliestProofExpiry: null,
    retainedCount: 1,
    totalCount: 3,
    graceCount: 2,
    suspendedCount: 0,
    deadlineGroups: [{ lossAt: '2026-10-01T00:00:00.000000+00:00', accessUntil: '2026-10-08T00:00:00.000000+00:00', graceCount: 2, newlyAffectedCount: 2 }],
    deadlineGroupsTruncated: false, unlistedGraceCount: 0, unlistedNewlyAffectedCount: 0,
    affectedResourcesTruncated: false,
    preservationFacts: {
      contentPreserved: true,
      assetsPreserved: true,
      creditsUnchanged: true,
      acceptedAiWorkUnchanged: true,
    },
    affectedResources: [],
  })
}

function scheduledTierReceiptBody(clientId: string, body: string): string {
  const request = JSON.parse(body) as {
    operationId: string
    expectedTierRevision: number
    subscriptionTier: string
    reason: string
  }
  return JSON.stringify({
    schemaVersion: 1,
    receipt: {
      schemaVersion: 1,
      operationId: request.operationId,
      clientId,
      subscriptionId: TIER_SUBSCRIPTION,
      outcome: 'scheduled',
      effectivePolicy: 'next_billing_cycle',
      requestedSubscriptionTier: request.subscriptionTier,
      previousSubscriptionTier: 'brand',
      resultingSubscriptionTier: 'brand',
      expectedTierRevision: request.expectedTierRevision,
      previousTierRevision: request.expectedTierRevision,
      resultingTierRevision: request.expectedTierRevision,
      reason: request.reason,
      operationAsOf: '2026-09-20T12:00:00.000000+00:00',
      effectiveAt: '2026-10-01T00:00:00.000000+00:00',
      action: 'schedule',
      previousPendingTierChangeOperationId: null,
      pendingTierChangeOperationId: request.operationId,
      pendingSubscriptionTier: request.subscriptionTier,
      previousPendingSubscriptionTier: null,
    },
    tierState: {
      subscriptionTier: 'brand',
      tierRevision: request.expectedTierRevision,
      status: 'active',
      validFrom: '2026-09-01T00:00:00.000000+00:00',
      validTo: null,
      pendingTierChange: {
        schemaVersion: 1,
        operationId: request.operationId,
        subscriptionTier: request.subscriptionTier,
        expectedTierRevision: request.expectedTierRevision,
        effectivePolicy: 'next_billing_cycle',
        effectiveCycleIndex: 2,
        effectiveCycleStart: '2026-10-01T00:00:00.000000+00:00',
        effectiveCycleEnd: '2026-11-01T00:00:00.000000+00:00',
        scheduledAt: '2026-09-20T12:00:00.000000+00:00',
        reason: request.reason,
      },
      observedAt: '2026-09-20T12:00:00.000000+00:00',
    },
  })
}

async function installTierReads(
  page: Page,
  options: {
    pendingOperationId?: () => string | undefined
    beforePreview?: () => Promise<void>
    proofExpiresAt?: string
  } = {}
): Promise<void> {
  await page.route('**/api/backoffice/clients/*/capabilities', async (route) => {
    const clientId = /clients\/([^/]+)\/capabilities/.exec(route.request().url())?.[1] ?? CLIENT_A
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: paidCapabilitiesBody(clientId),
    })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/resource-access-preview', async (route) => {
    if (options.beforePreview) await options.beforePreview()
    const clientId = /clients\/([^/]+)\/billing\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    const request = JSON.parse(route.request().postData() ?? '{}') as {
      action?: string
      subscriptionTier?: string
    }
    const preview = JSON.parse(tierPreviewBody(
      clientId,
      request.action ?? 'schedule',
      request.subscriptionTier ?? 'basic',
      options.pendingOperationId?.() ?? null
    )) as Record<string, unknown>
    if (options.proofExpiresAt) {
      preview.earliestProofExpiry = options.proofExpiresAt
      preview.affectedResources = [{
        resourceType: 'domain_binding', resourceId: '33333333-2222-3333-8444-555555555555',
        disposition: 'grace', accessUntil: preview.accessUntil,
        proofExpiresAt: options.proofExpiresAt,
      }]
    }
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preview),
    })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const clientId = /clients\/([^/]+)\/billing\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: tierStateBody(clientId, options.pendingOperationId?.()),
    })
  })
}

function accountBody(clientId: string, owned = '10.0000'): string {
  return `{"creditAccountId":"11111111-2222-3333-4444-555555555555","clientId":"${clientId}","ownedBalance":${owned},"activelyReservedAmount":0.0000,"availableBalance":${owned},"activeReservationCount":0,"status":"active","asOf":"2026-09-06T12:00:00.000000+00:00","walletVersion":1}`
}

function emptyStateBody(clientId: string): string {
  return JSON.stringify({
    clientId, stateAsOf: '2026-09-06T12:00:00.000000+00:00', current: null,
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: '2026-09-06T12:00:00.000000+00:00', nextCursor: null },
  })
}

type LifecycleStatus = 'active' | 'paused' | 'cancelled' | 'expired'

function lifecycleStateBody(
  clientId: string,
  status: LifecycleStatus,
  validTo: string | null = null,
  stateAsOf = '2026-09-07T09:00:00.000000+00:00'
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
    unusedCreditPolicy: 'rollover', billingCycleAnchor: '2026-09-01T00:00:00.000000+00:00',
    status, validFrom: '2026-09-01T00:00:00.000000+00:00', validTo,
    createdAt: '2026-09-01T00:00:00.000000+00:00', updatedAt: stateAsOf,
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
    cycleStart: '2026-09-01T00:00:00.000000+00:00', cycleEnd: '2026-10-01T00:00:00.000000+00:00',
    creditAmount: '__AMOUNT__',
    ledgerEntryId: '44444444-4444-4444-8444-555555555555',
    createdAt: '2026-09-01T00:00:00.000000+00:00',
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
  const operationAsOf = '2026-09-07T09:00:01.000000+00:00'
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
    clientId, stateAsOf: '2026-09-06T12:00:00.000000+00:00', current: null,
    pendingChange: null,
    subscriptionHistory: [{
      subscriptionId, creationOperationId: operationId, planTermsOperationId: operationId,
      clientId, planName: 'Historical Pro', subscriptionTier: 'brand_premium', tierRevision: 4,
      cycleCreditAmount: 1250.0000, entitlements,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor: '2026-08-01T00:00:00.000000+00:00', status: 'cancelled',
      validFrom: '2026-08-01T00:00:00.000000+00:00', validTo: '2026-09-05T00:00:00.000000+00:00',
      createdAt: '2026-08-01T00:00:00.000000+00:00', updatedAt: '2026-09-05T00:00:00.000000+00:00',
    }],
    grantHistory: {
      items: [{
        grantId: continuation ? '33333333-3333-4333-8333-555555555554' : '33333333-3333-4333-8333-555555555555',
        grantOperationId: continuation ? '01991f20-2234-7abc-8abc-1234567890aa' : '01991f20-2234-7abc-8abc-1234567890ab',
        subscriptionId, planTermsOperationId: operationId, planNameSnapshot: 'Historical Pro',
        subscriptionTierSnapshot: 'basic', tierRevisionSnapshot: 1,
        entitlementsSnapshot: entitlements, grantType: 'billing_cycle',
        cycleStart: `${month}-01T00:00:00.000000+00:00`, cycleEnd: `${nextMonth}-01T00:00:00.000000+00:00`,
        creditAmount: 1250.0000,
        ledgerEntryId: continuation ? '44444444-4444-4444-8444-555555555554' : '44444444-4444-4444-8444-555555555555',
        createdAt: `${month}-01T00:00:00.000000+00:00`,
      }],
      historyAsOf: '2026-09-06T12:00:00.000000+00:00', nextCursor: continuation ? null : 'older-page',
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
  await page.route('**/api/backoffice/clients/*/billing/account', async (route) => {
    const clientId = /clients\/([^/]+)\/billing\/account/.exec(route.request().url())?.[1] ?? CLIENT_A
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: accountBody(clientId) })
  })
  await page.route('**/api/backoffice/clients/*/billing/resource-access-consequences', async (route) => {
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: '[]' })
  })
}

async function fillDraft(page: Page): Promise<void> {
  await page.getByLabel('Plan name').fill('Pro')
  await page.getByLabel('Cycle credits').fill('1250.0000')
  await page.getByLabel('Requests per minute').fill('60')
  await page.getByLabel('Concurrent AI operations').fill('4')
  await page.getByLabel('Content generation').check()
  await page.getByLabel('Valid from').fill('2026-09-22T12:00')
  await page.getByLabel('Ongoing (no end)').check()
}

async function fulfillLocalSubscriptionPreview(route: Route): Promise<void> {
  const request = route.request().postDataJSON() as { validFrom: string; endCycleIndex: number | null }
  const local = (wall: string) => (wall)
  await fulfillLocal(route, { status: 200, contentType: 'application/json', body: JSON.stringify({
    status: 'resolved', validFrom: local(request.validFrom),
    firstCycleBoundary: local('2026-10-22T12:00:00.000000'), validTo: null,
    endCycleIndex: request.endCycleIndex,
    resolutionFingerprint: `v1.${'a'.repeat(64)}`,
  }) })
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations).toEqual([])
}

test.beforeEach(async ({ page }, testInfo) => {
  await installSession(page, testInfo.title.includes('permission loss') ? 'Viewer' : 'Admin')
  await installTimeZoneRoute(page)
  await installReads(page)
})

test('requires and freezes an explicit paid tier before subscription creation', async ({ page }) => {
  const bodies: string[] = []
  await page.route('**/api/backoffice/clients/*/capabilities', async (route) => {
    await fulfillLocal(route, {
      status: 200, contentType: 'application/json', body: freemiumCapabilitiesBody(CLIENT_A),
    })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    if (new URL(route.request().url()).pathname.endsWith('/local-time-preview'))
      return fulfillLocalSubscriptionPreview(route)
    bodies.push(route.request().postData() ?? '')
    await fulfillLocal(route, { status: 400, contentType: 'application/problem+json', body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  const tier = page.getByRole('combobox', { name: 'Subscription tier' })
  await expect(tier).toHaveAttribute('required', '')
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeEnabled()
  await expect(tier.getByRole('option', { name: /freemium/i })).toHaveCount(0)
  await fillDraft(page)
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await expect(page.getByRole('alert', { name: 'Correct the subscription form' })).toContainText('tier')
  await tier.selectOption('brand_premium')
  await page.getByRole('button', { name: 'Review subscription' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription creation' })
  await expect(dialog).toContainText('Brand Premium')
  await expect(dialog.getByRole('button', { name: 'Confirm creation' })).toBeEnabled()
  expect(bodies).toEqual([])
  await expectNoAxeViolations(page)
})

test('finite local creation keeps local request and review dates out of canonical UTC wire and DOM', async ({ page }) => {
  let postedBody = ''
  await page.route('**/api/billing/clients/**', async (route) => {
    throw new Error(`Canonical billing route reached: ${route.request().url()}`)
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    if (new URL(route.request().url()).pathname.endsWith('/local-time-preview')) {
      const request = route.request().postDataJSON() as { validFrom: string; endCycleIndex: number }
      expect(request).toMatchObject({ validFrom: '2026-09-22T12:00:00.000000', endCycleIndex: 2 })
      const local = (wall: string) => (wall)
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'resolved', validFrom: local(request.validFrom),
        firstCycleBoundary: local('2026-10-22T12:00:00.000000'),
        validTo: local('2026-11-22T12:00:00.000000'), endCycleIndex: 2,
        resolutionFingerprint: `v1.${'a'.repeat(64)}`,
      }) })
      return
    }
    postedBody = route.request().postData() ?? ''
    await fulfillLocal(route, { status: 400, contentType: 'application/problem+json', body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillDraft(page)
  await page.getByRole('combobox', { name: 'Subscription tier' }).selectOption('basic')
  await page.getByLabel('Finite billing cycles').check()
  await page.getByLabel('Number of cycles').fill('2')
  await page.getByRole('button', { name: 'Review subscription' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription creation' })
  await expect(dialog).toContainText('2026-09-22')
  await expect(dialog).toContainText('2026-11-22')
  expect(await dialog.locator('time').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime'))))
    .toEqual(expect.arrayContaining(['2026-09-22T12:00:00.000000', '2026-11-22T12:00:00.000000']))
  expect(await dialog.locator('time[datetime$="Z"]').count()).toBe(0)
  await dialog.getByRole('button', { name: 'Confirm creation' }).click()
  await expect.poll(() => postedBody).not.toBe('')
  expect(postedBody).toContain('"validFrom":"2026-09-22T12:00:00.000000"')
  expect(postedBody).toContain('"endCycleIndex":2')
  expect(postedBody).not.toMatch(/"valid(?:From|To)":"[^\"]*Z"/)
})

test('replays one exact local creation body after a backend timezone change', async ({ page }) => {
  const bodies: string[] = []
  await page.route('**/api/backoffice/clients/*/capabilities', async (route) => {
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: freemiumCapabilitiesBody(CLIENT_A) })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
    } else if (path.endsWith('/local-time-preview')) {
      await fulfillLocalSubscriptionPreview(route)
    } else {
      bodies.push(route.request().postData() ?? '')
      await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' })
    }
  })
  await page.goto(pathFor(CLIENT_A))
  await fillDraft(page)
  await page.getByRole('combobox', { name: 'Subscription tier' }).selectOption('basic')
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription creation' })
    .getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('button', { name: 'Replay exact request' })).toBeVisible()
  expect(bodies).toHaveLength(1)
  await page.getByRole('button', { name: 'Replay exact request' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[1]).toBe(bodies[0])
  expect((JSON.parse(bodies[1]!) as { creationOperationId: string }).creationOperationId)
    .toBe((JSON.parse(bodies[0]!) as { creationOperationId: string }).creationOperationId)
})

test('rejects spring gaps and autumn overlaps with a validFrom field error', async ({ page }) => {
  await page.route('**/api/backoffice/clients/*/capabilities', async (route) => {
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: freemiumCapabilitiesBody(CLIENT_A) })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    if (!new URL(route.request().url()).pathname.endsWith('/local-time-preview'))
      throw new Error('Creation must wait for a valid preview')
    const request = route.request().postDataJSON() as { validFrom: string }
    expect(request).not.toHaveProperty('selectedOffset')
    const code = request.validFrom.startsWith('2026-03-29')
      ? 'local_time_nonexistent' : 'local_time_ambiguous'
    await route.fulfill({ status: 422, contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Choose another local time', code, field: 'validFrom' }) })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillDraft(page)
  await page.getByRole('combobox', { name: 'Subscription tier' }).selectOption('basic')
  const start = page.getByLabel('Valid from')
  await start.fill('2026-03-29T02:30')
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await expect(page.getByRole('alert', { name: 'Correct the subscription form' })).toContainText('Choose another time')
  await expect(start).toHaveValue('2026-03-29T02:30')
  await start.fill('2026-10-25T02:30')
  await page.getByRole('button', { name: 'Review subscription' }).click()
  await expect(page.getByRole('alert', { name: 'Correct the subscription form' })).toContainText('Choose another time')
  await expect(page.getByRole('combobox', { name: /Occurrence/ })).toHaveCount(0)
})

test('creation review acknowledges locally within 100ms p95 and labels held submission within 500ms', async ({ page }) => {
  let releaseCreation: (() => void) | undefined
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
      return
    }
    if (new URL(route.request().url()).pathname.endsWith('/local-time-preview'))
      return fulfillLocalSubscriptionPreview(route)
    await new Promise<void>((resolve) => { releaseCreation = resolve })
    await fulfillLocal(route, { status: 400, contentType: 'application/problem+json', body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  await fillDraft(page)
  await page.getByRole('combobox', { name: 'Subscription tier' }).selectOption('basic')
  const review = page.getByRole('button', { name: 'Review subscription' })
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription creation' })
  const samples: number[] = []
  for (let index = 0; index < 20; index += 1) {
    await review.evaluate((element) => {
      const evidence = window as unknown as { creationAckMs?: number }
      evidence.creationAckMs = undefined
      element.addEventListener('click', () => {
        const started = performance.now()
        const observer = new MutationObserver(() => {
          if ([...document.querySelectorAll('[role="status"]')].some((item) =>
            item.textContent?.includes('Checking the local time'))) {
            evidence.creationAckMs = performance.now() - started
            observer.disconnect()
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }, { once: true })
    })
    await review.click()
    await expect(dialog).toBeVisible()
    const sample = await page.evaluate(() => (window as unknown as { creationAckMs?: number }).creationAckMs)
    expect(sample).toBeDefined()
    samples.push(sample!)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  samples.sort((left, right) => left - right)
  const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1]!
  console.info(`Subscription review acknowledgement: 20 samples, p95=${p95Ms.toFixed(1)}ms`)
  expect(p95Ms).toBeLessThanOrEqual(100)

  await review.click()
  await dialog.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Creating or replaying the retained subscription operation' })).toBeVisible({ timeout: 500 })
  await expect.poll(() => Boolean(releaseCreation)).toBe(true)
  releaseCreation?.()
})

test('previews and schedules a tier downgrade while capability evidence is unavailable', async ({ page }) => {
  let pendingOperationId: string | undefined
  const commands: string[] = []
  await page.route('**/api/backoffice/clients/*/capabilities', async (route) => {
    await fulfillLocal(route, { status: 503, contentType: 'application/problem+json', body: '{}' })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/resource-access-preview', async (route) => {
    const request = JSON.parse(route.request().postData() ?? '{}') as { action: string }
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: JSON.stringify({
      clientId: CLIENT_A, subscriptionId: '22222222-2222-3333-8444-555555555555',
      action: request.action, currentSubscriptionTier: 'brand', targetSubscriptionTier: 'basic',
      effectivePolicy: 'next_billing_cycle', statusRevision: 4, classificationRevision: 5,
      tierRevision: 7, pendingTierChangeOperationId: null,
      policyPublicationId: '55555555-2222-4333-8444-555555555555',
      policyActivationRevision: 9, policyVersion: 'input-04-v1', policyHash: 'abc', commandEffectiveAt: '2026-10-01T00:00:00.000000+00:00', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      evaluatedAt: '2026-09-20T12:00:00.000000+00:00', lossAt: '2026-10-01T00:00:00.000000+00:00',
      accessUntil: '2026-10-08T00:00:00.000000+00:00', earliestProofExpiry: null,
      retainedCount: 1, totalCount: 3,
      graceCount: 2, suspendedCount: 0, deadlineGroups: [{ lossAt: '2026-10-01T00:00:00.000000+00:00', accessUntil: '2026-10-08T00:00:00.000000+00:00', graceCount: 2, newlyAffectedCount: 2 }], deadlineGroupsTruncated: false, unlistedGraceCount: 0, unlistedNewlyAffectedCount: 0, affectedResourcesTruncated: false,
      preservationFacts: { contentPreserved: true, assetsPreserved: true, creditsUnchanged: true, acceptedAiWorkUnchanged: true },
      affectedResources: [],
    }) })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    const body = route.request().postData() ?? ''
    commands.push(body)
    const request = JSON.parse(body) as {
      operationId: string; expectedTierRevision: number; subscriptionTier: string; reason: string
    }
    pendingOperationId = request.operationId
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 1,
      receipt: {
        schemaVersion: 1, operationId: request.operationId, clientId: CLIENT_A,
        subscriptionId: '22222222-2222-3333-8444-555555555555', outcome: 'scheduled',
        effectivePolicy: 'next_billing_cycle', requestedSubscriptionTier: 'basic',
        previousSubscriptionTier: 'brand', resultingSubscriptionTier: 'brand',
        expectedTierRevision: 7, previousTierRevision: 7, resultingTierRevision: 7,
        reason: request.reason, operationAsOf: '2026-09-20T12:00:00.000000+00:00',
        effectiveAt: '2026-10-01T00:00:00.000000+00:00',
        action: 'schedule', previousPendingTierChangeOperationId: null,
        pendingTierChangeOperationId: request.operationId, pendingSubscriptionTier: 'basic',
        previousPendingSubscriptionTier: null,
      },
      tierState: {
        subscriptionTier: 'brand', tierRevision: 7, status: 'active',
        validFrom: '2026-09-01T00:00:00.000000+00:00', validTo: null,
        pendingTierChange: {
          schemaVersion: 1, operationId: request.operationId, subscriptionTier: 'basic',
          expectedTierRevision: 7, effectivePolicy: 'next_billing_cycle', effectiveCycleIndex: 2,
          effectiveCycleStart: '2026-10-01T00:00:00.000000+00:00',
          effectiveCycleEnd: '2026-11-01T00:00:00.000000+00:00',
          scheduledAt: '2026-09-20T12:00:00.000000+00:00', reason: request.reason,
        }, observedAt: '2026-09-20T12:00:00.000000+00:00',
      },
    }) })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, {
        status: 200, contentType: 'application/json', body: tierStateBody(CLIENT_A, pendingOperationId),
      })
      return
    }
    await route.fallback()
  })

  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByText('Policy evidence could not be validated.')).toBeVisible()
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription tier change' })
  await expect(dialog).toContainText('At 2026-10-01T00:00:00.000000, new paid work will stop.')
  await expect(dialog).toContainText('Content and assets will not be deleted. Credits and accepted AI work are unchanged.')
  await dialog.getByRole('button', { name: 'Confirm tier change' }).click()
  await expect(page.getByText('Authoritative state reconciled.')).toBeVisible()
  expect(commands).toHaveLength(1)
  const request = JSON.parse(commands[0]!) as { operationId: string }
  expect(request.operationId).toMatch(/^\w{8}-\w{4}-7\w{3}-[89ab]\w{3}-\w{12}$/i)
  expect(commands[0]).toBe(`{"operationId":"${request.operationId}","expectedTierRevision":7,"subscriptionTier":"basic","effectivePolicy":"next_billing_cycle","reason":"Administrative tier change","commandAuthorityHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)
  await expectNoAxeViolations(page)
})

test('pending replacement uses the displayed new target and cancellation names the pending change', async ({ page }) => {
  const pendingOperationId = '01991f20-5678-7abc-8abc-1234567890ab'
  const previews: Array<{ action: string; subscriptionTier: string }> = []
  await installTierReads(page, { pendingOperationId: () => pendingOperationId })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/resource-access-preview', async (route) => {
    const request = JSON.parse(route.request().postData() ?? '{}') as {
      action: string; subscriptionTier: string
    }
    previews.push(request)
    await fulfillLocal(route, {
      status: 200, contentType: 'application/json',
      body: tierPreviewBody(CLIENT_A, request.action, request.subscriptionTier, pendingOperationId),
    })
  })

  await page.goto(pathFor(CLIENT_A))
  const target = page.getByRole('combobox', { name: 'Target tier' })
  await expect(target).toHaveValue('brand_premium')
  await expect(target.locator('option')).toHaveCount(1)
  await page.getByRole('button', { name: 'Replace pending tier' }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' }))
    .toContainText('Change brand to brand_premium')
  expect(previews[0]).toMatchObject({ action: 'replace', subscriptionTier: 'brand_premium' })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Cancel pending tier' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm pending tier cancellation' })
  await expect(dialog).toContainText('Cancel the pending basic tier change')
  await expect(dialog).not.toContainText('Change brand to basic')
  expect(previews[1]).toMatchObject({ action: 'cancel_pending', subscriptionTier: 'basic' })
  await expectNoAxeViolations(page)
})

test('tier preview and confirmation remain accessible under reflow and assistive display settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await installTierReads(page, { proofExpiresAt: '2026-10-04T00:00:00.000000+00:00' })
  await page.goto(pathFor(CLIENT_A))
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  const trigger = page.getByRole('button', { name: 'Schedule for next cycle' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription tier change' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect(dialog).toContainText('Content and assets will not be deleted.')
  await expect(dialog).toContainText('policy grace deadline for 2 affected resources is 2026-10-08T00:00:00.000000')
  await expect(dialog).toContainText('earliest known ownership or TLS proof expiry for an affected domain binding is 2026-10-04T00:00:00.000000')
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const targetSizes = await dialog.locator('button:visible').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  )
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.setViewportSize({ width: 320, height: 320 })
  await dialog.getByRole('button', { name: 'Confirm tier change' }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Confirm tier change' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('tier preview acknowledges locally within 100ms p95 and labels held progress within 500ms', async ({ page }) => {
  let releasePreview: (() => void) | undefined
  let releaseCommand: (() => void) | undefined
  await installTierReads(page, {
    beforePreview: () => new Promise<void>((resolve) => { releasePreview = resolve }),
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    await new Promise<void>((resolve) => { releaseCommand = resolve })
    await fulfillLocal(route, { status: 400, contentType: 'application/problem+json', body: '{}' })
  })
  await page.goto(pathFor(CLIENT_A))
  const trigger = page.getByRole('button', { name: 'Schedule for next cycle' })
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription tier change' })
  const samples: number[] = []
  for (let index = 0; index < 20; index += 1) {
    releasePreview = undefined
    await trigger.evaluate((element) => {
      const evidence = window as unknown as { tierAckMs?: number }
      evidence.tierAckMs = undefined
      element.addEventListener('click', () => {
        const started = performance.now()
        const observer = new MutationObserver(() => {
          if (document.querySelector('[role="status"].state-indicator')?.textContent?.includes('Preparing authoritative consequence preview')) {
            evidence.tierAckMs = performance.now() - started
            observer.disconnect()
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }, { once: true })
    })
    await trigger.click()
    await expect(page.getByRole('status').filter({ hasText: 'Preparing authoritative consequence preview' })).toBeVisible({ timeout: 500 })
    const sample = await page.evaluate(() => (window as unknown as { tierAckMs?: number }).tierAckMs)
    expect(sample).toBeDefined()
    samples.push(sample!)
    await expect.poll(() => Boolean(releasePreview)).toBe(true)
    releasePreview?.()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  samples.sort((left, right) => left - right)
  const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1]!
  const maxMs = samples.at(-1)!
  console.info(`Tier preview acknowledgement: 20 samples, p95=${p95Ms.toFixed(1)}ms, max=${maxMs.toFixed(1)}ms`)
  expect(p95Ms).toBeLessThanOrEqual(100)
  expect(maxMs).toBeLessThanOrEqual(500)

  releasePreview = undefined
  await trigger.click()
  await expect.poll(() => Boolean(releasePreview)).toBe(true)
  releasePreview?.()
  await expect(dialog).toBeVisible()
  releasePreview = undefined
  await dialog.getByRole('button', { name: 'Confirm tier change' }).click()
  await expect(dialog.getByRole('status').filter({ hasText: 'Checking fresh subscription and preview authority' })).toBeVisible({ timeout: 500 })
  await expect.poll(() => Boolean(releasePreview)).toBe(true)
  releasePreview?.()
  await expect(page.getByRole('status').filter({ hasText: 'Submitting the retained command' })).toBeVisible({ timeout: 500 })
  await expect.poll(() => Boolean(releaseCommand)).toBe(true)
  releaseCommand?.()
})

test('held fresh tier preflight shows progress before preview and blocks duplicate activation', async ({ page }) => {
  await installTierReads(page)
  await page.goto(pathFor(CLIENT_A))
  const trigger = page.getByRole('button', { name: 'Schedule for next cycle' })
  await expect(trigger).toBeVisible()
  let release: (() => void) | undefined
  let reads = 0
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() !== 'GET' ||
        !new URL(route.request().url()).pathname.endsWith('/subscriptions'))
      return route.fallback()
    reads += 1
    await new Promise<void>((resolve) => { release = resolve })
    await fulfillLocal(route, { status: 200, contentType: 'application/json',
      body: tierStateBody(CLIENT_A) })
  })
  await trigger.click()
  await expect(page.getByRole('status').filter({
    hasText: 'Checking fresh subscription authority before preview',
  })).toBeVisible({ timeout: 500 })
  await expect(trigger).toBeDisabled()
  await expect.poll(() => reads).toBe(1)
  release?.()
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toBeVisible()
})

test('handles every tier 409 variant without reusing stale confirmation material', async ({ page }) => {
  let code = 'subscription_tier_change_operation_conflict'
  const bodies: string[] = []
  await installTierReads(page)
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    bodies.push(route.request().postData() ?? '')
    await fulfillLocal(route, {
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({ code, detail: 'private concurrency detail' }),
    })
  })
  const cases = [
    'subscription_tier_change_operation_conflict',
    'subscription_tier_change_stale_revision',
    'subscription_tier_change_eligibility_conflict',
    'subscription_tier_change_pending_conflict',
    'subscription_tier_change_transition_pending',
  ]
  for (const nextCode of cases) {
    code = nextCode
    await page.goto(pathFor(CLIENT_A))
    await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
    await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
      .getByRole('button', { name: 'Confirm tier change' }).click()
    if (nextCode === 'subscription_tier_change_transition_pending') {
      await expect(page.getByText(/due tier transition is materializing/i)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh authority' })).toBeVisible()
    } else {
      await expect(page.getByText(/tier action was rejected/i)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Dismiss and start a fresh preview' })).toBeVisible()
    }
    await expect(page.getByText('private concurrency detail')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toHaveCount(0)
  }
  expect(bodies).toHaveLength(cases.length)
  expect(new Set(bodies.map((body) => JSON.parse(body).operationId)).size).toBe(cases.length)
})

test('purges private tier evidence on 403 authorization loss', async ({ page }) => {
  await installTierReads(page)
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    await fulfillLocal(route, {
      status: 403,
      contentType: 'application/problem+json',
      body: '{"code":"insufficient_permissions","detail":"private authorization detail"}',
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByLabel('Tier change justification').fill('Private tier reason')
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
    .getByRole('button', { name: 'Confirm tier change' }).click()

  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByText('Private tier reason')).toHaveCount(0)
  await expect(page.getByText('private authorization detail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Schedule for next cycle' })).toHaveCount(0)
})

test('handles privacy-safe tier 404 without retaining the attempted command', async ({ page }) => {
  await installTierReads(page)
  const bodies: string[] = []
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    bodies.push(route.request().postData() ?? '')
    await fulfillLocal(route, {
      status: 404,
      contentType: 'application/problem+json',
      body: '{"code":"subscription_not_found","detail":"private missing target"}',
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
    .getByRole('button', { name: 'Confirm tier change' }).click()

  await expect(page.getByText('private missing target')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toHaveCount(0)
  expect(bodies).toHaveLength(1)
})

test('treats tier 500 and malformed 200 responses as unknown without blind retry', async ({ page }) => {
  let malformed = false
  const bodies: string[] = []
  await installTierReads(page)
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    bodies.push(route.request().postData() ?? '')
    await fulfillLocal(route, malformed
      ? { status: 200, contentType: 'application/json', body: '{"private":"malformed tier receipt"}' }
      : { status: 500, contentType: 'application/problem+json', body: '{"detail":"private tier failure"}' })
  })
  for (const malformedResponse of [false, true]) {
    malformed = malformedResponse
    await page.goto(pathFor(CLIENT_A))
    await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
    await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
      .getByRole('button', { name: 'Confirm tier change' }).click()
    await expect(page.getByText(/command outcome is unknown/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Replay exact retained command' })).toBeEnabled()
    await expect(page.getByText(/private tier failure|malformed tier receipt/)).toHaveCount(0)
    expect(bodies).toHaveLength(malformedResponse ? 2 : 1)
  }
})

test('replays a byte-identical tier command after transport ambiguity', async ({ page }) => {
  let pendingOperationId: string | undefined
  const bodies: string[] = []
  await installTierReads(page, { pendingOperationId: () => pendingOperationId })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    const body = route.request().postData() ?? ''
    bodies.push(body)
    if (bodies.length === 1) {
      await route.abort('connectionreset')
      return
    }
    pendingOperationId = (JSON.parse(body) as { operationId: string }).operationId
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: scheduledTierReceiptBody(CLIENT_A, body),
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
    .getByRole('button', { name: 'Confirm tier change' }).click()
  await expect(page.getByText(/command outcome is unknown/i)).toBeVisible()
  await page.getByRole('button', { name: 'Replay exact retained command' }).click()
  await expect(page.getByText('Authoritative state reconciled.')).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('Client switching fences late tier previews and command receipts', async ({ page }) => {
  let holdPreview = true
  let releasePreview: (() => void) | undefined
  let releaseCommand: (() => void) | undefined
  let delayedCommand = ''
  await installTierReads(page, {
    beforePreview: async () => {
      if (holdPreview) await new Promise<void>((resolve) => { releasePreview = resolve })
    },
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    delayedCommand = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releaseCommand = resolve })
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: scheduledTierReceiptBody(CLIENT_A, delayedCommand),
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await expect(page.getByText(/Preparing authoritative consequence preview/)).toBeVisible()
  await expect.poll(() => Boolean(releasePreview)).toBe(true)
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  holdPreview = false
  releasePreview?.()
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toHaveCount(0)

  await page.goBack()
  await expect(page.getByText(`Selected Client: ${CLIENT_A}`)).toBeVisible()
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
    .getByRole('button', { name: 'Confirm tier change' }).click()
  await expect.poll(() => Boolean(releaseCommand)).toBe(true)
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  releaseCommand?.()
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tier command receipt' })).toHaveCount(0)
  await expect(page.getByText('Authoritative state reconciled.')).toHaveCount(0)
})

test('Client switching closes tier confirmation and fences delayed reconciliation', async ({ page }) => {
  let pendingOperationId: string | undefined
  let blockReconciliation = false
  let releaseReconciliation: (() => void) | undefined
  await installTierReads(page, { pendingOperationId: () => pendingOperationId })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const clientId = /clients\/([^/]+)\/billing\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (blockReconciliation && clientId === CLIENT_A) {
      await new Promise<void>((resolve) => { releaseReconciliation = resolve })
    }
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: tierStateBody(clientId, clientId === CLIENT_A ? pendingOperationId : undefined),
    })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions/**/tier-changes', async (route) => {
    const body = route.request().postData() ?? ''
    pendingOperationId = (JSON.parse(body) as { operationId: string }).operationId
    blockReconciliation = true
    await fulfillLocal(route, {
      status: 200,
      contentType: 'application/json',
      body: scheduledTierReceiptBody(CLIENT_A, body),
    })
  })

  await page.goto(pathFor(CLIENT_A))
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toBeVisible()
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  await expect(page.getByRole('dialog', { name: 'Confirm subscription tier change' })).toHaveCount(0)

  await page.goBack()
  await expect(page.getByText(`Selected Client: ${CLIENT_A}`)).toBeVisible()
  await page.getByRole('button', { name: 'Schedule for next cycle' }).click()
  await page.getByRole('dialog', { name: 'Confirm subscription tier change' })
    .getByRole('button', { name: 'Confirm tier change' }).click()
  await expect(page.getByText(/Reconciling authoritative subscription and consequence state/)).toBeVisible()
  await expect.poll(() => Boolean(releaseReconciliation)).toBe(true)
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathFor(CLIENT_B))
  releaseReconciliation?.()
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tier command receipt' })).toHaveCount(0)
  await expect(page.getByText('Authoritative state reconciled.')).toHaveCount(0)
})

test('pauses then reactivates with exact Client-scoped lifecycle commands', async ({ page }) => {
  let status: LifecycleStatus = 'active'
  const bodies: string[] = []
  let releasePause: (() => void) | undefined
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    const request = JSON.parse(body) as { action: string }
    status = request.action === 'pause' ? 'paused' : 'active'
    if (request.action === 'pause') {
      await new Promise<void>((resolve) => { releasePause = resolve })
    }
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status) })
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
  const validTo = '2026-09-07T09:00:00.000000+00:00'
  let status: LifecycleStatus = 'active'
  let selectedAction = ''
  await page.route('**/api/backoffice/clients/*/billing/account', async (route) => {
    await fulfillLocal(route, { status: 500, contentType: 'application/problem+json', body: '{"detail":"unavailable"}' })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status, validTo) })
      return
    }
    const body = route.request().postData() ?? ''
    selectedAction = (JSON.parse(body) as { action: string }).action
    status = selectedAction === 'expire' ? 'expired' : 'cancelled'
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status, validTo) })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('button', { name: 'Expire subscription' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause subscription' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Expire subscription' }).click()
  await expect(page.getByRole('dialog')).toContainText('2026-09-07T09:00:00.000000')
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
    const validTo = action === 'expire' ? '2026-09-07T09:00:00.000000+00:00' : null
    let status: LifecycleStatus = sourceStatus
    await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillLocal(route, {
          status: 200, contentType: 'application/json',
          body: lifecycleStateBody(CLIENT_A, status, validTo),
        })
        return
      }
      const body = route.request().postData() ?? ''
      status = resultStatus
      await fulfillLocal(route, {
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status, validTo) })
      return
    }
    body = route.request().postData() ?? ''
    status = 'cancelled'
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status, validTo) })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    status = 'paused'
    if (postCount === 1) await route.abort('connectionreset')
    else await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      const status: LifecycleStatus = getCount === 1 ? 'active' : 'paused'
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    postCount += 1
    await fulfillLocal(route, { status: 500, body: '{}' })
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
    await fulfillLocal(route, {
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'refreshed-token', refreshToken: 'refreshed-refresh' }),
    })
  })
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, status) })
      return
    }
    const body = route.request().postData() ?? ''
    bodies.push(body)
    postCount += 1
    if (postCount === 1) {
      await fulfillLocal(route, { status: 401, contentType: 'application/problem+json', body: '{"detail":"expired"}' })
      return
    }
    status = 'paused'
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, status) })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, {
        status: 200, contentType: 'application/json',
        body: lifecycleStateBody(
          CLIENT_A, 'active', due ? '2026-09-07T09:00:00.000000+00:00' : null
        ),
      })
      return
    }
    await fulfillLocal(route, {
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    await fulfillLocal(route, {
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    await fulfillLocal(route, deny
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    body = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releasePost = resolve })
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      if (getCount > 2) {
        await fulfillLocal(route, { status: 500, contentType: 'application/problem+json', body: '{"detail":"private refresh failure"}' })
      } else {
        await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      }
      return
    }
    const body = route.request().postData() ?? ''
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(body, 'paused') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
      return
    }
    bodies.push(route.request().postData() ?? '')
    await fulfillLocal(route, malformed
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1
      if (getCount > 2) {
        await fulfillLocal(route, { status: 500, contentType: 'application/problem+json', body: '{}' })
      } else {
        await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    const clientId = /clients\/([^/]+)\/billing\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (route.request().method() === 'GET') {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(clientId, 'active') })
      return
    }
    oldBody = route.request().postData() ?? ''
    await new Promise<void>((resolve) => { releasePost = resolve })
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleReceiptBody(oldBody, 'paused') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: lifecycleStateBody(CLIENT_A, 'active') })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const clientId = /clients\/([^/]+)\/billing\/subscriptions/.exec(route.request().url())?.[1] ?? CLIENT_A
    if (clientId === CLIENT_B) await new Promise<void>((resolve) => { releaseB = resolve })
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(clientId) })
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions*', async (route) => {
    urls.push(route.request().url())
    const continuation = new URL(route.request().url()).searchParams.get('cursor') === 'older-page'
    await fulfillLocal(route, {
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
  await page.route('**/api/backoffice/clients/*/billing/subscriptions**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/local-time-preview'))
      return fulfillLocalSubscriptionPreview(route)
    await fulfillLocal(route, { status: 200, contentType: 'application/json', body: emptyStateBody(CLIENT_A) })
  })
  await page.goto(pathFor(CLIENT_A))
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  await fillDraft(page)
  await page.getByRole('combobox', { name: 'Subscription tier' }).selectOption('basic')
  await expect(page.getByRole('button', { name: 'Review subscription' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const targetSizes = await page.locator('a:visible, button:visible, input:not([type="checkbox"]):not([type="radio"]):visible, label:has(input[type="checkbox"]):visible, label:has(input[type="radio"]):visible').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  )
  expect(targetSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await expectNoAxeViolations(page)
  const review = page.getByRole('button', { name: 'Review subscription' })
  await review.click()
  const dialog = page.getByRole('dialog', { name: 'Confirm subscription creation' })
  await expect(dialog).toBeVisible()
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(review).toBeFocused()
})

test('subscription permission loss denies direct access without exposing private controls', async ({ page }) => {
  await page.route('**/api/backoffice/clients/*/billing/subscriptions*', async (route) => {
    await fulfillLocal(route, {
      status: 403, contentType: 'application/json', body: '{"error":"Insufficient permissions"}',
    })
  })
  await page.goto(pathFor(CLIENT_A))
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByLabel('Plan name')).toHaveCount(0)
})

test('malformed subscription state fails closed without rendering private values', async ({ page }) => {
  await page.route('**/api/backoffice/clients/*/billing/subscriptions*', async (route) => {
    await fulfillLocal(route, {
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

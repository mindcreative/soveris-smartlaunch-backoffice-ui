import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { fulfillLocal } from './localPresentationMocks'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const RESERVATION_ID = '01995d88-7740-73f1-8000-000000000002'
const RESULT_ID = '01995d88-7740-73f1-8000-000000000005'
const QUOTE_ID = 'iaq1_deterministic-private-quote'
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'base64')

const capabilityKeys = ['manual_content_editing', 'ordinary_image_upload', 'ai_content_generation', 'ai_image_generation', 'ai_source_ingestion', 'client_domain_binding', 'product_domain_binding', 'analytics', 'ab_testing']
const limits = [['active_products', 'count', 10], ['hostnames', 'count', 10], ['storage_bytes', 'bytes', 10485760], ['requests_per_minute', 'requests_per_minute', 60], ['concurrent_ai_operations', 'count', 2], ['retention_days', 'days', 30]]

function capabilities() {
  return {
    clientId: CLIENT_ID, classificationSource: 'back_office.clients', classification: 'customer', classificationRevision: 1,
    policySource: 'customer_subscription', policyVersion: 'fixture-5.11-v1',
    subscription: { storedTier: 'brand', effectiveTier: 'brand', status: 'active', tierRevision: 1, validFrom: '2026-01-01T00:00:00Z', validTo: null },
    flags: capabilityKeys.map((key) => ({ key, enabled: key !== 'ai_source_ingestion' })),
    limits: limits.map(([key, unit, value]) => ({ key, unit, value })),
    usage: limits.map(([key, unit]) => ({ key, unit, value: 0, measuredAt: '2026-10-02T08:00:00Z' })),
    operations: capabilityKeys.map((key) => {
      const ai = key.startsWith('ai_')
      const source = key === 'ai_source_ingestion'
      return {
        key, outcome: source ? 'denied' : 'eligible', permission: 'satisfied', feature: source ? 'denied' : 'satisfied',
        entitlement: ai ? 'satisfied' : 'not_applicable', resourceLimit: 'satisfied',
        provider: ai ? 'satisfied' : 'not_applicable', pricing: ai ? 'satisfied' : 'not_applicable',
        funding: ai ? 'available_requires_quote' : 'not_applicable', denialConditions: source ? ['feature_not_available'] : [],
      }
    }),
    evaluatedAt: '2026-10-02T08:00:00Z', nextBoundary: null,
  }
}

function completedStatus(credits = 2.25) {
  return {
    jobId: JOB_ID, clientId: CLIENT_ID, requestType: 'image_generation', targetRole: 'hero', status: 'completed', attemptCount: 1,
    createdAt: '2026-10-02T08:00:00+00:00', updatedAt: '2026-10-02T08:00:05+00:00', processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:05+00:00', completedAt: '2026-10-02T08:00:05+00:00',
    quote: { credits, ruleVersion: 'fixture-image-rule' },
    reservation: { reservationId: RESERVATION_ID, state: 'committed', estimatedCredits: credits, actualCredits: credits, createdAt: '2026-10-02T08:00:00+00:00', expiresAt: '2026-10-02T08:05:00+00:00', committedAt: '2026-10-02T08:00:05+00:00', releasedAt: null },
    result: { resultId: RESULT_ID, mediaType: 'image/webp', width: 1, height: 1, byteSize: webp.length, observedAt: '2026-10-02T08:00:04+00:00', createdAt: '2026-10-02T08:00:05+00:00', expiresAt: '2026-10-09T08:00:05+00:00' },
    resultAccess: { reference: 'opaque-private-fixture-reference', expiresAt: '2026-10-02T08:05:05+00:00' },
    guidance: { code: 'completed', poll: false },
  }
}

async function session(page: Page, role = 'Admin') {
  await page.addInitScript(({ clientId, actorRole }) => {
    const user = { id: 'operator', email: 'operator@example.test', displayName: 'Operator', role: actorRole, clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0 }))
  }, { clientId: CLIENT_ID, actorRole: role })
}

async function respondJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body) })
}

test.beforeEach(async ({ page }) => { await session(page) })

test('local fixture: fractional quote is reviewed and submitted through closed local seams', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: string | null }> = []
  await page.route('**/api/backoffice/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/ai/backend-preparations') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'ready' }) }); return }
    requests.push({ method: request.method(), path, body: request.postData() })
    if (path === `/api/backoffice/clients/${CLIENT_ID}/capabilities`) {
      await fulfillLocal(route, { status: 200, contentType: 'application/json', body: JSON.stringify(capabilities()) })
      return
    }
    await route.abort()
  })
  await page.route('**/api/ai/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/ai/backend-preparations') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'ready' }) }); return }
    requests.push({ method: request.method(), path, body: request.postData() })
    if (request.method() === 'POST' && path === '/api/ai/image-admission-quotes') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          quoteId: QUOTE_ID, operation: 'image_generation', targetRole: 'feature', quotedCredits: 1.2345,
          ruleVersion: 'fixture-fractional-v1', issuedAt: new Date(Date.now() - 1_000).toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        }),
      })
      return
    }
    if (request.method() === 'POST' && path === '/api/ai/image-jobs') {
      await route.fulfill({
        status: 202, contentType: 'application/json',
        body: JSON.stringify({
          jobId: JOB_ID, reservationId: RESERVATION_ID,
          eventId: '01995d88-7740-73f1-8000-000000000003', quotedCredits: 1.2345,
          status: 'reserved', correlationId: '01995d88-7740-73f1-8000-000000000004', replay: false,
        }),
      })
      return
    }
    if (request.method() === 'GET' && path === `/api/ai/jobs/${JOB_ID}`) {
      await respondJson(route, completedStatus(1.2345))
      return
    }
    await route.abort()
  })

  await page.goto('/ai')
  await expect(page.getByRole('heading', { name: 'AI image generation' })).toBeVisible()
  await page.getByLabel('Image prompt').fill('A restrained private product launch image')
  await page.getByRole('radio', { name: 'Feature image' }).check()
  await page.getByRole('button', { name: 'Review and quote' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
  await expect(page.getByText('1.2345 abstract credits')).toBeVisible()
  await expect(page.getByText('fixture-fractional-v1')).toBeVisible()
  await expect(page.getByText(/not a reservation or charge/i)).toBeVisible()
  await expect(page.getByText(QUOTE_ID)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Submit image Job' })).toBeEnabled()
  const targets = await Promise.all([
    page.getByRole('button', { name: 'Submit image Job' }).boundingBox(),
    page.getByRole('button', { name: 'Cancel review' }).boundingBox(),
    page.getByRole('radio', { name: 'Feature image' }).locator('..').boundingBox(),
  ])
  for (const target of targets) {
    expect(target?.width).toBeGreaterThanOrEqual(44)
    expect(target?.height).toBeGreaterThanOrEqual(44)
  }
  expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).toMatchObject({ violations: [] })

  // A 320 CSS-pixel viewport is the WCAG reflow equivalent of 400% zoom at 1280px.
  await page.setViewportSize({ width: 320, height: 640 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.addStyleTag({ content: '* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Submit image Job' }).click()
  await expect(page).toHaveURL(`/ai/image-jobs/${JOB_ID}`)
  await expect(page.getByText('1.2345 abstract credits').first()).toBeVisible()
  const quoteRequest = requests.find((item) => item.path === '/api/ai/image-admission-quotes')!
  expect(JSON.parse(quoteRequest.body!)).toEqual({ targetRole: 'feature' })
  const admissionRequest = requests.find((item) => item.path === '/api/ai/image-jobs')!
  const admission = JSON.parse(admissionRequest.body!) as Record<string, string>
  expect(admission).toEqual({
    idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    prompt: 'A restrained private product launch image', targetRole: 'feature', quoteId: QUOTE_ID,
  })
  expect(page.url()).not.toContain(QUOTE_ID)
  const persisted = await page.evaluate(() => JSON.stringify(localStorage))
  expect(persisted).not.toContain(QUOTE_ID)
  expect(persisted).not.toContain('A restrained private product launch image')
})

test('local fixture: direct URL tracks and privately redeems WebP without product attachment', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: string | null }> = []
  await page.route('**/api/ai/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/ai/backend-preparations') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'ready' }) }); return }
    requests.push({ method: request.method(), path, body: request.postData() })
    if (request.method() === 'GET' && path === `/api/ai/jobs/${JOB_ID}`) {
      await respondJson(route, completedStatus())
      return
    }
    if (request.method() === 'POST' && path === `/api/ai/jobs/${JOB_ID}/result-redemptions`) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await route.fulfill({ status: 200, contentType: 'image/webp', body: webp })
      return
    }
    await route.abort()
  })

  await page.goto(`/ai/image-jobs/${JOB_ID}`)
  await expect(page.getByRole('heading', { name: 'Image Job' })).toBeVisible()
  await expect(page.getByText('Completed').first()).toBeVisible()
  await expect(page.getByText(/2\.25 abstract credits/).first()).toBeVisible()
  await expect(page.getByText('opaque-private-fixture-reference')).toHaveCount(0)
  await page.getByRole('button', { name: 'View result' }).click()
  await expect(page.getByText('Loading private preview…')).toBeVisible({ timeout: 500 })
  await expect(page.getByRole('img', { name: 'Private generated hero image preview' })).toBeVisible()
  await expect(page.getByText(/not attached to a product/i).last()).toBeVisible()
  await expect(page.getByRole('button', { name: /apply|save|attach/i })).toHaveCount(0)
  expect(requests).toEqual([
    { method: 'GET', path: `/api/ai/jobs/${JOB_ID}`, body: null },
    { method: 'POST', path: `/api/ai/jobs/${JOB_ID}/result-redemptions`, body: JSON.stringify({ reference: 'opaque-private-fixture-reference' }) },
  ])
  expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).toMatchObject({ violations: [] })
})

test('local fixture: malformed Job URL is rejected without a status request', async ({ page }) => {
  let requests = 0
  await page.route('**/api/ai/**', async (route) => { requests += 1; await route.abort() })
  await page.goto('/ai/image-jobs/01995D88-7740-73F1-8000-000000000001')
  await expect(page.getByRole('heading', { name: 'Invalid image Job link' })).toBeVisible()
  expect(requests).toBe(0)
})

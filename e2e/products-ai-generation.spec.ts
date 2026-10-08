import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const RESERVATION_ID = '01995d88-7740-73f1-8000-000000000002'
const ATTEMPT_ID = '01995d88-7740-73f1-8000-000000000003'
const CORRELATION_ID = '01995d88-7740-73f1-8000-000000000004'
const origin = JSON.parse(readFileSync(new URL('../src/contracts/product-content/v1/fixtures/valid/origin-full.json', import.meta.url), 'utf8'))

function product(clientId = CLIENT_A) {
  return { id: PRODUCT_ID, clientId, name: 'Origin', slug: 'origin', status: 'active', publicationStatus: 'draft', revision: 3, contentSchemaVersion: null, contentRevision: 1, draftSchemaVersion: 1, draftRevision: 7, completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' }
}

function contentEnvelope(revision = 7, content = origin) {
  return { productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision, content } }
}

const keys = ['manual_content_editing', 'ordinary_image_upload', 'ai_content_generation', 'ai_image_generation', 'ai_source_ingestion', 'client_domain_binding', 'product_domain_binding', 'analytics', 'ab_testing']
const limits = [['active_products', 'count', 10], ['hostnames', 'count', 10], ['storage_bytes', 'bytes', 10485760], ['requests_per_minute', 'requests_per_minute', 60], ['concurrent_ai_operations', 'count', 2], ['retention_days', 'days', 30]]

function capabilities(clientId = CLIENT_A, classification: 'customer' | 'soveris_internal' = 'customer', funding: 'available_requires_quote' | 'wallet_missing' = 'available_requires_quote') {
  const internal = classification === 'soveris_internal'
  return {
    clientId, classificationSource: 'back_office.clients', classification, classificationRevision: 1,
    policySource: internal ? 'internal' : 'customer_subscription', policyVersion: 'fixture-4.9-v1',
    subscription: internal ? null : { storedTier: 'brand', effectiveTier: 'brand', status: 'active', tierRevision: 1, validFrom: '2026-01-01T00:00:00Z', validTo: null },
    flags: keys.map((key) => ({ key, enabled: key !== 'ai_source_ingestion' })),
    limits: limits.map(([key, unit, value]) => ({ key, unit, value })),
    usage: limits.map(([key, unit]) => ({ key, unit, value: 0, measuredAt: '2026-09-28T10:00:00Z' })),
    operations: keys.map((key) => {
      const ai = key.startsWith('ai_')
      const source = key === 'ai_source_ingestion'
      const content = key === 'ai_content_generation'
      const deniedFunding = content && funding === 'wallet_missing'
      return { key, outcome: source || deniedFunding ? 'denied' : 'eligible', permission: 'satisfied', feature: source ? 'denied' : 'satisfied', entitlement: ai && !internal ? 'satisfied' : 'not_applicable', resourceLimit: 'satisfied', provider: ai ? 'satisfied' : 'not_applicable', pricing: ai ? 'satisfied' : 'not_applicable', funding: ai ? content ? funding : 'available_requires_quote' : 'not_applicable', denialConditions: source ? ['feature_not_available'] : deniedFunding ? ['wallet_missing'] : [] }
    }),
    evaluatedAt: '2026-09-28T10:00:00Z', nextBoundary: null,
  }
}

function admission() {
  return { jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID, status: 'completed', variations: ['Unverified transport value'], providerName: 'fixture', modelName: 'fixture-v1', usage: { inputTokens: 12, outputTokens: 5 }, committedCredits: 1, correlationId: CORRELATION_ID, replay: false }
}

function durable(status: 'completed' | 'failed' | 'execution_unknown') {
  const completed = status === 'completed'
  const failed = status === 'failed'
  return {
    jobId: JOB_ID, clientId: CLIENT_A, requestType: 'content_generation', status,
    correlationId: CORRELATION_ID, submittedByUserId: null,
    createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:01Z', processingStartedAt: completed || status === 'execution_unknown' ? '2026-09-28T10:00:00Z' : null, completedAt: '2026-09-28T10:00:01Z',
    result: completed ? { resultId: '01995d88-7740-73f1-8000-000000000005', variations: ['Persisted durable variation'], providerName: 'fixture', modelName: 'fixture-v1', observedAt: '2026-09-28T10:00:01Z', createdAt: '2026-09-28T10:00:01Z' } : null,
    attempt: { attemptId: ATTEMPT_ID, attemptNumber: 1, outcomeStatus: completed ? 'succeeded' : status === 'execution_unknown' ? 'execution_unknown' : 'failed', executionPhase: failed ? 'pre_dispatch' : 'resolved', providerName: completed ? 'fixture' : null, failureCategory: completed ? null : status === 'execution_unknown' ? 'timeout' : 'validation_error', retryDisposition: completed ? null : status === 'execution_unknown' ? 'unknown' : 'non_retryable', startedAt: '2026-09-28T10:00:00Z', completedAt: '2026-09-28T10:00:01Z' },
    reservation: { reservationId: RESERVATION_ID, state: completed ? 'committed' : failed ? 'released' : 'active', estimatedCredits: 1, actualCredits: completed ? 1 : null, createdAt: '2026-09-28T10:00:00Z', expiresAt: '2026-09-28T10:05:00Z', committedAt: completed ? '2026-09-28T10:00:01Z' : null, releasedAt: failed ? '2026-09-28T10:00:01Z' : null },
    usage: completed ? { usageId: '01995d88-7740-73f1-8000-000000000006', attemptId: ATTEMPT_ID, inputTokens: 12, outputTokens: 5, imagesGenerated: 0, costInCredits: 1, observedAt: '2026-09-28T10:00:01Z', createdAt: '2026-09-28T10:00:01Z' } : null,
    providerCost: completed ? { costId: '01995d88-7740-73f1-8000-000000000007', attemptId: ATTEMPT_ID, costStatus: 'unresolved', estimatedPrice: null, estimatedCostSource: null, actualPrice: null, actualCostSource: null, currencyCode: null, capturedAt: '2026-09-28T10:00:01Z', reconciledAt: null } : null,
    guidance: completed ? { code: 'complete', poll: false, action: 'view_result' } : failed ? { code: 'failed', poll: false, action: 'contact_support' } : { code: 'outcome_unknown', poll: false, action: 'contact_support' },
  }
}

async function session(page: Page, clientId = CLIENT_A, role = 'Admin') {
  await page.addInitScript(({ clientId: id, role: actorRole }) => {
    const user = { id: 'operator', email: 'operator@example.test', displayName: 'Operator', role: actorRole, clientId: id, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0 }))
  }, { clientId, role })
}

async function respond(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await fulfillLocal(route, { status, headers, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body) })
}

async function installBase(
  page: Page,
  capability = capabilities(),
  onAi?: (route: Route) => Promise<void>,
  onContent?: (route: Route, path: string) => Promise<boolean>,
) {
  const handler = async (route: Route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    if (path === '/api/ai/backend-preparations') return respond(route, { state: 'ready' })
    if (path === '/api/backoffice/me/timezone') { await route.fallback(); return }
    if (onContent && await onContent(route, path)) return
    if (path === `/api/backoffice/clients/${CLIENT_A}/products`) return respond(route, { items: [product()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    if (path === `/api/backoffice/products/${PRODUCT_ID}`) return respond(route, product())
    if (path === `/api/backoffice/content/${PRODUCT_ID}`) return respond(route, { productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision: 7, content: origin } })
    if (path === `/api/backoffice/clients/${CLIENT_A}/capabilities`) return respond(route, capability)
    if (path.startsWith('/api/ai/') && onAi) return onAi(route)
    await route.abort()
  }
  await page.route('**/api/backoffice/**', handler)
  await page.route('**/api/ai/**', handler)
}

async function openEditor(page: Page) {
  await page.goto('/products')
  await page.getByRole('button', { name: 'Edit Origin' }).first().click()
  return page.getByRole('dialog', { name: 'Edit Origin' })
}

async function bindHeroTitle(editor: ReturnType<Page['getByRole']>) {
  await editor.getByLabel('Apply destination').selectOption('/hero/title')
}

test.beforeEach(async ({ page }) => { await session(page); await installTimeZoneRoute(page) })

test('eligible success renders only durable persisted text, preserves the draft, and uses canonical routes', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: string | null }> = []
  await installBase(page, capabilities(), async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    requests.push({ method: request.method(), path, body: request.postData() })
    if (path === '/api/ai/content-generations') return respond(route, admission())
    if (path === `/api/ai/jobs/${JOB_ID}`) return respond(route, durable('completed'))
    await route.abort()
  })
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  const originalTitle = await editor.getByLabel('Hero title').inputValue()
  const started = await editor.getByRole('button', { name: 'Generate' }).evaluate((button) => { const at = performance.now(); (button as HTMLButtonElement).click(); return at })
  await expect(editor.getByText(/Submitting one retained generation attempt|Generation completed; verifying/)).toBeVisible({ timeout: 500 })
  expect(await page.evaluate((at) => performance.now() - at, started)).toBeLessThan(500)
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  await expect(editor.getByText('Unverified transport value')).toHaveCount(0)
  await expect(editor.getByLabel('Hero title')).toHaveValue(originalTitle)
  await expect(editor.getByText(JOB_ID)).toBeVisible()
  await expect(editor.getByText(/Last checked/)).toBeVisible()
  expect(requests.filter((item) => item.method === 'POST')).toHaveLength(1)
  const body = JSON.parse(requests[0]!.body!)
  expect(Object.keys(body)).toEqual(['idempotencyKey', 'operation', 'contentType', 'productSlug', 'productName', 'existingContent', 'targetAudience', 'tone', 'variations', 'instructions', 'content'])
  expect(requests.some((item) => /\/api\/backoffice\/ai\//.test(item.path) || item.path.endsWith('/audit') || item.path.includes('/images') || item.path.includes('/draft') || item.path.includes('/publish'))).toBe(false)
  expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).toMatchObject({ violations: [] })

  await page.setViewportSize({ width: 320, height: 420 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await editor.getByText('Persisted durable variation').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.addStyleTag({ content: 'html { font-size: 100% !important; }' })
  await page.addStyleTag({ content: '* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }' })
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
    .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
    .map((element) => ({ tag: element.tagName, text: element.textContent?.slice(0, 80), right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })))).toEqual([])
  await page.setViewportSize({ width: 640, height: 320 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.addStyleTag({ content: '* { letter-spacing: normal !important; word-spacing: normal !important; line-height: normal !important; } p { margin-bottom: revert !important; }' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate(() => { document.documentElement.style.zoom = '4' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('keyboard-selects, reviews and applies one durable scalar through validate then revisioned PUT', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  let jobGets = 0
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/ai/content-generations') return respond(route, admission())
    jobGets += 1
    return respond(route, durable('completed'))
  }, async (route, path) => {
    const request = route.request()
    if (!path.startsWith(`/api/backoffice/content/${PRODUCT_ID}`)) return false
    const body = request.postDataJSON?.() ?? null
    requests.push({ method: request.method(), path, body })
    if (request.method() === 'GET') { await respond(route, contentEnvelope()); return true }
    if (path.endsWith('/validate')) {
      await respond(route, { schemaVersion: 1, isValid: true, errors: [], warnings: [] })
      return true
    }
    if (path.endsWith('/draft')) {
      const merged = (body as { content: typeof origin }).content
      await respond(route, contentEnvelope(8, merged))
      return true
    }
    return false
  })
  const editor = await openEditor(page)
  await editor.getByLabel('Generation target').selectOption('headline')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
  await expect(editor.getByText(/server-owned pre-submit credit amount or bound/i)).toBeVisible()

  const reviewTarget = await editor.getByRole('button', { name: 'Review Apply' }).boundingBox()
  const dismissTarget = await editor.getByRole('button', { name: 'Dismiss preview' }).boundingBox()
  const variationTarget = await editor.getByRole('radio', { name: 'Select variation 1' }).locator('..').boundingBox()
  for (const box of [reviewTarget, dismissTarget, variationTarget]) {
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }

  await editor.getByRole('radio', { name: 'Select variation 1' }).focus()
  await page.keyboard.press('Space')
  const acknowledgementSamples = await page.evaluate(async () => {
    const waitUntil = async (predicate: () => boolean) => {
      const deadline = performance.now() + 1_000
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for Apply review acknowledgement')
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const review = document.querySelector<HTMLButtonElement>('#ai-review-apply')!
      const started = performance.now()
      review.click()
      await waitUntil(() => document.querySelector('#ai-apply-review-heading') !== null)
      samples.push(performance.now() - started)
      document.querySelector<HTMLButtonElement>('#ai-cancel-apply')!.click()
      await waitUntil(() => document.querySelector('#ai-apply-review-heading') === null)
    }
    return samples
  })
  acknowledgementSamples.sort((left, right) => left - right)
  expect(acknowledgementSamples[Math.ceil(acknowledgementSamples.length * 0.95) - 1]).toBeLessThanOrEqual(100)
  await editor.getByRole('button', { name: 'Review Apply' }).focus()
  await page.keyboard.press('Enter')
  const review = editor.getByRole('heading', { name: 'Confirm Apply' }).locator('..')
  await expect(review).toContainText(CLIENT_A)
  await expect(review).toContainText('Origin')
  await expect(review).toContainText('Hero title')
  await expect(review).toContainText('Persisted durable variation')
  expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).toMatchObject({ violations: [] })
  await editor.getByRole('button', { name: 'Confirm Apply' }).focus()
  await page.keyboard.press('Enter')

  await expect(editor.getByLabel('Hero title')).toHaveValue('Persisted durable variation')
  await expect(editor.getByText(/draft saved at revision 8/i)).toBeVisible()
  expect(jobGets).toBe(2)
  const validation = requests.find((item) => item.path.endsWith('/validate'))!
  const save = requests.find((item) => item.path.endsWith('/draft'))!
  expect(validation).toMatchObject({ method: 'POST', body: { schemaVersion: 1, target: 'draft' } })
  expect((validation.body as { content: typeof origin }).content.hero.title).toBe('Persisted durable variation')
  expect(save).toMatchObject({ method: 'PUT', body: { schemaVersion: 1, expectedRevision: 7 } })
  expect((save.body as { content: typeof origin }).content.hero.title).toBe('Persisted durable variation')
  expect(requests.some((item) => item.path.endsWith('/publish'))).toBe(false)
  await page.setViewportSize({ width: 320, height: 320 })
  await editor.getByRole('textbox', { name: 'Hero subtitle' }).focus()
  await expect(editor.getByRole('textbox', { name: 'Hero subtitle' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Apply conflict preserves generated working text and revision evidence without a second PUT', async ({ page }) => {
  let puts = 0
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    return respond(route, path === '/api/ai/content-generations' ? admission() : durable('completed'))
  }, async (route, path) => {
    const request = route.request()
    if (path === `/api/backoffice/content/${PRODUCT_ID}` && request.method() === 'GET') {
      await respond(route, contentEnvelope()); return true
    }
    if (path.endsWith('/validate')) {
      await respond(route, { schemaVersion: 1, isValid: true, errors: [], warnings: [] }); return true
    }
    if (path.endsWith('/draft')) {
      puts += 1
      await respond(route, { status: 409, code: 'stale_draft_revision', title: 'Stale draft', currentSchemaVersion: 1, currentRevision: 2, currentDraftSchemaVersion: 1, currentDraftRevision: 8 }, 409)
      return true
    }
    return false
  })
  const editor = await openEditor(page)
  await editor.getByLabel('Generation target').selectOption('headline')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await editor.getByRole('radio', { name: 'Select variation 1' }).check()
  await editor.getByRole('button', { name: 'Review Apply' }).click()
  await editor.getByRole('button', { name: 'Confirm Apply' }).click()

  await expect(editor.getByText(/current live revision 2; current draft revision 8/i)).toBeVisible()
  await expect(editor.getByLabel('Hero title')).toHaveValue('Persisted durable variation')
  await expect(editor.getByRole('button', { name: 'Refresh and review server version' })).toBeVisible()
  expect(puts).toBe(1)
})

test('unrelated dirty draft disables Apply and sends no validation or draft write', async ({ page }) => {
  const contentMutations: Array<{ method: string; path: string }> = []
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    return respond(route, path === '/api/ai/content-generations' ? admission() : durable('completed'))
  }, async (route, path) => {
    const method = route.request().method()
    if (!path.startsWith(`/api/backoffice/content/${PRODUCT_ID}`) || method === 'GET') return false
    contentMutations.push({ method, path })
    await route.abort()
    return true
  })
  const editor = await openEditor(page)
  await editor.getByLabel('Generation target').selectOption('headline')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()

  await editor.getByLabel('Hero subtitle').fill('Unrelated local edit that must not be committed')
  await editor.getByRole('radio', { name: 'Select variation 1' }).check()

  await expect(editor.getByRole('button', { name: 'Review Apply' })).toBeDisabled()
  await expect(editor.getByText(/save or resolve unrelated working-draft edits/i)).toBeVisible()
  await expect(editor.getByLabel('Hero title')).toHaveValue(origin.hero.title)
  await expect(editor.getByLabel('Hero subtitle')).toHaveValue('Unrelated local edit that must not be committed')
  expect(contentMutations).toEqual([])
})

test('Dismiss clears only the local preview and returns focus without any server mutation', async ({ page }) => {
  const requests: Array<{ method: string; path: string }> = []
  await installBase(page, capabilities(), async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    requests.push({ method: request.method(), path })
    return respond(route, path === '/api/ai/content-generations' ? admission() : durable('completed'))
  })
  const editor = await openEditor(page)
  await editor.getByLabel('Generation target').selectOption('headline')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  const before = requests.length
  await editor.getByRole('button', { name: 'Dismiss preview' }).click()
  await expect(editor.getByText('Persisted durable variation')).toHaveCount(0)
  await expect(editor.getByText(JOB_ID)).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Generate' })).toBeFocused()
  expect(requests).toHaveLength(before)
})

test('authentication replay preserves the exact UUIDv7 identity and serialized POST bytes', async ({ page }) => {
  const bodies: string[] = []
  let admissions = 0
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/ai/content-generations') {
      admissions += 1
      bodies.push(route.request().postData() ?? '')
      if (admissions === 1) return respond(route, { status: 401, code: 'authentication_required', title: 'Authentication required' }, 401)
      return respond(route, admission())
    }
    return respond(route, durable('completed'))
  })
  await page.route('**/api/backoffice/auth/refresh', (route) => respond(route, { accessToken: 'refreshed-token', refreshToken: 'refreshed-token-2', expiresIn: 3600 }))
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
  expect(JSON.parse(bodies[0]!).idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

for (const scenario of [
  { name: 'validation', status: 422, code: 'invalid_content_request', title: 'The content request is invalid', expected: /content request is invalid/i },
  { name: 'insufficient credits', status: 402, code: 'insufficient_credits', title: 'Insufficient credits', expected: /credits are insufficient/i },
] as const) test(`shows distinct ${scenario.name} admission handling without mutating the draft`, async ({ page }) => {
  const calls: string[] = []
  await installBase(page, capabilities(), async (route) => {
    calls.push(new URL(route.request().url()).pathname)
    await respond(route, { type: 'about:blank', status: scenario.status, code: scenario.code, title: scenario.title }, scenario.status)
  })
  const editor = await openEditor(page)
  const title = editor.getByLabel('Hero title'); await title.fill('Unsaved local title')
  await bindHeroTitle(editor)
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByRole('alert')).toContainText(scenario.expected)
  await expect(title).toHaveValue('Unsaved local title')
  expect(calls).toEqual(['/api/ai/content-generations'])
})

test('internal missing funding is preflight-denied with no customer upgrade or POST', async ({ page }) => {
  const requests: string[] = []
  await installBase(page, capabilities(CLIENT_A, 'soveris_internal', 'wallet_missing'), async (route) => { requests.push(route.request().url()); await route.abort() })
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  await expect(editor.getByText(/funding is not configured or available for this internal Client/i)).toBeVisible()
  await expect(editor.getByText(/upgrade/i)).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Generate' })).toBeDisabled()
  expect(requests).toEqual([])
})

for (const [status, expected] of [
  ['failed', /did not run successfully/i],
  ['execution_unknown', /outcome is unknown/i],
] as const) test(`renders durable ${status} evidence without resubmission controls`, async ({ page }) => {
  let posts = 0
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/ai/content-generations') { posts += 1; return respond(route, admission()) }
    return respond(route, durable(status))
  })
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByRole('alert')).toContainText(expected)
  expect(posts).toBe(1)
  await expect(editor.getByRole('button', { name: /regenerate|apply|dismiss|recover/i })).toHaveCount(0)
})

test('lookup delay exposes GET-only Check status and permission loss clears the private panel', async ({ page }) => {
  let posts = 0; let gets = 0
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/ai/content-generations') { posts += 1; return respond(route, admission()) }
    gets += 1
    if (gets === 1) return respond(route, { status: 503, code: 'dependency_unavailable', title: 'Dependency unavailable' }, 503)
    return respond(route, { status: 403, code: 'forbidden', title: 'Forbidden' }, 403)
  })
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  await editor.getByRole('textbox', { name: 'Hero subtitle' }).fill('Authorized unsaved product edit')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByRole('button', { name: 'Check status' })).toBeVisible()
  await editor.getByRole('button', { name: 'Check status' }).click()
  await expect(editor.getByRole('alert')).toContainText(/permission changed/i)
  await expect(editor.getByText(JOB_ID)).toHaveCount(0)
  await expect(editor.getByRole('textbox', { name: 'Hero subtitle' })).toHaveValue('Authorized unsaved product edit')
  expect(posts).toBe(1); expect(gets).toBe(2)
})

test('navigation and browser history never restore a stale private result frame', async ({ page }) => {
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    return respond(route, path === '/api/ai/content-generations' ? admission() : durable('completed'))
  })
  const editor = await openEditor(page)
  await editor.getByLabel('Generation target').selectOption('headline')
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  await page.goto('/dashboard')
  await page.goBack()
  await expect(page).toHaveURL(/\/products/)
  await expect(page.getByText('Persisted durable variation')).toHaveCount(0)
  await expect(page.getByText(JOB_ID)).toHaveCount(0)
})

test('logout and a different-Client login clear all prior Job/result frames', async ({ page }) => {
  await installBase(page, capabilities(), async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/ai/content-generations') return respond(route, admission())
    return respond(route, durable('completed'))
  })
  const editor = await openEditor(page)
  await bindHeroTitle(editor)
  await editor.getByRole('button', { name: 'Generate' }).click()
  await expect(editor.getByText('Persisted durable variation')).toBeVisible()
  await editor.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.route('**/api/backoffice/auth/login', (route) => respond(route, { accessToken: 'b-token', refreshToken: 'b-refresh', expiresIn: 3600, user: { id: 'operator-b', displayName: 'Operator B', role: 'Admin', clientId: CLIENT_B } }))
  await page.getByLabel('Email address').fill('b@example.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Persisted durable variation')).toHaveCount(0)
  await expect(page.getByText(JOB_ID)).toHaveCount(0)
})

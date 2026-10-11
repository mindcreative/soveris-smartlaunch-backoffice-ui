import { expect, test, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'

const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const productId = '11111111-2222-3333-4444-555555555555'
const jobId = '018f0000-0000-7000-8000-000000000003'
const resultId = '018f0000-0000-7000-8000-000000000004'
const assetId = '018f0000-0000-7000-8000-000000000005'
const origin = JSON.parse(readFileSync(new URL('../src/contracts/product-content/v1/fixtures/valid/origin-full.json', import.meta.url), 'utf8'))
for (const environment of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: '320px', width: 320, height: 740 },
  { name: 'text200', width: 1280, height: 800 },
  { name: 'text-spacing', width: 1280, height: 800 },
  { name: 'forced-colours', width: 1280, height: 800 },
  { name: 'reduced-motion', width: 1280, height: 800 },
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'short-465x217', width: 465, height: 217 },
  { name: 'short-320x200', width: 320, height: 200 },
]) test(`completed image adoption and deliberate Apply: ${environment.name}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: environment.width, height: environment.height })
  if (environment.name === 'forced-colours') await page.emulateMedia({ forcedColors: 'active' })
  if (environment.name === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(({ client }) => {
    const user = { id: 'operator', email: 'operator@example.test', displayName: 'Operator', role: 'Admin', clientId: client,
      accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token'); localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0 }))
  }, { client })
  await installTimeZoneRoute(page)
  let revision = 7; let content = structuredClone(origin); let receipt: Record<string, unknown> | null = null
  const writes: string[] = []; let sourceReads = 0; let rejectedOperation = ''
  const product = () => ({ id: productId, clientId: client, name: 'Origin', slug: 'origin', status: 'active', publicationStatus: 'draft',
    revision: 3, contentSchemaVersion: null, contentRevision: 1, draftSchemaVersion: 1, draftRevision: revision,
    completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' })
  await page.route('**/api/backoffice/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method()
    if (path.endsWith('/me/timezone')) { await route.fallback(); return }
    const json = async (body: unknown, status = 200) => fulfillLocal(route, { status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === `/api/backoffice/clients/${client}/products`) return json({ items: [product()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    if (path === `/api/backoffice/products/${productId}`) return json(product())
    if (path === `/api/backoffice/content/${productId}`) return json({ productId, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision, content } })
    if (path.endsWith('/assets/images/adoptions') && method === 'POST') {
      const command = request.postDataJSON(); expect(Object.keys(command).sort()).toEqual(['assetRole', 'jobId', 'operationId', 'resultId'])
      await new Promise(resolve => setTimeout(resolve, 200))
      if (!rejectedOperation) {
        rejectedOperation = command.operationId; writes.push('adopt-rejected')
        return json({ type: 'about:blank', title: 'Storage limit exceeded', status: 409, code: 'storage_limit_exceeded' }, 409)
      }
      expect(command.operationId).not.toBe(rejectedOperation)
      writes.push('adopt'); receipt = { operationId: command.operationId, status: 'completed', jobId, resultId,
        asset: { id: assetId, productId, role: 'hero', url: `/assets/product-images/${assetId}.webp`, mediaType: 'image/webp',
          byteLength: 1000, width: 1200, height: 630, visibility: 'private', createdAt: '2026-10-10T10:00:00Z' },
        storage: { usedBytes: 1000, limitBytes: 2000, remainingBytes: 1000 } }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(receipt) })
    }
    if (path.includes('/assets/images/adoptions/') && method === 'GET') {
      await new Promise(resolve => setTimeout(resolve, 200))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) })
    }
    if (path.endsWith('/validate')) return json({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    if (path.endsWith('/draft') && method === 'PUT') {
      writes.push('draft'); const command = request.postDataJSON(); expect(command.expectedRevision).toBe(7)
      content = command.content; revision += 1
      return json({ productId, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision, content } })
    }
    await route.abort()
  })
  await page.route('**/api/ai/**', async route => {
    expect(route.request().method()).toBe('GET'); expect(new URL(route.request().url()).pathname).toBe(`/api/ai/jobs/${jobId}`)
    sourceReads += 1
    await new Promise(resolve => setTimeout(resolve, 200))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jobId, clientId: client, requestType: 'image_generation', targetRole: 'hero', status: 'completed', attemptCount: 1,
      createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:05Z', processingStartedAt: '2026-10-10T10:00:01Z',
      lastAttemptCompletedAt: '2026-10-10T10:00:05Z', completedAt: '2026-10-10T10:00:05Z', quote: { credits: 1, ruleVersion: 'fixture-image' },
      reservation: { reservationId: '018f0000-0000-7000-8000-000000000006', state: 'committed', estimatedCredits: 1, actualCredits: 1,
        createdAt: '2026-10-10T10:00:00Z', expiresAt: '2026-10-10T12:00:00Z', committedAt: '2026-10-10T10:00:05Z', releasedAt: null },
      result: { resultId, mediaType: 'image/webp', width: 1200, height: 630, byteSize: 1000, observedAt: '2026-10-10T10:00:04Z', createdAt: '2026-10-10T10:00:05Z', expiresAt: '2099-01-01T00:00:00Z' },
      resultAccess: null, guidance: { code: 'result_expired', poll: false } }) })
  })
  await page.goto('/products'); await page.getByRole('button', { name: 'Edit Origin' }).first().click()
  const editor = page.getByRole('dialog', { name: 'Edit Origin' })
  // The dialog opens before its product/content reads finish. Measure the
  // ready form, not the small transient loading placeholder.
  await expect(editor.getByLabel('Completed image Job ID')).toBeVisible()
  if (environment.name.startsWith('short-')) {
    // Short CSS viewports model both dimensions lost at high zoom. This is
    // regression automation, not a named human's actual 400% browser check.
    const geometry = await editor.evaluate(element => {
      const content = element.children[1] as HTMLElement
      return { contentHeight: content.clientHeight, viewportHeight: window.innerHeight }
    })
    expect(geometry.contentHeight).toBeGreaterThanOrEqual(120)
    for (const label of ['Completed image Job ID', 'Image destination']) {
      const field = editor.getByLabel(label); await field.focus()
      const rect = await field.boundingBox()
      expect(rect!.y).toBeGreaterThanOrEqual(0)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(environment.height)
    }
    await editor.getByRole('button', { name: 'Publish', exact: true }).focus()
    const footer = await editor.getByRole('button', { name: 'Publish', exact: true }).boundingBox()
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(environment.height)
    await testInfo.attach('short-viewport-before-flow', { body: await editor.screenshot(), contentType: 'image/png' })
  }
  if (environment.name === 'text200') await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  if (environment.name === 'text-spacing') await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
  await editor.getByRole('button', { name: 'Find completed image' }).focus(); await page.keyboard.press('Space')
  const summary = editor.getByRole('alert', { name: 'Generated image needs attention' })
  await expect(summary).toBeFocused()
  await editor.getByRole('button', { name: 'Enter a canonical completed image Job ID.' }).focus(); await page.keyboard.press('Space')
  await expect(editor.getByLabel('Completed image Job ID')).toBeFocused()
  await page.keyboard.type(jobId)
  const panel = page.getByRole('region', { name: 'Use a completed generated image' })
  const feedback: { phase: string; acknowledgementMs: number; labelledProgressMs: number }[] = []
  const activate = async (control: Locator, message: string, phase: string) => {
    await panel.evaluate((element, message) => {
      element.removeAttribute('data-acknowledgement-ms'); let started = 0
      element.addEventListener('click', () => { started = performance.now() }, { once: true })
      const observer = new MutationObserver(() => {
        if (started && element.querySelector('[role="status"]')?.textContent?.includes(message)) {
          element.setAttribute('data-acknowledgement-ms', String(performance.now() - started)); observer.disconnect()
        }
      }); observer.observe(element, { subtree: true, childList: true, characterData: true })
    }, message)
    await control.focus(); await page.keyboard.press('Space')
    await expect(panel.getByRole('status')).toContainText(message)
    if (phase === 'quota-retry') await expect(panel.getByRole('button', { name: 'Save private asset' })).toBeDisabled()
    else await expect(control).toBeDisabled()
    const value = await panel.getAttribute('data-acknowledgement-ms'); expect(value).not.toBeNull()
    const acknowledgement = Number(value); expect(acknowledgement).toBeLessThanOrEqual(100)
    feedback.push({ phase, acknowledgementMs: acknowledgement, labelledProgressMs: acknowledgement })
  }
  await activate(editor.getByRole('button', { name: 'Find completed image' }), 'Checking the completed image', 'selection')
  await editor.getByLabel('Alternative text for generated image').focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('A meaningful user-owned description')
  await activate(editor.getByRole('button', { name: 'Save private asset' }), 'Verifying the source and saving', 'adoption')
  await expect(summary).toBeFocused()
  await expect(editor.getByText('Product image storage is full. Free capacity, then explicitly start a new attempt.')).toBeVisible()
  await expect(editor.getByLabel('Alternative text for generated image')).toHaveValue('A meaningful user-owned description')
  expect(content).toEqual(origin)
  await activate(editor.getByRole('button', { name: 'Retry with a new operation' }), 'Verifying the source and saving', 'quota-retry')
  await expect(editor.getByRole('button', { name: 'Apply generated image' })).toBeEnabled()
  await expect(editor.getByLabel('Alternative text for generated image')).toBeFocused()
  expect(writes).toEqual(['adopt-rejected', 'adopt']); expect(content).toEqual(origin)
  await activate(editor.getByRole('button', { name: 'Apply generated image' }), 'Rechecking the asset, destination and draft revision', 'apply')
  await expect(editor.getByText('Generated image applied and draft saved. Publication is separate.')).toBeVisible()
  expect(writes).toEqual(['adopt-rejected', 'adopt', 'draft']); expect(sourceReads).toBe(1)
  const expected = structuredClone(origin); expected.hero.backgroundImage = { src: `/assets/product-images/${assetId}.webp`, alt: 'A meaningful user-owned description' }
  expect(content).toEqual(expected)
  await testInfo.attach('local-feedback', { body: JSON.stringify({ environment, feedback,
    scope: 'freshly built UI, mocked transport; emulated viewport/media/text settings, no physical-device or human result' }), contentType: 'application/json' })
  for (const control of await panel.getByRole('button').all()) {
    const bounds = await control.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44); expect(bounds?.width).toBeGreaterThanOrEqual(44)
  }
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(scan.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  // Exercise native modal containment and safe Escape/trigger restoration in
  // the actual build. Named visual/screen-reader review remains a human gate.
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(editor).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Origin' }).first()).toBeFocused()
})

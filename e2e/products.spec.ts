import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555'
const origin = JSON.parse(readFileSync(new URL('../src/contracts/product-content/v1/fixtures/valid/origin-full.json', import.meta.url), 'utf8'))

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID, clientId: CLIENT_ID, name: 'Origin', slug: 'origin', status: 'active',
    publicationStatus: 'draft', revision: 3, contentSchemaVersion: null, contentRevision: 1,
    draftSchemaVersion: 1, draftRevision: 7,
    completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null,
    createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', ...overrides,
  }
}

async function installAdminSession(page: Page): Promise<void> {
  await page.addInitScript(({ clientId }) => {
    const user = {
      id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin', clientId,
      accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600,
    }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId: CLIENT_ID })
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await fulfillLocal(route, { status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body) })
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await installAdminSession(page)
  await installTimeZoneRoute(page)
})

test('creates, edits, saves and publishes through exact commands without AI calls', async ({ page }) => {
  let selected = product()
  let draftRevision = 7
  let liveRevision = 1
  let draftContent = structuredClone(origin)
  const requests: Array<{ method: string; path: string; body?: unknown }> = []

  await page.route('**/api/backoffice/**', async (route) => {
    if (route.request().url().endsWith('/api/backoffice/me/timezone')) { await route.fallback(); return }
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const body = request.postDataJSON() as unknown
    requests.push({ method, path: url.pathname, ...(request.postData() && { body }) })
    if (url.pathname === `/api/backoffice/clients/${CLIENT_ID}/products` && method === 'GET') {
      await json(route, { items: [selected], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    } else if (url.pathname === `/api/backoffice/clients/${CLIENT_ID}/products` && method === 'POST') {
      selected = product({ name: 'New product', slug: 'new-product' })
      await json(route, selected, 201)
    } else if (url.pathname === `/api/backoffice/products/${PRODUCT_ID}` && method === 'GET') {
      await json(route, selected)
    } else if (url.pathname === `/api/backoffice/content/${PRODUCT_ID}` && method === 'GET') {
      await json(route, { productId: PRODUCT_ID, schemaVersion: liveRevision ? 1 : null, revision: liveRevision, content: liveRevision ? origin : {}, draft: { schemaVersion: 1, revision: draftRevision, content: draftContent } })
    } else if (url.pathname === `/api/backoffice/content/${PRODUCT_ID}/draft` && method === 'PUT') {
      const command = body as { content: typeof origin }
      draftRevision += 1
      draftContent = structuredClone(command.content)
      selected = { ...selected, draftRevision }
      await json(route, { productId: PRODUCT_ID, schemaVersion: 1, revision: liveRevision, content: origin, draft: { schemaVersion: 1, revision: draftRevision, content: draftContent } })
    } else if (url.pathname === `/api/backoffice/content/${PRODUCT_ID}/publish` && method === 'POST') {
      liveRevision += 1
      selected = { ...selected, publicationStatus: 'published', contentRevision: liveRevision }
      await json(route, { productId: PRODUCT_ID, schemaVersion: 1, revision: liveRevision, content: draftContent, publicationStatus: 'published', draft: { schemaVersion: 1, revision: draftRevision, content: draftContent } })
    } else {
      await route.abort()
    }
  })

  await page.goto('/products')
  await page.getByRole('button', { name: 'Create product' }).click()
  const createDialog = page.getByRole('dialog', { name: 'Create product' })
  await createDialog.getByLabel('Product name').fill('New product')
  await createDialog.getByLabel('Product slug').fill('new-product')
  await createDialog.getByRole('button', { name: 'Create product' }).click()

  const editor = page.getByRole('dialog', { name: 'Edit New product' })
  const editorBox = await editor.boundingBox()
  expect(editorBox?.width).toBeGreaterThanOrEqual(1000)
  await expect(editor.getByLabel('Hero title')).toHaveValue(origin.hero.title)
  await editor.getByLabel('Hero title').fill('A new launch title')
  await page.keyboard.press('Control+s')
  await expect(editor.getByText('Draft saved at revision 8.')).toBeVisible()
  await editor.getByRole('button', { name: 'Publish' }).click()
  await expect(editor.getByText('Published live revision 2.')).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Update published' })).toBeVisible()

  const createCommand = requests.find((request) => request.method === 'POST' && request.path.endsWith('/clients/' + CLIENT_ID + '/products'))
  expect(createCommand?.body).toEqual({ operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'New product', slug: 'new-product' })
  const saveCommand = requests.find((request) => request.method === 'PUT' && request.path.endsWith(`/content/${PRODUCT_ID}/draft`))
  expect(saveCommand?.body).toMatchObject({ schemaVersion: 1, expectedRevision: 7, content: { hero: { title: 'A new launch title' } } })
  const publishCommand = requests.find((request) => request.method === 'POST' && request.path.endsWith(`/content/${PRODUCT_ID}/publish`))
  expect(publishCommand?.body).toEqual({ expectedDraftRevision: 8, expectedRevision: 1 })
  expect(requests.some((request) => request.path.includes('/ai'))).toBe(false)
})

test('preserves a local edit through 422 and stale-revision review', async ({ page }) => {
  let saves = 0
  let currentServerTitle = origin.hero.title
  await page.route('**/api/backoffice/**', async (route) => {
    if (route.request().url().endsWith('/api/backoffice/me/timezone')) { await route.fallback(); return }
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/backoffice/clients/${CLIENT_ID}/products`) {
      await json(route, { items: [product()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    } else if (path === `/api/backoffice/products/${PRODUCT_ID}`) {
      await json(route, product({ revision: currentServerTitle === origin.hero.title ? 3 : 4 }))
    } else if (path === `/api/backoffice/content/${PRODUCT_ID}` && request.method() === 'GET') {
      await json(route, { productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision: currentServerTitle === origin.hero.title ? 7 : 8, content: { ...origin, hero: { ...origin.hero, title: currentServerTitle } } } })
    } else if (path === `/api/backoffice/content/${PRODUCT_ID}/draft`) {
      saves += 1
      if (saves === 1) {
        await json(route, { code: 'validation_failed', detail: 'Validation failed.', errors: [{ path: '/hero/title', keyword: 'maxLength', code: 'title_too_long', message: 'Use a shorter hero title.' }] }, 422)
      } else {
        currentServerTitle = 'Newer server title'
        await json(route, { code: 'draft_revision_conflict', detail: 'The draft changed.', currentDraftRevision: 8 }, 409)
      }
    } else {
      await route.abort()
    }
  })

  await page.goto('/products')
  await page.getByRole('button', { name: 'Edit Origin' }).first().click()
  const editor = page.getByRole('dialog', { name: 'Edit Origin' })
  const title = editor.getByLabel('Hero title')
  await title.fill('Local version')
  await editor.getByRole('button', { name: 'Save draft' }).click()
  await expect(editor.getByRole('alert')).toBeFocused()
  await editor.getByRole('button', { name: 'Use a shorter hero title.' }).click()
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('Local version')

  await title.fill('Local version kept')
  await editor.getByRole('button', { name: 'Save draft' }).click()
  await expect(editor.getByRole('button', { name: 'Refresh and review server version' })).toBeVisible()
  await editor.getByRole('button', { name: 'Refresh and review server version' }).click()
  await expect(editor.getByRole('button', { name: 'Use server version' })).toBeVisible()
  await expect(title).toHaveValue('Local version kept')
  await editor.getByRole('button', { name: 'Keep local edits' }).click()
  await expect(title).toHaveValue('Local version kept')
})

test('passes WCAG scan and remains operable at reflow, text-spacing and alternate-media settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/backoffice/**', async (route) => {
    if (route.request().url().endsWith('/api/backoffice/me/timezone')) { await route.fallback(); return }
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === `/api/backoffice/clients/${CLIENT_ID}/products`) {
      await json(route, { items: [product()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    } else if (path === `/api/backoffice/products/${PRODUCT_ID}`) {
      await json(route, product())
    } else if (path === `/api/backoffice/content/${PRODUCT_ID}`) {
      await json(route, { productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision: 7, content: origin } })
    } else {
      await route.abort()
    }
  })

  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeFocused()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Content' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const edit = page.getByRole('button', { name: 'Edit Origin' })
  await edit.click()
  const editor = page.getByRole('dialog', { name: 'Edit Origin' })
  await expect(editor).toBeVisible()
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' })
  await page.setViewportSize({ width: 320, height: 420 })
  await editor.getByRole('button', { name: 'Save draft' }).scrollIntoViewIfNeeded()
  await expect(editor.getByRole('button', { name: 'Save draft' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(edit).toBeFocused()
})

test('uploads a private hero image without saving and keeps the workflow accessible under constrained display settings', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  const requests: Array<{ method: string; path: string; body: string | null }> = []
  let releaseUpload: (() => void) | undefined
  const uploadBarrier = new Promise<void>((resolve) => { releaseUpload = resolve })
  const assetId = '0199aa11-2233-7444-8555-66778899aabb'
  const managedUrl = `/assets/product-images/${assetId}.png`
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )

  await page.route('**/api/backoffice/**', async (route) => {
    if (route.request().url().endsWith('/api/backoffice/me/timezone')) { await route.fallback(); return }
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push({ method: request.method(), path, body: request.postData() })
    if (path === `/api/backoffice/clients/${CLIENT_ID}/products`) {
      await json(route, { items: [product()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 })
    } else if (path === `/api/backoffice/products/${PRODUCT_ID}`) {
      await json(route, product())
    } else if (path === `/api/backoffice/content/${PRODUCT_ID}`) {
      await json(route, { productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {}, draft: { schemaVersion: 1, revision: 7, content: origin } })
    } else if (path === `/api/backoffice/products/${PRODUCT_ID}/assets/images` && request.method() === 'POST') {
      await uploadBarrier
      const operationId = request.postData()?.match(/name="operationId"\r\n\r\n([^\r]+)/)?.[1]
      await json(route, {
        operationId,
        status: 'completed',
        asset: {
          id: assetId,
          productId: PRODUCT_ID,
          role: 'hero',
          url: managedUrl,
          mediaType: 'image/png',
          byteLength: onePixelPng.length,
          width: 1200,
          height: 630,
          visibility: 'private',
          createdAt: '2026-09-14T18:00:00Z',
        },
        storage: { usedBytes: onePixelPng.length, limitBytes: 67108864, remainingBytes: 67108864 - onePixelPng.length },
      }, 201)
    } else if (path === `/api/backoffice/products/${PRODUCT_ID}/assets/images/${assetId}/preview`) {
      await fulfillLocal(route, {
        status: 200,
        contentType: 'image/png',
        headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        body: onePixelPng,
      })
    } else {
      await route.abort()
    }
  })

  await page.goto('/products')
  await page.getByRole('button', { name: 'Edit Origin' }).first().click()
  const editor = page.getByRole('dialog', { name: 'Edit Origin' })
  const upload = editor.getByLabel('Replace hero image')
  await upload.setInputFiles({ name: '../../unsafe-name.png', mimeType: 'image/png', buffer: onePixelPng })
  await expect(editor.getByText('Uploading image…')).toBeVisible({ timeout: 500 })
  await expect(editor.getByRole('progressbar', { name: 'hero image upload progress' })).toBeVisible()
  await expectNoAxeViolations(page)

  releaseUpload?.()
  const alt = editor.getByLabel('Background image alternative text')
  await expect(alt).toBeFocused()
  await expect(editor.getByLabel('Background image path')).toHaveValue(managedUrl)
  await expect(editor.getByAltText(`Private preview: ${origin.hero.backgroundImage.alt}`)).toBeVisible()
  await expect(editor.getByText('Upload complete. Save the draft to attach it.')).toBeVisible()
  expect(requests.some((request) => request.method === 'PUT' && request.path.endsWith('/draft'))).toBe(false)
  expect(requests.some((request) => request.path.includes('/publish'))).toBe(false)

  const uploadRequest = requests.find((request) => request.method === 'POST' && request.path.endsWith('/assets/images'))
  expect(uploadRequest?.body).toContain('name="operationId"')
  expect(uploadRequest?.body).toContain('name="assetRole"')
  expect(uploadRequest?.body).toContain('hero')
  expect(uploadRequest?.body).toContain('name="file"; filename="../../unsafe-name.png"')

  await page.addStyleTag({ content: `
    * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }
  ` })
  await page.setViewportSize({ width: 320, height: 420 })
  await editor.getByRole('button', { name: 'Clear private preview' }).scrollIntoViewIfNeeded()
  await expect(editor.getByRole('button', { name: 'Clear private preview' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoAxeViolations(page)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await editor.getByRole('button', { name: 'Clear private preview' }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const feedbackDuration = await editor.getByRole('button', { name: 'Clear private preview' }).evaluate(async (button) => {
    const started = performance.now()
    ;(button as HTMLButtonElement).click()
    while (document.querySelector('[role="status"]')?.textContent?.includes('Upload complete')) {
      await new Promise(requestAnimationFrame)
    }
    return performance.now() - started
  })
  expect(feedbackDuration).toBeLessThanOrEqual(100)
  await expect(editor.getByText('Upload complete. Save the draft to attach it.')).toHaveCount(0)
})

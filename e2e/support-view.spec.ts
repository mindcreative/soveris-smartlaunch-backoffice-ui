import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installCurrentSession } from './currentSession'

// Native browser layout/lifetime controls with synthetic API projections.
// Real consent, TOTP, authority and effects require the canonical support live lane.
const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
const target = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d6'

for (const palette of ['light', 'dark'] as const) {
  test(`synthetic support view: ${palette} escaped text, attribution, reflow and terminal history`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: palette })
    const user = await installCurrentSession(page, { displayName: 'Real operator', role: 'ClientOwner', platformPermissions: ['platform:support:operate'], timeZoneId: 'Europe/Belgrade' })
    let ended = false
    let contexts = 0
    let forbiddenRequests = 0
    await page.route('https://support-untrusted.invalid/**', async route => { forbiddenRequests++; await route.abort() })
    await page.route('**/api/backoffice/support/**', async route => {
      const path = new URL(route.request().url()).pathname
      const headers = { 'cache-control': 'no-store', Date: new Date().toUTCString() }

      if (path.endsWith('/context')) {
        contexts++
        await route.fulfill({ status: ended ? 403 : 200, headers, json: ended ? { code: 'access_denied' } : {
          id: grant, operatorId: user.id, operatorName: 'Real operator', targetClientId: target, targetClientName: 'Customer A',
          products: [{ id: product, name: 'Selected product', slug: 'selected' }], originalWorkspaceName: 'Operator workspace', supportCaseReference: 'case:123', createdAt: new Date().toISOString(), productIds: [product], operations: ['product.draft.read', 'product.identity.read'], scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64),
          revision: '3', state: 'active', startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
        } })
      } else if (path.endsWith('/draft')) {
        await route.fulfill({ headers, contentType: 'application/json', body: '{"productId":"' + product + '","draftSchemaVersion":1,"draftRevision":9007199254740993,"draft":{"text":"<img src=https://support-untrusted.invalid/private>","amount":9007199254740993}}' })
      } else if (path.endsWith('/exit')) {
        const body = route.request().postDataJSON()
        expect(Object.keys(body).sort()).toEqual(['expectedRevision', 'operationId'])
        expect(body.expectedRevision).toBe('3')
        ended = true
        await route.fulfill({ headers, json: { id: grant, state: 'ended', revision: '4', createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(),
          startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), endedAt: new Date().toISOString() } })
      } else {
        await route.fulfill({ headers, json: { items: [], nextCursor: null } })
      }
    })
    await page.goto('/platform/support')
    await expect(page.getByRole('heading', { name: 'Temporary support requests' })).toBeVisible()
    await page.evaluate(id => { history.pushState({}, '', '/support/' + id); dispatchEvent(new PopStateEvent('popstate')) }, grant)
    expect(contexts).toBe(0)
    await page.getByRole('button', { name: 'Verify support context' }).click()
    const banner = page.getByRole('region', { name: 'Current support context', exact: true })
    await expect(banner).toContainText('Real operator')
    await expect(banner).toContainText('Customer A')
    await page.getByRole('button', { name: 'Read draft for Selected product · selected' }).click()
    const result = page.getByRole('region', { name: 'Authorized read result' })
    await expect(result).toContainText('<img src=https://support-untrusted.invalid/private>')
    await expect(result).toContainText('9007199254740993')
    expect(forbiddenRequests).toBe(0)
    await expect(result.locator('img,iframe,a,video,audio,object,embed')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('support-untrusted'))).toBe(false)
    await expect(page.getByRole('link', { name: 'Submissions', exact: true })).toHaveCount(0)
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(accessibility.violations).toEqual([])
    await page.setViewportSize({ width: 320, height: 780 })
    await page.addStyleTag({ content: '* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Exit support' }).click()
    await expect(page).toHaveURL('/platform/support')
    await page.goBack()
    await expect(page).toHaveURL('/platform/support')
    await expect(page.getByText(/support-untrusted/)).toHaveCount(0)
    await page.evaluate(id => { history.pushState({}, '', '/support/' + id); dispatchEvent(new PopStateEvent('popstate')) }, grant)
    await expect(page.getByText(/Support was ended locally/)).toBeVisible()
    await expect(page.getByText(/support-untrusted/)).toHaveCount(0)
    expect(contexts).toBe(1)
  })

  test(`synthetic support view: ${palette} negative cross-tab message retires without restoring authority`, async ({ page, context }) => {
    const peer = await context.newPage()
    // A same-origin inert document exercises BroadcastChannel without mounting
    // a second authentication flow or contacting an unconfigured backend.
    await peer.route('**/__support-peer-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Owned negative-message peer</title>' }))
    await peer.goto('/__support-peer-fixture')
    await page.emulateMedia({ colorScheme: palette })
    const user = await installCurrentSession(page, { platformPermissions: ['platform:support:operate'] })
    let contexts = 0
    await page.route('**/api/backoffice/support/**', async route => {
      contexts++
      await route.fulfill({ headers: { 'cache-control': 'no-store', Date: new Date().toUTCString() }, json: { id: grant, operatorId: user.id, operatorName: 'Real operator', targetClientId: target,
        targetClientName: 'Customer A', products: [{ id: product, name: 'Selected product', slug: 'selected' }], originalWorkspaceName: 'Operator workspace', supportCaseReference: 'case:123', createdAt: new Date().toISOString(), productIds: [product], operations: ['product.identity.read'], scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64),
        revision: '3', state: 'active', startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() } })
    })
    await page.bringToFront()
    await page.goto('/support/' + grant)
    await page.getByRole('button', { name: 'Verify support context' }).click()
    await expect(page.getByRole('region', { name: 'Temporary support access' })).toBeVisible()
    await peer.evaluate(() => { const channel = new BroadcastChannel('soveris-support-invalidation-v1'); channel.postMessage({ kind: 'retire' }); channel.close() })
    await expect(page.getByRole('region', { name: 'Temporary support access' })).toHaveCount(0)
    expect(contexts).toBe(1)
    await peer.close()
  })
}

for (const palette of ['light', 'dark'] as const) {
  test(`synthetic dropdown ${palette}: query-free options and native Tab leave the available-options popup`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: palette })
    await installCurrentSession(page, { displayName: 'Real operator', platformPermissions: ['platform:support:operate'] })
    let mutations = 0
    let customerReads = 0
    await page.route('**/api/backoffice/support/**', async route => {
      const path = new URL(route.request().url()).pathname
      const headers = { 'cache-control': 'no-store', Date: new Date().toUTCString() }

      if (route.request().method() !== 'GET') {
        mutations++
        await route.abort()
      } else if (path.endsWith('/lookups/customers')) {
        customerReads++
        await route.fulfill({ headers, json: { items: [{ id: target, name: 'Cedar support customer · ' + target }, ...Array.from({ length: 9 }, (_, index) => ({ id: '01990000-0000-7000-8000-' + String(index + 20).padStart(12, '0'), name: 'Cedar customer ' + (index + 1) }))], nextCursor: null } })
      } else if (path.endsWith('/products')) {
        await route.fulfill({ headers, json: { items: [{ id: product, name: 'Owned support product', slug: 'owned-support-' + product }], nextCursor: null } })
      } else {
        await route.fulfill({ headers, json: { items: [], nextCursor: null } })
      }
    })
    await page.goto('/platform/support')
    const customer = page.getByRole('combobox', { name: 'Customer', exact: true })
    await expect(customer).toBeEnabled()
    await customer.click()
    await expect(page.getByRole('listbox', { name: 'Available customer' })).toBeFocused()
    await expect(page.getByRole('option', { name: 'Cedar support customer · [Identifier hidden]', exact: true })).toBeVisible()
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
    await expect(customer).toBeDisabled()
    await expect(page.getByRole('option')).toHaveCount(0)
    await page.getByRole('button', { name: 'Verify access to load options', exact: true }).click()
    await expect(customer).toBeEnabled()
    await customer.click()
    await expect.poll(() => customerReads).toBe(2)
    await page.getByRole('option', { name: 'Cedar support customer · [Identifier hidden]', exact: true }).click()
    const products = page.getByRole('combobox', { name: 'Products', exact: true })
    await products.click()
    await page.getByRole('option', { name: 'Owned support product · owned-support-[Identifier hidden]', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Remove Owned support product · owned-support-[Identifier hidden]', exact: true }).click()
    await customer.click()
    await expect(page.getByRole('listbox', { name: 'Available customer' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('option', { name: 'Cedar customer 9', exact: true })).toBeInViewport()
    await expect(page.getByRole('listbox', { name: 'Available customer' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clear customer selection', exact: true })).toBeFocused()
    await page.setViewportSize({ width: 320, height: 800 })
    await products.click()
    await expect(page.getByRole('listbox', { name: 'Available products' })).toBeFocused()
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await page.addStyleTag({ content: 'html { font-size: 200%; }' })
    await customer.click()
    await expect(page.getByRole('listbox', { name: 'Available customer' })).toBeFocused()
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(mutations).toBe(0)
  })
}

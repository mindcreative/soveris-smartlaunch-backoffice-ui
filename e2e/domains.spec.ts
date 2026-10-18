import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
const fixtures = JSON.parse(readFileSync(new URL('../src/api/__fixtures__/domains-http.json', import.meta.url), 'utf8'))
const body = (name: string) => JSON.parse(fixtures.cases.find((c: { name: string }) => c.name === name).responseBody)
const initial = body('detail'), capabilities = body('capabilities'), schedule = body('verify')
const CLIENT = initial.clientId, ID = initial.id, ACTOR = '01990000-0000-7000-8000-000000000001'
async function session(page: Page, role = 'Admin') {
  await page.addInitScript(({ clientId, actor, role }) => {
    const user = { id: actor, clientId, role, displayName: 'Domain operator', email: 'domain@example.test', accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'fixture-token')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { user, accessToken: 'fixture-token', refreshTokenValue: 'fixture-refresh' }, version: 0 }))
  }, { clientId: CLIENT, actor: ACTOR, role })
}
function activeDomain() {
  const active = body('primary')
  return { ...active, id: ID, clientId: CLIENT, host: initial.host, productId: null, bindingType: 'client', isPrimary: false, verification: initial.verification,
    authority: { ...active.authority, product: null } }
}
async function scan(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations).toEqual([])
}
test('claim, proof, Active, primary and durable release use exact commands and survive refresh', async ({ page }, info) => {
  test.setTimeout(90000); await session(page)
  let current = structuredClone(initial), claimed = false, verifying = false, proofReads = 0, releasing = false, releaseReads = 0
  const requests: Array<{ method: string; path: string; body: string | null }> = []
  await page.route('**/api/backoffice/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    requests.push({ method, path: url.pathname, body: request.postData() })
    const reply = async (data: unknown, status = 200, location?: string) => route.fulfill({ status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', headers: { 'Access-Control-Expose-Headers': 'Location,Retry-After,X-Correlation-Id', 'Cache-Control': 'no-store', ...(location && { Location: location }) }, body: JSON.stringify(data) })
    if (url.pathname.endsWith('/capabilities')) return reply(capabilities)
    if (url.pathname === `/api/backoffice/clients/${CLIENT}/domains`) {
      if (method === 'POST') { claimed = true; return reply({ ...initial, authority: null }, 201, `/api/backoffice/domains/${ID}`) }
      return reply({ items: claimed && !releasing ? [current] : [], page: 1, pageSize: 20, totalCount: claimed && !releasing ? 1 : 0, totalPages: claimed && !releasing ? 1 : 0 })
    }
    if (url.pathname === `/api/backoffice/domains/${ID}` && method === 'GET') {
      if (releasing) return reply({ code: 'domain_not_found', detail: 'Domain not found.' }, 404)
      if (verifying) { proofReads++; if (proofReads >= 2) { current = activeDomain(); verifying = false } }
      return reply(current)
    }
    if (url.pathname.endsWith('/verify')) {
      expect(request.postData()).toBeNull(); expect(url.search).toBe(''); expect(request.headers()['content-encoding']).toBeUndefined()
      verifying = true; current = { ...initial, ownership: { ...initial.ownership, status: 'verified' }, routing: { ...initial.routing, status: 'provisioning' }, authority: { ...initial.authority, active: false, servingReason: 'tls_unavailable' } }
      return reply(schedule, 202, `/api/backoffice/domains/${ID}`)
    }
    if (url.pathname.endsWith('/primary')) { expect(request.postDataJSON()).toEqual({ expectedRevision: current.revision }); current = { ...current, revision: current.revision + 1, isPrimary: true }; return reply(current) }
    const receipt = { ...body('release-status'), domainId: ID, statusUrl: `/api/backoffice/domains/${ID}/release` }
    if (method === 'DELETE') { releasing = true; return reply(receipt, 202, receipt.statusUrl) }
    if (url.pathname.endsWith('/release')) {
      expect(request.headers()['x-domain-client-id']).toBe(CLIENT)
      releaseReads++; return reply(releaseReads >= 3 ? { ...receipt, state: 'released', completedAt: receipt.requestedAt } : receipt, 200, receipt.statusUrl)
    }
    await route.abort()
  })
  await page.goto('/domains')
  await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Claim domain' })
  await expect(dialog.getByLabel('Hostname')).toBeFocused()
  await dialog.getByLabel('Hostname').fill(initial.host)
  await dialog.getByLabel('Verification method').selectOption('txt')
  await scan(page)
  await dialog.getByRole('button', { name: 'Claim domain', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/domains/${ID}$`))
  await expect(page.getByRole('heading', { name: 'DNS instructions and check history' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy ownership record' }).click()
  await expect(page.getByText(/Ownership record copied|Copy unavailable/)).toBeVisible()
  await page.getByRole('button', { name: 'Verify now', exact: true }).click()
  await expect(page.getByText('Ownership: verified', { exact: true })).toBeVisible()
  await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Active', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Make primary', exact: true }).click()
  const primary = page.getByRole('dialog', { name: 'Make domain primary' })
  await primary.getByRole('button', { name: 'Confirm primary' }).click()
  await expect(page.getByText('Primary preference', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Release domain', exact: true }).click()
  const release = page.getByRole('dialog', { name: 'Release domain', exact: true })
  await expect(release).toContainText(CLIENT); await expect(release).toContainText(initial.host)
  await release.getByRole('button', { name: 'Confirm release' }).click()
  await expect(page.getByText(/hostname remains reserved/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'DNS instructions and check history' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(/hostname remains reserved/)).toBeVisible()
  await expect(page.getByText(/Cleanup confirmed for this immutable/)).toBeVisible({ timeout: 15000 })
  await scan(page)
  expect(page.url()).not.toContain(initial.host)
  const claim = requests.find(r => r.method === 'POST' && r.path.endsWith(`/clients/${CLIENT}/domains`))!
  expect(JSON.parse(claim.body!)).toEqual({ operationId: expect.stringMatching(/-7[0-9a-f]{3}-/), host: initial.host, bindingType: 'client', verificationMethod: 'txt' })
  expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1)
  await info.attach('closed-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' })
})

test('keyboard, reflow, text spacing, text scaling and alternate media preserve claim/error focus', async ({ page }, info) => {
  await session(page); await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/backoffice/**', async route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/capabilities') ? capabilities : route.request().method() === 'POST' ? { code: 'invalid_hostname', detail: 'Hostname invalid.' } : { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 }
    await route.fulfill({ status: route.request().method() === 'POST' ? 422 : 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto('/domains'); await expect(page.getByRole('heading', { name: 'No domain claims', exact: true })).toBeFocused()
  const open = page.getByRole('button', { name: 'Claim domain', exact: true })
  await open.focus(); await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Claim domain' })
  await expect(dialog.getByLabel('Hostname')).toBeFocused()
  await dialog.getByLabel('Hostname').fill('invalid hostname')
  await dialog.getByRole('button', { name: 'Claim domain', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(dialog.getByRole('alert')).toBeFocused()
  await dialog.getByRole('link', { name: /Hostname:/ }).focus(); await page.keyboard.press('Enter')
  await expect(dialog.getByLabel('Hostname')).toBeFocused()
  await page.addStyleTag({ content: '* {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p {margin-bottom:2em!important}' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await scan(page)
  await page.keyboard.press('Escape'); await expect(open).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 800 }); await page.addStyleTag({ content: 'html { font-size:200%!important }' })
  await open.click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await scan(page)
  await info.attach('coverage-limits', { body: 'Automated Chromium media/320px/text scaling/text-spacing checks. This is not actual 400% browser zoom, manual screen-reader evidence or real virtual-keyboard evidence.', contentType: 'text/plain' })
})

test('ambiguous create and Retry retain exact identities; DNS, TLS and policy states stay independent', async ({ page }) => {
  await session(page)
  let current = { ...initial, ownership: { ...initial.ownership, status: 'failed' }, verification: { ...initial.verification, lastErrorCode: 'dns_mismatch' }, authority: { ...initial.authority, canVerify: false, verifyReason: 'verification_retry_required', canRetry: true, retryReason: null } }
  const creates: string[] = [], retries: string[] = []
  const claimCapabilities = { ...capabilities,
    limits: capabilities.limits.map((limit: { key: string; value: number }) => limit.key === 'hostnames' ? { ...limit, value: 1 } : limit),
  }
  await page.route('**/api/backoffice/**', async route => {
    const r = route.request(), path = new URL(r.url()).pathname
    const reply = (data: unknown, status = 200, location?: string) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Expose-Headers': 'Location,Retry-After', ...(location && { Location: location }) }, body: JSON.stringify(data) })
    if (path.endsWith('/capabilities')) return reply({ ...claimCapabilities,
      usage: capabilities.usage.map((usage: { key: string; value: number }) => usage.key === 'hostnames' ? { ...usage, value: creates.length ? 1 : 0 } : usage),
    })
    if (path.endsWith(`/clients/${CLIENT}/domains`)) {
      if (r.method() === 'POST') { creates.push(r.postData()!); return creates.length === 1 ? route.abort('failed') : reply({ ...initial, authority: null }, 200, `/api/backoffice/domains/${ID}`) }
      return reply({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 })
    }
    if (path.endsWith('/retry')) { retries.push(r.postData()!); return retries.length === 1 ? route.abort('failed') : reply(body('retry'), 200, `/api/backoffice/domains/${ID}`) }
    return reply(current)
  })
  await page.goto('/domains'); await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
  const claim = page.getByRole('dialog')
  await claim.getByLabel('Hostname').fill(initial.host)
  await claim.getByRole('button', { name: 'Claim domain', exact: true }).click()
  await expect(claim.getByLabel('Hostname')).toBeDisabled()
  await claim.getByRole('button', { name: 'Retry exact claim' }).click()
  await expect(page.getByText('Ownership: failed', { exact: true })).toBeVisible()
  expect(creates).toHaveLength(2); expect(creates[1]).toBe(creates[0])
  await expect(page.getByText(/The DNS record does not match the expected proof/)).toBeVisible()
  await page.getByRole('button', { name: 'Retry verification', exact: true }).click()
  await page.getByRole('button', { name: 'Reconcile original Retry', exact: true }).click()
  await expect.poll(() => retries.length).toBe(2)
  expect(retries[1]).toBe(retries[0]); expect(Object.keys(JSON.parse(retries[0]!))).toEqual(['operationId'])
  const active = activeDomain()
  current = { ...active, tls: { ...active.tls, status: 'failed' }, authority: { ...active.authority, active: false, servingReason: 'tls_unavailable', canSetPrimary: false, primaryReason: 'tls_unavailable' } }
  await page.reload(); await expect(page.getByText('TLS: failed', { exact: true })).toBeVisible(); await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  current = { ...active, authority: { ...active.authority, binding: { state: 'grace', selected: false, reason: 'limit_exceeded', lossAt: initial.createdAt, accessUntil: active.ownership.validUntil }, affectedResourceCount: 3, canSetPrimary: false, primaryReason: 'not_selected' } }
  await page.reload(); await expect(page.getByText('Active', { exact: true })).toBeVisible(); await expect(page.getByText(/3 affected resources/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Make primary', exact: true })).toBeDisabled()
  current = { ...current, authority: { ...current.authority, active: false, servingReason: 'policy_suspended', binding: { ...current.authority.binding, state: 'suspended' } } }
  await page.reload(); await expect(page.getByText('Ownership: verified', { exact: true })).toBeVisible(); await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  current = { ...active, routing: { ...active.routing, status: 'disabled' }, authority: { ...active.authority, active: false, servingReason: 'routing_inactive', canSetPrimary: false, primaryReason: 'routing_inactive' } }
  await page.reload(); await expect(page.getByText(/Binding eligibility: eligible/)).toBeVisible(); await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  current = active; await page.reload(); await expect(page.getByText('Active', { exact: true })).toBeVisible()
})

test('lost DELETE reconciles action-required receipt, recovery and a distinct same-host claim', async ({ page }) => {
  await session(page)
  let releasing = false, recovered = false, deletes = 0
  const newId = '01990000-0000-7000-8000-000000000003'
  const receipt = { ...body('release-status'), state: 'action_required', nextAttemptAt: null, lastErrorCode: 'provider_failure' }
  await page.route('**/api/backoffice/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const reply = (data: unknown, status = 200, location?: string) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Expose-Headers': 'Location', ...(location && { Location: location }) }, body: JSON.stringify(data) })
    if (path.endsWith('/capabilities')) return reply(capabilities)
    if (request.method() === 'DELETE') { deletes++; releasing = true; return route.abort('failed') }
    if (path.endsWith('/release')) { expect(request.headers()['x-domain-client-id']).toBe(CLIENT); return reply(recovered ? { ...receipt, state: 'released', completedAt: receipt.requestedAt } : receipt, 200, receipt.statusUrl) }
    if (path.endsWith(`/clients/${CLIENT}/domains`)) return request.method() === 'POST' ? reply({ ...initial, id: newId, authority: null }, 201, `/api/backoffice/domains/${newId}`) : reply({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 })
    return path.endsWith(newId) ? reply({ ...initial, id: newId }) : releasing ? reply({ code: 'domain_not_found' }, 404) : reply(activeDomain())
  })
  await page.goto(`/domains/${ID}`); await page.getByRole('button', { name: 'Release domain', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm release' }).click()
  await expect(page.getByText('Cleanup action required', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled()
  recovered = true; await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByText(/Cleanup confirmed for this immutable/)).toBeVisible(); expect(deletes).toBe(1)
  await page.getByRole('link', { name: 'Domains', exact: true }).click()
  await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Hostname').fill(initial.host)
  await page.getByRole('dialog').getByRole('button', { name: 'Claim domain', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${newId}$`)); await expect(page.getByText('Ownership: pending', { exact: true })).toBeVisible()
  await page.goto(`/domains/${ID}`); await expect(page.getByText(/Cleanup confirmed for this immutable/)).toBeVisible()
  await expect(page.getByLabel('Ownership record text')).toHaveCount(0); expect(deletes).toBe(1)
})

for (const action of ['claim', 'verify', 'retry', 'primary', 'release'] as const) test(`current ${action} permission denial clears private fields, confirmations and history re-entry`, async ({ page }) => {
  await session(page)
  let commands = 0
  const ready = activeDomain()
  const domain = { ...ready, authority: { ...ready.authority, canVerify: true, verifyReason: null, canRetry: true, retryReason: null } }
  await page.route('**/api/backoffice/**', async route => {
    const r = route.request(), path = new URL(r.url()).pathname
    if ((r.method() === 'POST' || r.method() === 'DELETE' || r.method() === 'PUT') && path.includes('/domains')) { commands++; return route.fulfill({ status: 403, contentType: 'application/problem+json', body: '{"code":"insufficient_permissions"}' }) }
    const data = path.endsWith('/capabilities') ? capabilities : path.endsWith(`/clients/${CLIENT}/domains`) ? { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 } : domain
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(action === 'claim' ? '/domains' : `/domains/${ID}`)
  if (action === 'claim') {
    await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Hostname').fill(initial.host)
    await page.getByRole('dialog').getByRole('button', { name: 'Claim domain', exact: true }).click()
  } else if (action === 'primary' || action === 'release') {
    await page.getByRole('button', { name: action === 'primary' ? 'Make primary' : 'Release domain', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: action === 'primary' ? 'Confirm primary' : 'Confirm release', exact: true }).click()
  } else await page.getByRole('button', { name: action === 'verify' ? 'Verify now' : 'Retry verification', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByText(initial.host, { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Ownership record text')).toHaveCount(0)
  await page.evaluate(id => { history.pushState({}, '', `/domains/${id}`); dispatchEvent(new PopStateEvent('popstate')) }, ID)
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible(); expect(commands).toBe(1)
})


test('configuration outage keeps serving unconfirmed and release separate from feature eligibility', async ({ page }) => {
  await session(page)
  let outage = true
  await page.route('**/api/backoffice/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (outage) return route.fulfill({ status: 503, contentType: 'application/problem+json', headers: { 'Retry-After': '1' }, body: '{"code":"configuration_unavailable"}' })
    const active = activeDomain()
    const data = path.endsWith('/capabilities') ? capabilities : { ...active, authority: { ...active.authority, active: false, servingReason: 'policy_suspended', canVerify: false, verifyReason: 'feature_not_available', canRetry: false, retryReason: 'feature_not_available', canSetPrimary: false, primaryReason: 'policy_suspended', binding: { ...active.authority.binding, state: 'suspended', selected: false, reason: 'feature_not_available' } } }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(`/domains/${ID}`)
  await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: initial.host, exact: true })).toHaveCount(0)
  outage = false; await page.reload()
  await expect(page.getByRole('button', { name: 'Verify now', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Release domain', exact: true })).toBeEnabled()
  await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
})

test('auth refresh closes confirmations; logout and a different Client fence held detail and cold history', async ({ page }) => {
  await session(page)
  const otherClient = '01990000-0000-7000-8000-000000000004'
  let clientId = CLIENT, hold = false, commands = 0
  let held: import('@playwright/test').Route | undefined
  await page.route('**/api/backoffice/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path.endsWith('/auth/login')) {
      clientId = otherClient
      return reply({ accessToken: 'other-token', refreshToken: 'other-refresh', expiresIn: 3600, user: { id: ACTOR, displayName: 'Other Client operator', role: 'Admin', clientId } })
    }
    if (path.endsWith('/auth/logout')) return reply({})
    if (path.endsWith('/capabilities')) return reply({ ...capabilities, clientId })
    if (path.endsWith('/domains')) return reply({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 })
    if (request.method() !== 'GET') { commands++; return reply({}, 403) }
    if (clientId !== CLIENT) return reply({ code: 'domain_not_found' }, 404)
    if (hold) { held = route; return }
    return reply(activeDomain())
  })
  await page.goto(`/domains/${ID}`)
  await page.getByRole('button', { name: 'Make primary', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.evaluate(() => dispatchEvent(new Event('auth:refreshed')))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled()
  hold = true; await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  await page.getByRole('button', { name: /User menu/ }).click()
  await page.getByRole('menuitem', { name: 'Logout', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email address').fill('other@example.test'); await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText(initial.host, { exact: true })).toHaveCount(0)
  await held?.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeDomain()) }).catch(() => {})
  await page.getByRole('link', { name: 'Domains', exact: true }).click()
  await expect(page.getByText(`Active Client: ${otherClient}`)).toBeVisible()
  await page.evaluate(id => { history.pushState({}, '', `/domains/${id}`); dispatchEvent(new PopStateEvent('popstate')) }, ID)
  await expect(page.getByRole('alert').filter({ hasText: /identity is unavailable in the active Client/ })).toBeVisible()
  await expect(page.getByText(initial.host, { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Ownership record text')).toHaveCount(0); expect(commands).toBe(0)
})

import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createUuidV7 } from '../src/lib/uuidV7'
const fixturePath = process.env.DOMAINS_BROWSER_FIXTURE_FILE
const enabled = Boolean(fixturePath)
test.skip(!enabled, 'Use supported HTTP runner with DOMAINS_BROWSER_SMOKE=1; mocked E2E is separate.')
const fixture = enabled ? JSON.parse(readFileSync(fixturePath!, 'utf8')) : null

test('built Domains UI drives actual DNS, edge, primary and retained release against live API', async ({ page }, info) => {
  async function retain(name: string, data: unknown) {
    const path = info.outputPath(`${name}.json`)
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
    await info.attach(name, { path, contentType: 'application/json' })
  }
  const headers = { Authorization: `Bearer ${fixture.accessToken}` }
  await page.addInitScript(f => {
    localStorage.setItem('backoffice_access_token', f.accessToken)
    localStorage.setItem('backoffice_refresh_token', f.refreshToken)
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: f.accessToken, refreshTokenValue: f.refreshToken }, version: 2 }))
  }, fixture)
  const commands: Array<{ method: string; path: string; status: number }> = []
  page.on('response', response => { const request = response.request(); if (response.url().includes('/api/backoffice/')) commands.push({ method: request.method(), path: new URL(response.url()).pathname, status: response.status() }) })
  // Measure rendered feedback from the actual click event in this built UI.
  // These are local fixture observations, not production latency claims.
  await page.goto('/domains')
  await expect(page.getByRole('button', { name: 'Claim domain', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const observations: { ack: number[]; pending: number[] } = { ack: [], pending: [] }
    Object.assign(window, { domainFeedbackObservations: observations })
    document.addEventListener('click', event => {
      const button = (event.target as Element).closest('button')
      if (button?.textContent?.trim() !== 'Claim domain') return
      const submit = button.getAttribute('type') === 'submit'
      const began = performance.now()
      const observer = new MutationObserver(() => {
        const visible = submit
          ? document.querySelector('[role="dialog"] button[type="submit"]:disabled')
          : document.querySelector('[role="dialog"]')
        if (visible) { observations[submit ? 'pending' : 'ack'].push(performance.now() - began); observer.disconnect() }
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
      setTimeout(() => observer.disconnect(), 2000)
    }, true)
  })
  for (let sample = 0; sample < 20; sample++) {
    await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Claim domain' })).toBeVisible()
    const draft = page.getByRole('dialog').getByLabel('Hostname')
    await draft.fill('appearance-draft.example.test')
    await page.emulateMedia({ colorScheme: sample % 2 ? 'dark' : 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', sample % 2 ? 'dark' : 'light')
    await expect(draft).toHaveValue('appearance-draft.example.test')
    await expect(draft).toBeFocused()
    expect(await page.locator('#root').evaluate(element => element.inert)).toBe(true)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  }
  const ackSamples = await page.evaluate(() => (window as unknown as { domainFeedbackObservations: { ack: number[] } }).domainFeedbackObservations.ack)
  expect(ackSamples).toHaveLength(20)
  const ackP95 = [...ackSamples].sort((a, b) => a - b)[18]!
  expect(ackP95).toBeLessThanOrEqual(100)
  await retain('built-acknowledgement-measurements', { browser: await page.context().browser()?.version(), ackSamples, ackP95, profile: fixture.profile })
  const pendingSamples: number[] = []
  const zoneRecords: string[] = []
  let serial = 1
  async function claim(host: string) {
    await page.getByRole('link', { name: 'Domains', exact: true }).click()
    await page.getByRole('button', { name: 'Claim domain', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Claim domain' })
    await dialog.getByLabel('Hostname').fill(host)
    await dialog.getByLabel('Verification method').selectOption('txt')
    const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/clients/${fixture.clientId}/domains`))
    await dialog.getByRole('button', { name: 'Claim domain', exact: true }).click()
    const response = await responsePromise; expect(response.status()).toBe(201)
    const domain = await response.json()
    await expect(page).toHaveURL(new RegExp(`/domains/${domain.id}$`))
    await expect(page.getByLabel('Ownership record text')).toBeVisible()
    pendingSamples.push(...await page.evaluate(() => { const state = (window as unknown as { domainFeedbackObservations: { pending: number[] } }).domainFeedbackObservations; return state.pending.splice(0) }))
    await retain(`built-pending-${pendingSamples.length}`, { pendingSamples, domainId: domain.id, profile: fixture.profile })
    const record = domain.verification.record
    expect(await page.getByLabel('Ownership record text').inputValue()).toContain(record.value)
    await page.getByRole('button', { name: 'Copy ownership record' }).click()
    await expect(page.getByText(/Ownership record copied|Copy unavailable/)).toBeVisible()
    zoneRecords.push(`${record.name} 1 IN TXT "${record.value}"`)
    const zone = process.env.DOMAINS_BROWSER_DNS_ZONE!
    const contents = `$ORIGIN story117.test.\n$TTL 1\n@ IN SOA ns.story117.test. hostmaster.story117.test. (${++serial} 1 1 60 1)\n@ IN NS ns.story117.test.\nns IN A 127.0.0.1\n${zoneRecords.join('\n')}\n`
    writeFileSync(zone + '.next', contents); renameSync(zone + '.next', zone)
    await page.waitForTimeout(1200) // Actual CoreDNS file-plugin reload, not a fabricated ownership result.
    const verify = page.getByRole('button', { name: 'Verify now', exact: true })
    if (await verify.isEnabled()) await verify.click()
    await expect(page.getByText('Active', { exact: true })).toBeVisible({ timeout: 90000 })
    return domain
  }
  const host = `browser-${Date.now()}.story117.test`
  await page.emulateMedia({ colorScheme: 'light' })
  const first = await claim(`first-${host}`)
  await page.emulateMedia({ colorScheme: 'dark' })
  const second = await claim(host)
  expect(pendingSamples).toHaveLength(2)
  expect(Math.max(...pendingSamples)).toBeLessThanOrEqual(500)
  await retain('built-feedback-measurements', { browser: await page.context().browser()?.version(), ackSamples, ackP95, pendingSamples, profile: fixture.profile, boundary: 'actual click to rendered feedback; local isolated built UI' })
  if (!(await page.getByText('Primary preference', { exact: true }).isVisible())) {
    const makePrimary = page.getByRole('button', { name: 'Make primary', exact: true })
    if (!(await makePrimary.isEnabled())) { await page.getByRole('button', { name: 'Check status', exact: true }).click(); await expect(makePrimary).toBeEnabled() }
    await makePrimary.click()
    await page.getByRole('dialog', { name: 'Make domain primary' }).getByRole('button', { name: 'Confirm primary' }).click()
    await expect(page.getByText('Primary preference', { exact: true })).toBeVisible()
  }
  const product = await page.request.get(`/api/backoffice/products/${fixture.productId}`, { headers })
  expect(product.status()).toBe(200)
  expect((await product.json()).canonicalUrl).toBe(`https://${host}/browser-product`)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  const barrier = process.env.DOMAINS_BROWSER_BARRIER_DIR!
  writeFileSync(join(barrier, 'pause-worker'), 'pause\n')
  await expect.poll(() => existsSync(join(barrier, 'worker-paused'))).toBe(true)
  await page.getByRole('button', { name: 'Release domain', exact: true }).click()
  const release = page.getByRole('dialog', { name: 'Release domain', exact: true })
  await expect(release).toContainText(fixture.clientId); await expect(release).toContainText(host)
  const releasedResponse = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().endsWith(`/domains/${second.id}`))
  await release.getByRole('button', { name: 'Confirm release' }).click()
  const accepted = await releasedResponse; expect(accepted.status()).toBe(202)
  const receipt = await accepted.json()
  await expect(page.getByText(/hostname remains reserved/)).toBeVisible()
  const ordinary = await page.request.get(`/api/backoffice/domains/${second.id}`, { headers }); expect(ordinary.status()).toBe(404)
  const repeat = await page.request.delete(`/api/backoffice/domains/${second.id}`, { headers }); expect(repeat.status()).toBe(202)
  expect((await repeat.json()).releaseId).toBe(receipt.releaseId)
  const reserved = await page.request.post(`/api/backoffice/clients/${fixture.clientId}/domains`, { headers, data: { operationId: createUuidV7(), host, bindingType: 'client', verificationMethod: 'txt' } }); expect(reserved.status()).toBe(409)
  await page.reload(); await expect(page.getByText(/hostname remains reserved/)).toBeVisible()
  expect(page.url()).not.toContain(host)
  writeFileSync(join(barrier, 'resume-worker'), 'resume\n')
  await expect.poll(() => existsSync(join(barrier, 'worker-resumed'))).toBe(true)
  await expect(page.getByText(/Cleanup confirmed for this immutable/)).toBeVisible({ timeout: 30000 })
  const currentProduct = await page.request.get(`/api/backoffice/products/${fixture.productId}`, { headers })
  expect((await currentProduct.json()).canonicalUrl).toBe(`https://first-${host}/browser-product`)
  const beforeCold = commands.length
  await page.goto(`/domains/${fixture.foreignDomainId}`)
  await expect(page.getByRole('alert').filter({ hasText: /identity is unavailable in the active Client/ })).toBeVisible()
  await expect(page.getByText(fixture.foreignHost, { exact: false })).toHaveCount(0)
  expect(commands.slice(beforeCold).some(c => c.path.endsWith(`/${fixture.foreignDomainId}/release`) && c.status === 404)).toBe(true)
  await retain('live-boundary-results', { profile: fixture.profile, firstDomainId: first.id, releasedDomainId: second.id, releaseId: receipt.releaseId, commands, noMockInterception: true })
})

import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import type { OwnedSupportFixture, SupportFixtureActor } from './models/supportFixture'

const secrets = new Set<string>()
const captures = new Set<Promise<unknown>>()
const prefix = '/api/backoffice/support/'
const productDisplay = 'Cedar Product 01 · cedar-product-01'

function observation(name: string, value: Record<string, boolean | number | string | string[]>): void {
  writeFileSync(join(process.env.ACCOUNT_SUPPORT_OBSERVATIONS!, name + '.json'), JSON.stringify(value, null, 2) + '\n')
}

async function noVisibleIdentifiers(page: Page): Promise<void> {
  const visible = await page.locator('body').innerText()
  const labels = await page.locator('[title],[aria-label]').evaluateAll(elements => elements.map(element => [element.getAttribute('title'), element.getAttribute('aria-label')]).flat().join(' '))
  expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i.test(visible + labels)).toBe(false)
}

function bridge(action: string, body: unknown): Record<string, unknown> {
  try {
    return JSON.parse(execFileSync('python3', [process.env.ACCOUNT_SUPPORT_BRIDGE!, process.env.ACCOUNT_SUPPORT_CONTEXT!, action], {
      input: JSON.stringify(body), encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
    })) as Record<string, unknown>
  } catch {
    throw new Error('Owned support fixture failed; private diagnostics withheld')
  }
}

function remember(value: unknown): void {
  if (typeof value === 'string' && value) {
    secrets.add(value)
  } else if (Array.isArray(value)) {
    value.forEach(remember)
  }
}

function watch(context: BrowserContext): void {
  context.on('response', response => {
    if (!response.url().includes('/api/backoffice/auth/') && !response.url().endsWith('/challenge')) {
      return
    }

    const pending = response.json().then(value => {
      for (const name of ['accessToken', 'refreshToken', 'csrfToken', 'secret', 'manualKey', 'qrPngBase64', 'recoveryCodes']) {
        remember(value[name])
      }

      remember(value.challenge?.secret)
      remember(value.session?.accessToken)
      remember(value.session?.refreshToken)
    }).catch(() => undefined)
    captures.add(pending)
    void pending.finally(() => captures.delete(pending))
  })
}

async function login(page: Page, actor: SupportFixtureActor, fixtureId: string, operator = false): Promise<void> {
  remember(actor.password)
  await page.goto('/login')
  await page.getByLabel('Email address', { exact: true }).fill(actor.email)
  await page.getByLabel('Password', { exact: true }).fill(actor.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  if (operator) {
    await expect(page.getByLabel('Authenticator code')).toBeVisible()
    const code = bridge('code', { fixtureId }).code
    remember(code)
    await page.getByLabel('Authenticator code').fill(String(code))
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  }

  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('backoffice_access_token')))).toBe(true)
  const tokens = await page.evaluate(() => [localStorage.getItem('backoffice_access_token'), localStorage.getItem('backoffice_refresh_token')])
  remember(tokens)
}

async function token(page: Page): Promise<string> {
  const value = await page.evaluate(() => localStorage.getItem('backoffice_access_token'))
  remember(value)
  expect(Boolean(value)).toBe(true)

  return value!
}

async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(result.violations.length === 0).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function chooseCustomerPage(page: Page, name: string, select = true): Promise<void> {
  for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    const option = page.getByRole('option', { name, exact: true })
    if (await option.count()) {
      if (select) {
        await option.click()
      }
      return
    }
    const next = page.getByRole('button', { name: 'Next options', exact: true })
    await expect(next).toBeEnabled()
    await next.click()
  }
  throw new Error('Owned customer was not reachable through bounded pages')
}

async function openCustomer(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click()
  await chooseCustomerPage(page, name)
}

async function loseCommittedResponse(page: Page, path: string): Promise<() => Promise<void>> {
  let executions = 0
  let operationId = ''
  let committedStatus = 0
  const operation = path.split('/').at(-1)!
  const target = '**' + prefix + path
  await page.route(target, async route => {
    executions++
    operationId = (route.request().postDataJSON() as { operationId: string }).operationId

    try {
      const response = await route.fetch({ timeout: 15000 })
      committedStatus = response.status()
      observation('loss-progress-' + operation, { stage: 'response-discarded', status: committedStatus })
    } finally {
      await route.abort('connectionreset')
    }
  })

  return async () => {
    // Pending state precedes transmission. Inspect only after the deliberately
    // discarded response has settled into the visible uncertain-outcome state.
    await expect.poll(() => committedStatus).toBe(200)
    await expect(page.getByText('Support access is unavailable. The outcome is not confirmed. Reload current state before another action.', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Unconfirmed command' })).toBeVisible()
    observation('loss-progress-' + operation, { stage: 'inspect-after-delivery-loss', status: committedStatus })
    const [receipt] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === prefix + 'operations/' + operationId, { timeout: 15000 }),
      page.getByRole('button', { name: 'Inspect exact command receipt', exact: true }).click({ timeout: 15000 }),
    ])
    expect(receipt.status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Unconfirmed command' })).toHaveCount(0)
    expect(executions).toBe(1)
    await page.unroute(target)
    observation('lost-' + operation, { committed: true, exactReceipt: true, mutationExecutions: executions, replay: false })
  }
}

async function activateWithConsent(page: Page, browser: Browser, fixture: OwnedSupportFixture, fixtureId: string, palette: 'light' | 'dark') {
  await page.addInitScript(() => {
    const events: string[] = []
    Object.assign(window, { supportReproductionEvents: events })
    for (const name of ['focus', 'blur', 'pageshow', 'pagehide', 'auth:retired']) {
      window.addEventListener(name, () => events.push(name))
    }
    document.addEventListener('visibilitychange', () => events.push('visibilitychange'))
  })
  await page.emulateMedia({ colorScheme: palette })
  await login(page, fixture.operator, fixtureId, true)
  await page.goto('/platform/support')
  const ownResponse = await page.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + await token(page) } })
  expect(ownResponse.status()).toBe(200)
  const own = await ownResponse.json()
  expect(own.id === fixture.operator.id && own.role === 'ClientOwner' && own.platformPermissions.includes('platform:support:operate')).toBe(true)
  await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click({ timeout: 15000 })
  const ambiguousOptions = page.getByRole('option').filter({ hasText: fixture.ambiguousCustomerName })
  await expect(ambiguousOptions).toHaveCount(2)
  await expect(ambiguousOptions.nth(0)).toHaveAttribute('aria-disabled', 'true')
  await expect(ambiguousOptions.nth(1)).toHaveAttribute('aria-disabled', 'true')
  await chooseCustomerPage(page, fixture.targetClientName)
  observation('ambiguity-' + fixtureId, { sameNameCustomersBlocked: true, extraLookupFieldsUsed: false })
  await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toContainText(fixture.targetClientName)
  await page.getByRole('combobox', { name: 'Products', exact: true }).click({ timeout: 15000 })
  await page.getByRole('option', { name: productDisplay, exact: true }).click({ timeout: 15000 })
  await expect(page.getByRole('option', { name: productDisplay, exact: true })).toHaveAttribute('aria-selected', 'true')
  await accessible(page)
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Draft content', exact: true }).check()
  await page.getByLabel('Duration in minutes').fill(fixtureId === 'light' ? '2' : '1')
  await page.getByLabel('Support reason').fill(fixture.reasonCanary)
  await page.getByLabel('Support case reference').fill('owned/browser-' + palette)
  const createdResponse = page.waitForResponse(response => response.url().endsWith(prefix + 'requests') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Request exact scope', exact: true }).click({ timeout: 15000 })
  const created = await createdResponse
  expect(created.status() === 200).toBe(true)
  const grant = (await created.json()).id as string
  await expect(page.getByRole('region', { name: 'Exact support request' })).toBeVisible()
  const ownerContext = await browser.newContext({ colorScheme: palette })
  watch(ownerContext)
  const owner = await ownerContext.newPage()
  await login(owner, fixture.owner, fixtureId)
  await owner.goto('/settings/support-access')
  await owner.getByRole('button', { name: 'User menu: Mina Cedar', exact: true }).click({ timeout: 15000 })
  await expect(owner.getByText('Workspace role: ClientOwner', { exact: true })).toBeVisible()
  await expect(owner.getByText('Platform role: SupportOperator', { exact: true })).toHaveCount(0)
  await owner.keyboard.press('Escape')
  await owner.getByRole('button', { name: /^Review request / }).click({ timeout: 15000 })
  await expect(owner.getByRole('button', { name: 'Approve exact scope', exact: true })).toBeDisabled()
  await accessible(owner)
  await owner.getByRole('checkbox', { name: 'I approve this exact operator, selected products, read operations and duration.' }).check()
  const recoverApproval = fixtureId === 'light' ? await loseCommittedResponse(owner, 'approvals/' + grant + '/approve') : null
  await owner.getByRole('button', { name: 'Approve exact scope', exact: true }).click({ timeout: 15000 })
  await recoverApproval?.()
  await expect(owner.getByRole('region', { name: 'Exact support request' })).toContainText('approved')
  observation('lifecycle-progress-' + fixtureId, { stage: 'operator-front' })
  await page.bringToFront()
  observation('lifecycle-progress-' + fixtureId, { stage: 'reload-operator' })
  await page.getByRole('button', { name: 'Reload current requests', exact: true }).click({ timeout: 15000 })
  observation('lifecycle-progress-' + fixtureId, { stage: 'select-operator' })
  await page.getByRole('button', { name: /^Review request / }).click({ timeout: 15000 })
  observation('lifecycle-progress-' + fixtureId, { stage: 'start-proof' })
  await page.getByRole('button', { name: 'Start grant-bound TOTP', exact: true }).click({ timeout: 15000 })
  observation('lifecycle-progress-' + fixtureId, { stage: 'authenticator-code' })
  const code = bridge('code', { fixtureId }).code
  remember(code)
  await page.getByLabel('Authenticator code').fill(String(code))
  observation('lifecycle-progress-' + fixtureId, { stage: 'verify-proof' })
  await page.getByRole('button', { name: 'Verify TOTP', exact: true }).click({ timeout: 15000 })
  await expect(page.getByText('Grant-bound TOTP verified for less than five minutes. Activation still requires your explicit confirmation.')).toBeVisible()
  const before = bridge('snapshot', { fixtureId, grant })
  expect(before.state === 'approved' && before.readReceipts === 0).toBe(true)
  await noVisibleIdentifiers(owner)
  observation('lifecycle-progress-' + fixtureId, { stage: 'activate' })
  const recoverActivation = fixtureId === 'light' ? await loseCommittedResponse(page, 'requests/' + grant + '/activate') : null
  await page.getByRole('button', { name: 'Activate approved grant', exact: true }).click({ timeout: 15000 })
  await recoverActivation?.()
  await expect(owner.getByRole('region', { name: 'Exact support request' })).toContainText('active', { timeout: 20000 })
  await expect(owner.getByText(/Remaining time:/)).not.toContainText('Server clock unavailable')
  observation('owner-' + fixtureId, { selectedDetailUpdatedWithoutReopen: true, absoluteServerCountdown: true })
  observation('lifecycle-progress-' + fixtureId, { stage: 'reload-operator' })
  await page.getByRole('button', { name: 'Reload current requests', exact: true }).click({ timeout: 15000 })
  observation('lifecycle-progress-' + fixtureId, { stage: 'select-operator' })
  await page.getByRole('button', { name: /^Review request / }).click({ timeout: 15000 })
  try {
    await expect(page.getByRole('link', { name: 'Enter temporary support view', exact: true })).toBeVisible({ timeout: 10000 })
  } catch (error) {
    try {
      const access = await token(page)
      const response = await page.request.get(prefix + 'requests/' + grant, { headers: { Authorization: 'Bearer ' + access }, timeout: 5000 })
      const body = await response.json() as { state?: unknown; revision?: unknown }
      const current = await page.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + access }, timeout: 5000 })
      const identity = await current.json() as { id?: string; sessionId?: string; clientId?: string }
      observation('activation-metadata-' + fixtureId, {
        status: response.status(), state: typeof body.state === 'string' && ['requested', 'approved', 'active', 'ended'].includes(body.state) ? body.state : 'unknown',
        currentStatus: current.status(), sameOriginalIdentity: identity.id === own.id && identity.sessionId === own.sessionId && identity.clientId === own.clientId,
      })
    } catch {
      observation('activation-metadata-' + fixtureId, { status: 0, diagnosticUnavailable: true })
    }

    throw error
  }
  await page.getByRole('link', { name: 'Enter temporary support view', exact: true }).click({ timeout: 15000 })
  await expect(page.getByRole('region', { name: 'Temporary support access' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Verify support context', exact: true }).click({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: /^Support access — / })).toBeFocused()
  await expect(page.getByRole('region', { name: 'Current support context' })).toContainText(fixture.targetClientName)
  await expect(page.locator('html')).toHaveAttribute('data-theme', palette)
  return { grant, owner, ownerContext }
}

test.afterEach(async ({ browser }, info) => {
  try {
    await Promise.allSettled([...captures])

    for (const context of browser.contexts()) {
      remember((await context.cookies()).map(cookie => cookie.value))
    }

    expect(bridge('privacy', { values: [...secrets] }).pass === true).toBe(true)
  } finally {
    for (const failure of info.errors) {
      const location = failure.stack?.match(/support-live\.spec\.ts:(\d+):(\d+)/)

      if (location) {
        info.annotations.push({ type: 'private-failure-location', description: `support-live.spec.ts:${location[1]}:${location[2]}` })
      }

      failure.message = 'Support browser assertion failed; private diagnostics withheld.'
      failure.stack = ''
      failure.errorContext = undefined
      failure.value = undefined
    }

    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await page.evaluate(() => document.documentElement.replaceChildren()).catch(() => undefined)
      }
    }

    secrets.clear()
  }
})

for (const palette of ['light', 'dark'] as const) {
  test(`Shipping support ${palette}: real customer consent, bound TOTP, safe scope, retirement and ${palette === 'light' ? 'exit' : 'revocation'}`, async ({ browser, context, page }) => {
    const fixtureId = palette
    const fixture = bridge('fixture', { fixtureId }) as unknown as OwnedSupportFixture
    remember([fixture.draftCanary, fixture.liveCanary, fixture.reasonCanary])
    watch(context)
    page.on('response', response => {
      if (response.request().method() === 'GET' && new URL(response.url()).pathname === prefix + 'requests') {
        observation('request-list-status-' + fixtureId, { status: response.status() })
      }
    })
    const { grant, owner, ownerContext } = await activateWithConsent(page, browser, fixture, fixtureId, palette)
    await page.getByRole('button', { name: 'Read identity for ' + productDisplay, exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Product identity — / })).toBeVisible()
    const forbiddenFetches: string[] = []
    page.on('request', request => {
      if (request.url().includes('support-forbidden.invalid')) {
        forbiddenFetches.push(request.url())
      }
    })
    await page.getByRole('button', { name: 'Read draft for ' + productDisplay, exact: true }).click()
    await expect(page.getByRole('region', { name: 'Authorized read result' })).toContainText(fixture.draftCanary)
    expect(await page.evaluate(() => 'supportUnsafe' in window)).toBe(false)
    expect(forbiddenFetches.length === 0).toBe(true)
    expect(await page.getByRole('region', { name: 'Authorized read result' }).locator('img,iframe,object,embed,a').count()).toBe(0)
    expect(await page.evaluate(values => values.every(value => !JSON.stringify([localStorage, sessionStorage, history.state]).includes(value)),
      [fixture.draftCanary, fixture.liveCanary, fixture.reasonCanary])).toBe(true)
    expect(await page.getByText(fixture.liveCanary, { exact: false }).count()).toBe(0)
    await page.getByRole('button', { name: 'User menu: Sofija Support', exact: true }).click()
    await expect(page.getByText('Platform role: SupportOperator', { exact: true })).toBeVisible()
    await expect(page.getByText('Workspace role: ClientOwner', { exact: true })).toBeVisible()
    await expect(page.getByText(/Workspace: Soveris/)).toBeVisible()
    await noVisibleIdentifiers(page)
    await page.keyboard.press('Escape')
    observation('readable-' + palette, { noVisibleGuid: true, distinctOperatorAndOwner: true, platformAndWorkspaceRolesSeparated: true })
    await accessible(page)
    await page.setViewportSize({ width: 320, height: 800 })
    await accessible(page)
    const access = await token(page)
    const legacy = await context.request.get('/api/backoffice/products/' + fixture.productId, { headers: { Authorization: 'Bearer ' + access } })
    expect([403, 404].includes(legacy.status())).toBe(true)
    expect(!(await legacy.text()).includes(fixture.draftCanary)).toBe(true)
    const actual = bridge('snapshot', { fixtureId, grant })
    expect(actual.state === 'active' && actual.readReceipts === 2 && actual.originalIdentity === true).toBe(true)

    if (palette === 'light') {
      const peer = await context.newPage()
      await peer.goto('/fixtures/support-peer.html')
      await peer.evaluate(() => {
        const channel = new BroadcastChannel('soveris-support-invalidation-v1')
        channel.postMessage({ kind: 'retire' })
        channel.close()
      })
      await expect(page.getByRole('region', { name: 'Authorized read result' })).toHaveCount(0)
      await page.bringToFront()
      await page.getByRole('button', { name: 'Verify support context', exact: true }).click({ timeout: 15000 })
      await page.getByRole('button', { name: 'Read draft for ' + productDisplay, exact: true }).click({ timeout: 15000 })
      await expect(page.getByRole('region', { name: 'Authorized read result' })).toContainText(fixture.draftCanary)
      expect(bridge('snapshot', { fixtureId, grant }).readReceipts === 3).toBe(true)
      const recoverExit = await loseCommittedResponse(page, 'requests/' + grant + '/exit')
      await page.getByRole('button', { name: 'Exit support', exact: true }).click({ timeout: 15000 })
      await recoverExit()
      await expect(page).toHaveURL(/\/platform\/support$/)
      observation('post-lost-exit', {
        returnedToOriginalRequests: true,
        customerBlockedBeforeVerification: await page.getByRole('combobox', { name: 'Customer', exact: true }).isDisabled(),
      })
      // Receipt recovery confirms the ended command. Reverify the newly
      // mounted request list before exercising another unsent draft.
      await page.getByRole('button', { name: 'Reload current requests', exact: true }).click({ timeout: 15000 })
      await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toBeEnabled({ timeout: 15000 })
      observation('post-lost-exit', { returnedToOriginalRequests: true, explicitMetadataVerification: true, customerEnabled: true })
      let replayedMutations = 0
      page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes(prefix)) {
          replayedMutations++
        }
      })
      await page.getByRole('combobox', { name: 'Customer', exact: true }).click({ timeout: 15000 })
      await chooseCustomerPage(page, fixture.targetClientName)
      await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toContainText(fixture.targetClientName)
      await page.getByRole('combobox', { name: 'Products', exact: true }).click({ timeout: 15000 })
          await page.getByRole('option', { name: productDisplay, exact: true }).click({ timeout: 15000 })
      await expect(page.getByRole('option', { name: productDisplay, exact: true })).toHaveAttribute('aria-selected', 'true')
      await accessible(page)
      await page.keyboard.press('Escape')
      await page.getByLabel('Duration in minutes').fill('17')
      await page.getByRole('checkbox', { name: 'Draft content', exact: true }).check()
      await page.getByLabel('Support reason').fill('Unsent amendment draft')
      await page.getByLabel('Support case reference').fill('draft:preserved')
      await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
      await expect(page.getByLabel('Support reason')).toBeVisible()
      await expect(page.getByLabel('Support reason')).toHaveValue('Unsent amendment draft')
      await expect(page.getByLabel('Support case reference')).toHaveValue('draft:preserved')
      await expect(page.getByLabel('Duration in minutes')).toHaveValue('17')
      await expect(page.getByRole('checkbox', { name: 'Draft content', exact: true })).toBeChecked()
      await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toBeDisabled()
      await expect(page.getByRole('combobox', { name: 'Products', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Verify access to load options', exact: true }).click({ timeout: 15000 })
      await page.getByRole('combobox', { name: 'Customer', exact: true }).click({ timeout: 15000 })
      await chooseCustomerPage(page, fixture.targetClientName, false)
      await page.keyboard.press('Escape')
      await page.getByRole('combobox', { name: 'Products', exact: true }).click({ timeout: 15000 })
      await expect(page.getByRole('listbox', { name: 'Available products' })).toBeVisible()
      await expect(page.getByRole('option', { name: productDisplay, exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Escape')
      expect(replayedMutations).toBe(0)
      expect(await page.evaluate(() => !JSON.stringify([localStorage, sessionStorage]).includes('Unsent amendment draft'))).toBe(true)
      await page.reload()
      const validOriginal = await context.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + await token(page) } })
      expect(validOriginal.status()).toBe(200)
      observation('draft-and-exit', { sameContextDraftSurvivedWindowEvents: true, exitRefreshKeptOriginalLogin: true })
      await page.goBack()
      expect(await page.getByRole('region', { name: 'Authorized read result' }).count()).toBe(0)
    } else {
      await owner.bringToFront()
      await owner.getByRole('button', { name: 'Reload current requests', exact: true }).click({ timeout: 15000 })
      await owner.getByRole('button', { name: /^Review request / }).click({ timeout: 15000 })
      await owner.getByRole('button', { name: 'Revoke support access', exact: true }).click({ timeout: 15000 })
      await expect(owner.getByRole('region', { name: 'Exact support request' })).toContainText('ended')
      await page.bringToFront()
      // Headless separate contexts remain visible/focused and bringToFront emits
      // no native window events. Exercise the actual resume listener explicitly.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.getByRole('region', { name: 'Authorized read result' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Verify support context', exact: true }).click({ timeout: 15000 })
      await expect(page.getByRole('heading', { name: 'Current support access withheld', exact: true })).toBeFocused()
    }

    expect(bridge('snapshot', { fixtureId, grant }).state === 'ended').toBe(true)
    const denied = await context.request.get(prefix + 'requests/' + grant + '/products/' + fixture.productId + '/draft',
      { headers: { Authorization: 'Bearer ' + access } })
    expect(denied.status() === 403).toBe(true)
    expect(!(await denied.text()).includes(fixture.draftCanary)).toBe(true)
    await ownerContext.close()
  })
}

test('Shipping support wrong customer, Editor and Viewer have matching browser and direct approval denials', async ({ browser }) => {
  const fixtureId = 'roles'
  const fixture = bridge('fixture', { fixtureId }) as unknown as OwnedSupportFixture
  const grant = bridge('pending', { fixtureId }).grant as string

  for (const role of ['other', 'editor', 'viewer'] as const) {
    const context = await browser.newContext()
    watch(context)
    const page = await context.newPage()
    await login(page, fixture[role], fixtureId)
    await page.goto('/settings/support-access')
    expect(await page.getByRole('button', { name: 'Approve exact scope', exact: true }).count()).toBe(0)
    const headers = { Authorization: 'Bearer ' + await token(page) }
    const metadata = await context.request.get(prefix + 'approvals/' + grant, { headers })
    expect([403, 404].includes(metadata.status())).toBe(true)
    const denied = await context.request.post(prefix + 'approvals/' + grant + '/approve', {
      headers, data: { operationId: bridge('operation-id', {}).id, expectedRevision: '1', scopeHash: 'a'.repeat(64), labelReviewHash: 'b'.repeat(64) },
    })
    expect([403, 404].includes(denied.status())).toBe(true)
    await context.close()
  }

  expect(bridge('snapshot', { fixtureId, grant }).state === 'requested').toBe(true)
})

test('Shipping support AV1-AV2: expiry refresh, network recovery, invalid login and private fault fences', async ({ browser, context, page }) => {
  const fixtureId = 'faults'
  const fixture = bridge('fixture', { fixtureId }) as unknown as OwnedSupportFixture
  remember([fixture.draftCanary, fixture.liveCanary, fixture.reasonCanary])
  watch(context)
  const { grant, ownerContext } = await activateWithConsent(page, browser, fixture, fixtureId, 'light')
  const access = await token(page)
  bridge('barrier-arm', { phase: 'after-support-commit' })

  try {
    await page.getByRole('button', { name: 'Read draft for ' + productDisplay, exact: true }).click()
    expect(bridge('barrier-wait', {}).held === true).toBe(true)
    expect(bridge('snapshot', { fixtureId, grant }).readReceipts === 1).toBe(true)
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    await expect(page.getByRole('region', { name: 'Authorized read result' })).toHaveCount(0)
  } finally {
    bridge('barrier-release', {})
  }

  await expect(page.getByRole('region', { name: 'Temporary support access' })).toHaveCount(0)
  bridge('keys-unavailable', {})

  try {
    await page.getByRole('button', { name: 'Verify support context', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Current support access withheld', exact: true })).toBeFocused()
    const denied = await context.request.get(prefix + 'requests/' + grant + '/products/' + fixture.productId + '/draft',
      { headers: { Authorization: 'Bearer ' + access } })
    expect(denied.status() === 503).toBe(true)
    expect(!(await denied.text()).includes(fixture.draftCanary)).toBe(true)
    expect(bridge('snapshot', { fixtureId, grant }).state === 'active').toBe(true)
  } finally {
    bridge('keys-available', {})
  }

  await expect(page.getByRole('button', { name: 'Verify support context', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Verify support context', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Temporary support access' })).toBeVisible()
  await page.getByRole('button', { name: 'Read draft for ' + productDisplay, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Authorized read result' })).toContainText(fixture.draftCanary)
  const originalResponse = await context.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + access } })
  expect(originalResponse.status()).toBe(200)
  const original = await originalResponse.json()
  const identity = (value: Record<string, unknown>) => [value.id, value.sessionId, value.clientId]
  const expiry = bridge('snapshot', { fixtureId, grant }).expiresAt
  expect(typeof expiry === 'string').toBe(true)
  await expect.poll(() => Date.now() >= Date.parse(String(expiry)), { timeout: 75000 }).toBe(true)
  await expect(page.getByRole('region', { name: 'Authorized read result' })).toHaveCount(0)
  const expired = await context.request.get(prefix + 'requests/' + grant + '/products/' + fixture.productId + '/draft',
    { headers: { Authorization: 'Bearer ' + access } })
  expect(expired.status() === 403).toBe(true)
  expect(!(await expired.text()).includes(fixture.draftCanary)).toBe(true)
  expect(bridge('snapshot', { fixtureId, grant }).state === 'ended').toBe(true)
  expect(bridge('snapshot', { fixtureId, grant }).readReceipts === 2).toBe(true)
  const afterExpiry = await context.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + access } })
  expect(afterExpiry.status()).toBe(200)
  expect(identity(await afterExpiry.json())).toEqual(identity(original))
  const observedEvents = await page.evaluate(() => (window as unknown as { supportReproductionEvents: string[] }).supportReproductionEvents)
  observation('restoration', { supportExpiredStatus: expired.status(), currentStatus: afterExpiry.status(), sameOriginalIdentity: JSON.stringify(identity(await afterExpiry.json())) === JSON.stringify(identity(original)), observedEvents })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Verify support context', exact: true })).toBeVisible()
  const afterRefresh = await context.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + await token(page) } })
  expect(afterRefresh.status()).toBe(200)
  expect(identity(await afterRefresh.json())).toEqual(identity(original))
  observation('healthy-refresh', { currentStatus: afterRefresh.status(), sameOriginalIdentity: true, terminalGrant: true })
  await page.route('**/api/backoffice/auth/current', route => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Current access unavailable', exact: true })).toBeVisible()
  expect(await page.evaluate(() => Boolean(localStorage.getItem('backoffice_access_token')))).toBe(true)
  observation('network-recovery', { unavailableSettled: true, originalCredentialsRetained: true })
  await page.unroute('**/api/backoffice/auth/current')
  await page.getByRole('button', { name: 'Verify access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Verify support context', exact: true })).toBeVisible()
  let releaseTimeout: (() => Promise<void>) | undefined
  await page.route('**/api/backoffice/auth/current', async route => {
    await new Promise<void>(resolve => {
      releaseTimeout = async () => {
        await route.abort('timedout').catch(() => undefined)
        resolve()
      }
    })
  })
  const waitingStarted = Date.now()

  try {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Current access unavailable', exact: true })).toBeVisible({ timeout: 35000 })
    expect(await page.evaluate(() => Boolean(localStorage.getItem('backoffice_access_token')))).toBe(true)
    observation('transport-timeout', { unavailableSettled: true, originalCredentialsRetained: true, elapsedMilliseconds: Date.now() - waitingStarted })
  } finally {
    await releaseTimeout?.()
    await page.unroute('**/api/backoffice/auth/current')
  }

  await page.getByRole('button', { name: 'Verify access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Verify support context', exact: true })).toBeVisible()
  bridge('keys-unavailable', {})

  try {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Current access unavailable', exact: true })).toBeVisible()
    expect(await page.evaluate(() => Boolean(localStorage.getItem('backoffice_access_token')))).toBe(true)
    observation('current-dependency', { unavailableSettled: true, originalCredentialsRetained: true })
  } finally {
    bridge('keys-available', {})
  }

  await page.getByRole('button', { name: 'Verify access', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Verify support context', exact: true })).toBeVisible()
  const currentAccess = await token(page)
  const refreshToken = await page.evaluate(() => localStorage.getItem('backoffice_refresh_token'))
  remember(refreshToken)
  const revoked = await context.request.post('/api/backoffice/auth/revoke', { headers: { Authorization: 'Bearer ' + currentAccess, Origin: new URL(page.url()).origin }, data: { refreshToken } })
  expect([200, 204].includes(revoked.status())).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  observation('invalid-session', { actualRevokeStatus: revoked.status(), authenticationRequired: true })
  await ownerContext.close()
})


test('Shipping support D8 UX02-UX08 UX24: query-free paging limit keyboard and recovery', async ({ context, page }) => {
  const fixtureId = 'dark'
  const fixture = bridge('fixture', { fixtureId }) as unknown as OwnedSupportFixture
  watch(context)
  await login(page, fixture.operator, fixtureId, true)
  await page.goto('/platform/support')
  let mutations = 0
  const queries: boolean[] = []
  page.on('request', request => {
    if (request.url().includes(prefix + 'lookups/')) {
      queries.push(new URL(request.url()).searchParams.has('query'))
    }
    if (request.method() === 'POST' && request.url().includes(prefix)) {
      mutations++
    }
  })
  const customer = page.getByRole('combobox', { name: 'Customer', exact: true })
  const products = page.getByRole('combobox', { name: 'Products', exact: true })
  await expect(products).toBeDisabled()
  await expect(customer).toBeEnabled()
  await customer.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('listbox')).toBeFocused()
  await expect(page.getByLabel(/Search/)).toHaveCount(0)
  await chooseCustomerPage(page, fixture.targetClientName)
  observation('dropdown-progress', { stage: 'customer-selected' })
  await products.click()
  await expect(page.getByRole('listbox')).toBeFocused()
  for (let number = 1; number <= 20; number++) {
    const label = `Cedar Product ${String(number).padStart(2, '0')} · cedar-product-${String(number).padStart(2, '0')}`
    await page.getByRole('option', { name: label, exact: true }).click()
  }
  observation('dropdown-progress', { stage: 'twenty-selected' })
  await expect(products).toContainText('20 of 20')
  await page.getByRole('button', { name: 'Next options', exact: true }).click()
  const later = page.getByRole('option', { name: 'Cedar Product 22 · cedar-product-22', exact: true })
  await expect(later).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('option', { name: productDisplay, exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Remove ' + productDisplay, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Cedar Product 02 · cedar-product-02', exact: true })).toBeFocused()
  await products.click()
  await page.getByRole('button', { name: 'Next options', exact: true }).click()
  await later.click()
  await expect(later).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Next options', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Cedar Product 45 · cedar-product-45', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  observation('dropdown-progress', { stage: 'later-and-last-option-reached' })
  await page.getByLabel('Support reason').fill('Permitted paged draft')
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
  await expect(customer).toBeDisabled()
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request exact scope', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Verify access to load options', exact: true }).click()
  await expect(customer).toBeEnabled()
  await customer.click()
  await chooseCustomerPage(page, fixture.targetClientName, false)
  await page.keyboard.press('Escape')
  await products.click()
  await page.getByRole('button', { name: 'Next options', exact: true }).click()
  await expect(later).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('listbox')).toHaveAttribute('aria-activedescendant', (await later.getAttribute('id'))!)
  await expect(page.getByRole('button', { name: 'Remove Cedar Product 22 · cedar-product-22', exact: true })).toBeVisible()
  await expect(page.getByLabel('Support reason')).toHaveValue('Permitted paged draft')
  await page.keyboard.press('Escape')
  observation('dropdown-progress', { stage: 'retained-labels-recovered' })
  for (const palette of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: palette })
    await expect(page.locator('html')).toHaveAttribute('data-theme', palette)
    await page.setViewportSize({ width: 320, height: 800 })
    await products.click()
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    await accessible(page)
    await page.keyboard.press('Escape')
  }
  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  await customer.click()
  await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  await accessible(page)
  await noVisibleIdentifiers(page)
  expect(queries.length > 0 && queries.every(value => !value)).toBe(true)
  expect(mutations).toBe(0)
  const current = await context.request.get('/api/backoffice/auth/current', { headers: { Authorization: 'Bearer ' + await token(page) } })
  expect(current.status()).toBe(200)
  expect((await current.json()).id).toBe(fixture.operator.id)
  observation('dropdown-recovery', { contract: 'D8-D16.8-06', queryFree: true, replacePages: true, laterPageRecovery: true,
    selection20And21: true, lastProductReachable: true, authorizedRecoveryStatus: 200, noMutation: true,
    keyboardAndRemoval: true, popupAccessibility: true, palettesNarrowAndZoom: true, sameOriginalIdentity: true })
})

test('Shipping support D8 UX29: lost create uses exact receipt then current detail without replay', async ({ context, page }) => {
  const fixtureId = 'roles'
  const fixture = bridge('fixture', { fixtureId }) as unknown as OwnedSupportFixture
  watch(context)
  await login(page, fixture.operator, fixtureId, true)
  await page.goto('/platform/support')
  await openCustomer(page, fixture.targetClientName)
  await page.getByRole('combobox', { name: 'Products', exact: true }).click()
  await page.getByRole('option', { name: productDisplay, exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByLabel('Support reason').fill('Lost response control')
  await page.getByLabel('Support case reference').fill('receipt:lost-create')
  let commands = 0
  let operationId = ''
  await page.route('**/api/backoffice/support/requests', async route => {
    if (route.request().method() === 'POST') {
      commands++
      operationId = (route.request().postDataJSON() as { operationId: string }).operationId
      // The real API commits. Only its delivery to this browser is interrupted.
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('connectionreset')
    } else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: 'Request exact scope', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Unconfirmed command' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current support access withheld', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request exact scope', exact: true })).toBeDisabled()
  const recovered = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === prefix + 'operations/' + operationId)
  await page.getByRole('button', { name: 'Inspect exact command receipt', exact: true }).click()
  expect((await recovered).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Unconfirmed command' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Exact support request' })).toContainText('receipt:lost-create')
  expect(commands).toBe(1)
  await noVisibleIdentifiers(page)
  observation('receipt-recovery', { contract: 'D8-D16.8-06', originalCreateCommitted: true, knownGrantBeforeRecovery: false,
    exactReceipt: true, currentDetailReadNext: true, mutationExecutions: commands, replay: false })
})

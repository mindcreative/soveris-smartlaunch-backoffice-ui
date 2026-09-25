import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-4222-8333-444444444444'
const ACCOUNT = '0199c000-0000-7000-8000-000000000099'
const ACTOR = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'
const ORIGINAL = '0199c000-0000-7000-8000-000000000001'
const REVERSAL = '0199c000-0000-7000-8000-000000000002'
const historyPath = `/billing/clients/${CLIENT}/adjustments`

function item(clientId: string, adjustmentId: string, reversal: boolean): string {
  const operationId = reversal
    ? '0199c000-0000-7000-8000-000000000011'
    : '0199c000-0000-7000-8000-000000000010'
  const ledgerId = reversal
    ? '0199c000-0000-7000-8000-000000000021'
    : '0199c000-0000-7000-8000-000000000020'
  const reason = JSON.stringify(reversal
    ? 'Compensating correction' : `Exact persisted reason ${'that wraps '.repeat(40)}`.trimEnd())
  return `{"schemaVersion":1,"clientId":"${clientId}","creditAccountId":"${ACCOUNT}",` +
    `"operationId":"${operationId}","adjustmentId":"${adjustmentId}","ledgerId":"${ledgerId}",` +
    `"operationType":"${reversal ? 'reversal' : 'original'}",` +
    `"amount":${reversal ? '-10.0001' : '10.0001'},` +
    `"reason":${reason},"performedBy":"${ACTOR}",` +
    `"expectedWalletVersion":${reversal ? '41' : '40'},"walletVersionBefore":${reversal ? '41' : '40'},` +
    `"walletVersionAfter":${reversal ? '42' : '41'},` +
    `"beforeOwnedBalance":${reversal ? '110.0001' : '100.0000'},` +
    `"beforeReservedBalance":20.0000,` +
    `"beforeAvailableBalance":${reversal ? '90.0001' : '80.0000'},` +
    `"afterOwnedBalance":${reversal ? '100.0000' : '110.0001'},` +
    `"afterReservedBalance":20.0000,` +
    `"afterAvailableBalance":${reversal ? '80.0000' : '90.0001'},` +
    `"operationAsOf":"${reversal ? '2026-09-24T08:10:11.654321' : '2026-09-24T08:09:10.123456'}",` +
    `"originalAdjustmentId":${reversal ? `"${ORIGINAL}"` : 'null'},` +
    `"reversalAdjustmentId":${reversal ? 'null' : `"${REVERSAL}"`}}`
}

function historyBody(clientId = CLIENT, nextCursor: string | null = null,
  includeReversal = true): string {
  const items = [item(clientId, ORIGINAL, false), ...(includeReversal
    ? [item(clientId, REVERSAL, true)] : [])]
  return `{"items":[${items.join(',')}],"asOf":"2026-09-24T09:00:00.000001","nextCursor":${
    nextCursor === null ? 'null' : JSON.stringify(nextCursor)}}`
}

async function installSession(page: Page, role: 'Admin' | 'Viewer' = 'Admin'): Promise<void> {
  await page.addInitScript(({ clientId, actorId, actorRole }) => {
    const user = { id: actorId, email: 'operator@example.test', displayName: 'Operator',
      role: actorRole, clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId: CLIENT, actorId: ACTOR, actorRole: role })
}

async function json(route: Route, body: string, status = 200): Promise<void> {
  await fulfillLocal(route, {
    status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body,
  })
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await installSession(page)
  await installTimeZoneRoute(page)
})

test('canonical direct route presents complete reciprocal immutable evidence and workspace semantics', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', async (route) => {
    requests.push(new URL(route.request().url()))
    await json(route, historyBody())
  })
  await page.goto(historyPath)

  await expect(page).toHaveURL(new RegExp(`${CLIENT}/adjustments$`))
  await expect(page.getByRole('heading', { name: 'Adjustment history', exact: true })).toBeFocused()
  const tabs = page.getByRole('navigation', { name: 'Billing workspace' }).getByRole('link')
  await expect(tabs).toHaveText(['Account', 'Ledger', 'Adjustments', 'Subscriptions'])
  await expect(page.getByRole('link', { name: 'Adjustments' })).toHaveAttribute('aria-current', 'page')
  const table = page.getByRole('table', { name: 'Newest-first immutable Billing adjustment history' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader')).toHaveCount(7)
  await expect(table.getByRole('columnheader').last()).toHaveText('Action')
  await expect(page.getByRole('button', { name: /Review reversal/ })).toHaveCount(0)
  await expect(table.locator(`tr[data-adjustment-id="${ORIGINAL}"]`)).toContainText(`Reversed by ${REVERSAL}`)
  await expect(table.locator(`tr[data-adjustment-id="${REVERSAL}"]`)).toContainText(`Reversal of ${ORIGINAL}`)
  await expect(table).toContainText('+10.0001')
  await expect(table).toContainText('-10.0001')
  for (const evidence of ['Schema version: 1', `Client ID: ${CLIENT}`,
    `Credit account ID: ${ACCOUNT}`, 'Expected wallet version: 40',
    'Wallet version before: 40', 'Wallet version after: 41',
    'Owned before:', 'Reserved before:', 'Available before:',
    'Owned after:', 'Reserved after:', 'Available after:'])
    await expect(table).toContainText(evidence)
  await expect(page.getByRole('list', {
    name: 'Newest-first immutable Billing adjustment history',
  })).toBeHidden()
  expect(requests[0]?.search).toBe('')
  await expectNoSeriousAxeViolations(page)
  await page.goto(`/billing/clients/${CLIENT.toUpperCase()}/adjustments`)
  await expect(page).toHaveURL(new RegExp(`${CLIENT}/adjustments$`))
  await expect(page.getByRole('heading', { name: 'Adjustment history', exact: true })).toBeVisible()
})

test('encodes exact private filters, keeps drafts out of browser state, and clears fresh', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    await json(route, url.searchParams.has('reason')
      ? '{"items":[],"asOf":"2026-09-24T09:00:00.000001","nextCursor":null}'
      : historyBody())
  })
  await page.goto(historyPath)
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByLabel('From (your saved timezone, inclusive)').fill('2026-09-24T08:00:00.123')
  await page.getByLabel('Exact reason').fill('Exact & private')
  await page.getByLabel('Operation type').selectOption('original')
  await page.getByLabel('Page size').selectOption('50')
  await page.getByRole('button', { name: 'Apply filters' }).click()

  await expect(page.getByRole('heading', { name: 'No adjustments match these filters' })).toBeVisible()
  expect(requests[1]?.searchParams.get('from')).toBe('2026-09-24T08:00:00.123000')
  expect(requests[1]?.searchParams.get('reason')).toBe('Exact & private')
  expect(requests[1]?.searchParams.get('operationType')).toBe('original')
  expect(requests[1]?.searchParams.get('pageSize')).toBe('50')
  expect(page.url()).not.toContain('private')
  const browserState = await page.evaluate(() =>
    `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}${location.search}`)
  expect(browserState).not.toContain('Exact & private')
  expect(browserState).not.toContain('2026-09-24T08:00')
  await expectNoSeriousAxeViolations(page)

  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await expect(page.getByRole('table')).toBeVisible()
  expect(requests[2]?.search).toBe('')
  await expect(page.getByRole('heading', { name: 'Filter adjustment history' })).toBeFocused()
})

test('retries one exact cursor, focuses the final end, and requires fresh start after cursor 400', async ({ page }) => {
  let cursorRequests = 0
  let mode: 'transient' | 'invalid' = 'transient'
  const requests: URL[] = []
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    if (!url.searchParams.has('cursor')) {
      await json(route, historyBody(CLIENT, 'opaque +/ cursor', false))
      return
    }
    cursorRequests += 1
    if (mode === 'invalid') {
      await json(route, '{"title":"Invalid history cursor","status":400,"code":"credit_adjustment_history_invalid_query"}', 400)
    } else if (cursorRequests <= 2) {
      await json(route, '{"title":"History unavailable","status":503,"code":"credit_adjustment_history_dependency_unavailable"}', 503)
    } else {
      await json(route, '{"items":[],"asOf":"2026-09-24T09:00:00.000001","nextCursor":null}')
    }
  })
  await page.goto(historyPath)
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('More adjustment history could not be loaded')).toBeVisible()
  expect(requests.slice(1, 3).every((url) =>
    [...url.searchParams.keys()].join() === 'cursor' &&
    url.searchParams.get('cursor') === 'opaque +/ cursor')).toBe(true)
  await page.getByRole('button', { name: 'Retry loading more' }).click()
  await expect(page.locator('p[role="status"]', {
    hasText: 'End of adjustment history results.',
  })).toBeFocused()

  mode = 'invalid'; cursorRequests = 0
  await page.reload()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('This adjustment history can no longer be continued')).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('button', { name: 'Start fresh' }).click()
  await expect.poll(() => requests.at(-1)?.search).toBe('')
})

test('renders focused denied, saved-zone, DST, dependency, and malformed-evidence states without leaks', async ({ page }) => {
  let mode: 'denied' | 'zone' | 'dst' | 'authorization' | 'history' | 'malformed' = 'denied'
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', async (route) => {
    if (mode === 'denied') return json(route, '{"title":"Forbidden","status":403}', 403)
    if (mode === 'zone') return json(route,
      '{"title":"Saved timezone required","status":409,"code":"time_zone_not_set"}', 409)
    if (mode === 'dst') return json(route,
      '{"title":"Ambiguous local time","status":422,"code":"local_time_ambiguous","field":"from"}', 422)
    if (mode === 'authorization') return json(route,
      '{"title":"Unavailable","detail":"private detail","status":503,"code":"authorization_dependency_unavailable"}', 503)
    if (mode === 'history') return json(route,
      '{"title":"Unavailable","detail":"private detail","status":503,"code":"credit_adjustment_history_dependency_unavailable"}', 503)
    return json(route, '{"items":[{"schemaVersion":1}],"asOf":"bad","nextCursor":null}')
  })
  await page.goto(historyPath)
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeFocused()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expectNoSeriousAxeViolations(page)

  mode = 'zone'; await page.reload()
  await expect(page.getByRole('heading', { name: 'Saved timezone required' })).toBeFocused()
  await expect(page.getByText(/contact an administrator/i)).toBeVisible()
  mode = 'dst'; await page.reload()
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('link', { name: /From:/ })).toHaveAttribute(
    'href', '#adjustment-history-from')
  mode = 'authorization'; await page.reload()
  await expect(page.getByRole('heading', { name: 'Authorization unavailable' })).toBeFocused()
  await expect(page.getByText('private detail')).toHaveCount(0)
  mode = 'history'; await page.reload()
  await expect(page.getByRole('heading', { name: 'Adjustment history unavailable' })).toBeFocused()
  await expect(page.getByText('private detail')).toHaveCount(0)
  mode = 'malformed'; await page.reload()
  await expect(page.getByRole('heading', { name: 'Adjustment history unavailable' })).toBeFocused()
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('supports keyboard and screen-reader structure at 320px, 400% zoom, text spacing and user media preferences', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', (route) =>
    json(route, historyBody()))
  await page.goto(historyPath)
  const list = page.getByRole('list', { name: 'Newest-first immutable Billing adjustment history' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('table')).toBeHidden()
  await page.addStyleTag({ content: `html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }` })
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }))
  expect(overflow.document).toBe(overflow.viewport)
  expect(overflow.body).toBe(overflow.viewport)
  const targets = await page.locator('a:visible, button:visible, input:visible, select:visible')
    .evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  const stateBorder = await page.locator('.state-indicator').first()
    .evaluate((element) => getComputedStyle(element).borderTopStyle)
  expect(stateBorder).not.toBe('none')
  await page.getByRole('button', { name: 'Apply filters' }).focus()
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeFocused()

  // A shorter visual viewport exercises the same wrapping and scroll path used when a
  // software keyboard occupies the lower part of a narrow-screen browser.
  await page.setViewportSize({ width: 320, height: 360 })
  const reason = page.getByLabel('Exact reason')
  await reason.focus()
  await reason.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await expect(reason).toBeFocused()
  const keyboardViewport = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    focusedTop: (document.activeElement as HTMLElement).getBoundingClientRect().top,
    focusedBottom: (document.activeElement as HTMLElement).getBoundingClientRect().bottom,
  }))
  expect(keyboardViewport.document).toBe(keyboardViewport.viewport)
  expect(keyboardViewport.focusedTop).toBeGreaterThanOrEqual(0)
  expect(keyboardViewport.focusedBottom).toBeLessThanOrEqual(360)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Operation ID')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(reason).toBeFocused()
  await expectNoSeriousAxeViolations(page)
})

test('acknowledges a local filter action within 100ms and labels held network work within 500ms', async ({ page }) => {
  await page.route('**/api/backoffice/clients/*/billing/adjustments*', async (route) => {
    const filtered = new URL(route.request().url()).searchParams.has('reason')
    if (filtered) await new Promise((resolve) => setTimeout(resolve, 750))
    await json(route, filtered
      ? '{"items":[],"asOf":"2026-09-24T09:00:00.000001","nextCursor":null}'
      : historyBody())
  })
  await page.goto(historyPath)
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByLabel('Exact reason').fill('Held request')

  const acknowledgementMs = await page.getByRole('button', { name: 'Apply filters' })
    .evaluate(async (button) => {
      const started = performance.now()
      const acknowledgement = new Promise<number>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          observer.disconnect()
          reject(new Error('No local acknowledgement within 100ms'))
        }, 100)
        const observer = new MutationObserver(() => {
          if (button.hasAttribute('disabled') || button.textContent?.includes('Applying')) {
            window.clearTimeout(timeout)
            observer.disconnect()
            resolve(performance.now() - started)
          }
        })
        observer.observe(button, { attributes: true, childList: true, subtree: true })
      })
      button.click()
      return acknowledgement
    })
  expect(acknowledgementMs).toBeLessThanOrEqual(100)
  await expect(page.getByText('Loading adjustment history…')).toBeVisible({ timeout: 500 })
  await expect(page.getByRole('heading', { name: 'No adjustments match these filters' }))
    .toBeVisible()
})

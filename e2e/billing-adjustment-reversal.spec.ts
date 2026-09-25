import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CLIENT_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const ACCOUNT = '0199d000-0000-7000-8000-000000000099'
const ACTOR = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'
const ACTOR_B = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
const ORIGINAL = '0199d000-0000-7000-8000-000000000001'
const ORIGINAL_OPERATION = '0199d000-0000-7000-8000-000000000010'
const ORIGINAL_LEDGER = '0199d000-0000-7000-8000-000000000020'
const REVERSAL = '0199d000-0000-7000-8000-000000000002'
const REVERSAL_LEDGER = '0199d000-0000-7000-8000-000000000021'
const historyPath = `/billing/clients/${CLIENT}/adjustments`

interface ReadState {
  committed: boolean
  operationId: string
  linked?: boolean
  operationVisible?: boolean
  operationUnavailable?: boolean
  originalAmount?: string
  ownedBalance?: string
  reservedBalance?: string
  walletVersion?: string
}

const scaled = (value: string): bigint => {
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const result = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'))
  return negative ? -result : result
}

const decimal = (value: bigint): string => {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = magnitude / 10_000n
  const fraction = (magnitude % 10_000n).toString().padStart(4, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

async function installSession(
  page: Page,
  role: 'Admin' | 'Viewer' = 'Admin',
  actorId = ACTOR,
  clientId = CLIENT
): Promise<void> {
  await page.addInitScript(({ clientId, actorId, actorRole }) => {
    const user = { id: actorId, email: 'operator@example.test', displayName: 'Operator',
      role: actorRole, clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({
      state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0,
    }))
  }, { clientId, actorId, actorRole: role })
}

async function json(route: Route, body: string, status = 200): Promise<void> {
  await fulfillLocal(route, {
    status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body,
  })
}

function original(linked = false, amount = '10.0000', clientId = CLIENT): string {
  const beforeOwned = '100.0000'
  const reserved = '20.0000'
  const afterOwned = decimal(scaled(beforeOwned) + scaled(amount))
  const beforeAvailable = decimal(scaled(beforeOwned) - scaled(reserved))
  const afterAvailable = decimal(scaled(afterOwned) - scaled(reserved))
  return `{"schemaVersion":1,"clientId":"${clientId}","creditAccountId":"${ACCOUNT}",` +
    `"operationId":"${ORIGINAL_OPERATION}","adjustmentId":"${ORIGINAL}","ledgerId":"${ORIGINAL_LEDGER}",` +
    `"operationType":"original","amount":${amount},"reason":"Original correction",` +
    `"performedBy":"${ACTOR}","expectedWalletVersion":40,"walletVersionBefore":40,` +
    `"walletVersionAfter":41,"beforeOwnedBalance":${beforeOwned},"beforeReservedBalance":${reserved},` +
    `"beforeAvailableBalance":${beforeAvailable},"afterOwnedBalance":${afterOwned},"afterReservedBalance":${reserved},` +
    `"afterAvailableBalance":${afterAvailable},"operationAsOf":"2026-09-24T08:09:10.123456",` +
    `"originalAdjustmentId":null,"reversalAdjustmentId":${linked ? `"${REVERSAL}"` : 'null'}}`
}

function reversal(operationId: string, clientId = CLIENT): string {
  return `{"schemaVersion":1,"clientId":"${clientId}","creditAccountId":"${ACCOUNT}",` +
    `"operationId":"${operationId}","adjustmentId":"${REVERSAL}","ledgerId":"${REVERSAL_LEDGER}",` +
    `"operationType":"reversal","amount":-10.0000,"reason":"Undo duplicate allocation",` +
    `"performedBy":"${ACTOR}","expectedWalletVersion":41,"walletVersionBefore":41,` +
    `"walletVersionAfter":42,"beforeOwnedBalance":110.0000,"beforeReservedBalance":20.0000,` +
    `"beforeAvailableBalance":90.0000,"afterOwnedBalance":100.0000,"afterReservedBalance":20.0000,` +
    `"afterAvailableBalance":80.0000,"operationAsOf":"2026-09-24T10:00:00.123456",` +
    `"originalAdjustmentId":"${ORIGINAL}","reversalAdjustmentId":null}`
}

function history(linked = false, operationId = '', amount = '10.0000', clientId = CLIENT): string {
  return `{"items":[${original(linked, amount, clientId)}${linked ? `,${reversal(operationId, clientId)}` : ''}],` +
    `"asOf":"2026-09-24T10:00:01.123456","nextCursor":null}`
}

function account(state: ReadState, clientId = CLIENT): string {
  const owned = state.ownedBalance ?? (state.committed ? '100.0000' : '110.0000')
  const reserved = state.reservedBalance ?? '20.0000'
  const available = decimal(scaled(owned) - scaled(reserved))
  return `{"creditAccountId":"${ACCOUNT}","clientId":"${clientId}",` +
    `"ownedBalance":${owned},"activelyReservedAmount":${reserved},` +
    `"availableBalance":${available},"activeReservationCount":1,` +
    `"status":"active","asOf":"2026-09-24T09:00:00.123456",` +
    `"walletVersion":${state.walletVersion ?? (state.committed ? '42' : '41')}}`
}

function receipt(operationId: string, clientId = CLIENT): string {
  return `{"schemaVersion":1,"operationId":"${operationId}",` +
    `"originalAdjustmentId":"${ORIGINAL}","reversalAdjustmentId":"${REVERSAL}",` +
    `"reversalLedgerId":"${REVERSAL_LEDGER}","clientId":"${clientId}",` +
    `"creditAccountId":"${ACCOUNT}","compensatingAmount":-10.0000,` +
    `"reason":"Undo duplicate allocation","performedBy":"${ACTOR}",` +
    `"walletVersionBefore":41,"walletVersionAfter":42,"beforeOwnedBalance":110.0000,` +
    `"beforeReservedBalance":20.0000,"beforeAvailableBalance":90.0000,` +
    `"afterOwnedBalance":100.0000,"afterReservedBalance":20.0000,` +
    `"afterAvailableBalance":80.0000,"operationAsOf":"2026-09-24T10:00:00.123456"}`
}

async function installReadRoutes(page: Page, state: ReadState, clientId = CLIENT) {
  await page.route(`**/api/backoffice/clients/${clientId}/billing/account`, (route) =>
    json(route, account(state, clientId)))
  await page.route(`**/api/backoffice/clients/${clientId}/billing/adjustments*`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const url = new URL(route.request().url())
    if (url.searchParams.has('operationId')) {
      if (state.operationUnavailable)
        return json(route, '{"title":"Unavailable","status":503,"code":"temporary_unavailable"}', 503)
      return json(route, (state.operationVisible ?? state.committed)
        ? `{"items":[${reversal(state.operationId, clientId)}],"asOf":"2026-09-24T10:00:01.123456","nextCursor":null}`
        : '{"items":[],"asOf":"2026-09-24T10:00:01.123456","nextCursor":null}')
    }
    const linked = state.linked ?? state.committed
    await json(route, history(linked, state.operationId, state.originalAmount ?? '10.0000', clientId))
  })
}

async function openReview(page: Page, clientId = CLIENT): Promise<void> {
  await page.goto(`/billing/clients/${clientId}/adjustments`)
  await page.getByRole('button', {
    name: `Review reversal for original adjustment ${ORIGINAL}`,
  }).first().click()
  await expect(page.getByRole('dialog', { name: 'Review adjustment reversal' })).toBeVisible()
}

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await installSession(page)
  await installTimeZoneRoute(page)
  page.on('pageerror', (error) => { throw error })
  page.on('console', (message) => {
    // Chromium reports intentionally exercised HTTP 4xx/5xx responses as generic resource
    // errors. Every other console error remains a hard failure.
    if (message.type() === 'error' &&
        !message.text().startsWith('Failed to load resource: the server responded with a status of'))
      throw new Error(`Browser console error: ${message.text()}`)
  })
})

test('opens from exact fresh reads, presents local evidence, cancels, and preserves view-only parity', async ({ page }) => {
  const state = { committed: false, operationId: '' }
  await installReadRoutes(page, state)
  await openReview(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  for (const evidence of [
    `Selected Client ${CLIENT}`, ACCOUNT, ORIGINAL, 'Original correction', '+10.0000', '-10.0000',
    '2026-09-24 08:09:10.123456', '2026-09-24 09:00:00.123456',
    'Reserved balance — unchanged',
  ]) await expect(dialog).toContainText(evidence)
  await axe(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', {
    name: `Review reversal for original adjustment ${ORIGINAL}`,
  }).first()).toBeFocused()

  await page.unrouteAll({ behavior: 'wait' })
  await installSession(page, 'Viewer')
  await installTimeZoneRoute(page)
  await installReadRoutes(page, state)
  await page.reload()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Action' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Review reversal/ })).toHaveCount(0)
})

test('covers negative-credit, equality, unsafe-debit, and overflow projections', async ({ page }) => {
  const scenarios: Array<{
    name: string
    state: ReadState
    expected: string[]
    rejected?: RegExp
  }> = [
    {
      name: 'negative original projects a safe credit',
      state: { committed: false, operationId: '', originalAmount: '-10.0000', ownedBalance: '90.0000' },
      expected: ['-10.0000', '+10.0000', '100.0000'],
    },
    {
      name: 'debit equality keeps zero available eligible',
      state: { committed: false, operationId: '', ownedBalance: '30.0000' },
      expected: ['20.0000', '0.0000'],
    },
    {
      name: 'unsafe debit is blocked before confirmation',
      state: { committed: false, operationId: '', ownedBalance: '29.9999' },
      expected: [], rejected: /reserved credits make the compensating debit unsafe/i,
    },
    {
      name: 'credit overflow is blocked before confirmation',
      state: {
        committed: false, operationId: '', originalAmount: '-10.0000',
        ownedBalance: '99999999999999.9999',
      },
      expected: [], rejected: /compensating credit would exceed the supported balance range/i,
    },
  ]

  for (const scenario of scenarios) {
    await page.unrouteAll({ behavior: 'wait' })
    await installTimeZoneRoute(page)
    await installReadRoutes(page, scenario.state)
    await page.goto(historyPath)
    await page.getByRole('button', {
      name: `Review reversal for original adjustment ${ORIGINAL}`,
    }).first().click()
    if (scenario.rejected) {
      await expect(page.getByText(scenario.rejected)).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } else {
      const dialog = page.getByRole('dialog', { name: 'Review adjustment reversal' })
      await expect(dialog, scenario.name).toBeVisible()
      for (const value of scenario.expected)
        await expect(dialog, `${scenario.name}: ${value}`).toContainText(value)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
    }
  }
})

test('confirms one exact three-field operation and fresh-starts authoritative history', async ({ page }) => {
  const state = { committed: false, operationId: '' }
  const bodies: string[] = []
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      const body = route.request().postData() ?? ''
      bodies.push(body)
      state.operationId = /"operationId":"([^"]+)"/.exec(body)?.[1] ?? ''
      expect(state.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(body).toBe(`{"operationId":"${state.operationId}","expectedWalletVersion":41,"reason":"Undo duplicate allocation"}`)
      state.committed = true
      await json(route, receipt(state.operationId))
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText('Compensating reversal confirmed')).toBeVisible()
  await expect(page.getByText(/validated receipt/)).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('2026-09-24 10:00:00.123456')
  expect(bodies).toHaveLength(1)
  const privateState = await page.evaluate(() =>
    `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}${location.href}`)
  expect(privateState).not.toContain('Undo duplicate allocation')
  expect(privateState).not.toContain(state.operationId)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Adjustment history', exact: true })).toBeFocused()
  await expect(page.getByText(`Reversed by ${REVERSAL}`).first()).toBeVisible()
})

test('replays one byte-identical sealed command through a successful auth refresh', async ({ page }) => {
  const state: ReadState = { committed: false, operationId: '' }
  const bodies: string[] = []
  await installReadRoutes(page, state)
  await page.route('**/auth/refresh', (route) => json(route,
    '{"accessToken":"refreshed-token","refreshToken":"refreshed-refresh"}'))
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      const body = route.request().postData() ?? ''
      bodies.push(body)
      state.operationId ||= /"operationId":"([^"]+)"/.exec(body)?.[1] ?? ''
      if (bodies.length === 1)
        return json(route, '{"title":"Expired","status":401,"code":"HTTP_401"}', 401)
      state.committed = true
      await json(route, receipt(state.operationId))
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText('Compensating reversal confirmed')).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('retains an unknown outcome and retries byte-identically without permitting abandonment', async ({ page }) => {
  const state = { committed: false, operationId: '' }
  const bodies: string[] = []
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      const body = route.request().postData() ?? ''
      bodies.push(body)
      state.operationId ||= /"operationId":"([^"]+)"/.exec(body)?.[1] ?? ''
      if (bodies.length === 1)
        return json(route, '{"title":"Outcome unknown","status":503,"code":"credit_adjustment_reversal_outcome_unknown"}', 503)
      state.committed = true
      await json(route, receipt(state.operationId))
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText('Outcome unknown')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close reversal review' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Retry same operation' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry same operation' }).click()
  await expect(page.getByText('Compensating reversal confirmed')).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
})

test('reconciles an ambiguous committed operation without retrying the command', async ({ page }) => {
  const state: ReadState = { committed: false, operationId: '' }
  const bodies: string[] = []
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      const body = route.request().postData() ?? ''
      bodies.push(body)
      state.operationId = /"operationId":"([^"]+)"/.exec(body)?.[1] ?? ''
      state.committed = true
      await json(route,
        '{"title":"Outcome unknown","status":503,"code":"credit_adjustment_reversal_outcome_unknown"}', 503)
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText(/confirmed from exact operation evidence/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry same operation' })).toHaveCount(0)
  expect(bodies).toHaveLength(1)
})

test('keeps the sealed operation unknown when reconciliation evidence is unavailable', async ({ page }) => {
  const state: ReadState = { committed: false, operationId: '', operationUnavailable: true }
  const bodies: string[] = []
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      bodies.push(route.request().postData() ?? '')
      await json(route,
        '{"title":"Outcome unknown","status":503,"code":"credit_adjustment_reversal_outcome_unknown"}', 503)
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText('Outcome unknown')).toBeVisible()
  await page.getByRole('button', { name: 'Reconcile' }).click()
  await expect(page.getByText('Outcome unknown')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry same operation' })).toBeVisible()
  expect(bodies).toHaveLength(1)
})

test('keeps a stale outcome determinate without offering sealed retry', async ({ page }) => {
  const state = { committed: false, operationId: '' }
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    (route) => json(route,
      '{"title":"Stale wallet","status":409,"code":"credit_adjustment_reversal_stale_wallet_version"}', 409))
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText(/account changed/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry same operation' })).toHaveCount(0)
})

test('handles an already-reversed race with linked authority and no reversal chain', async ({ page }) => {
  const winnerOperation = '0199d000-0000-7000-8000-000000000099'
  const state: ReadState = {
    committed: false, operationId: winnerOperation, linked: false, operationVisible: false,
  }
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    async (route) => {
      state.committed = true
      state.linked = true
      await json(route,
        '{"title":"Already reversed","status":409,"code":"credit_adjustment_already_reversed"}', 409)
    })
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Undo duplicate allocation')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByText(/already has a reversal/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry same operation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(`Reversed by ${REVERSAL}`).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Review reversal/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: new RegExp(REVERSAL) })).toHaveCount(0)
})

test('keeps readable history while a command-time permission loss clears reversal state', async ({ page }) => {
  const state: ReadState = { committed: false, operationId: '' }
  await installReadRoutes(page, state)
  await page.route(`**/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    (route) => json(route, '{"title":"Forbidden","status":403,"code":"HTTP_403"}', 403))
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Private denied reason')
  await page.getByRole('button', { name: 'Confirm reversal' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByText('Private denied reason')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Adjustment history', exact: true })).toBeFocused()
})

test('clears private review state when the route Client changes', async ({ page }) => {
  const stateA: ReadState = { committed: false, operationId: '' }
  const stateB: ReadState = { committed: false, operationId: '' }
  await installReadRoutes(page, stateA, CLIENT)
  await installReadRoutes(page, stateB, CLIENT_B)
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Private Client A reason')
  await page.goto(`/billing/clients/${CLIENT_B}/adjustments`)
  await expect(page.getByText(`Selected Client: ${CLIENT_B}`)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Private Client A reason')).toHaveCount(0)
  const exposed = await page.evaluate(() =>
    `${location.href}${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`)
  expect(exposed).not.toContain('Private Client A reason')
})

test('does not carry private review state into a different actor session', async ({ page }) => {
  const state: ReadState = { committed: false, operationId: '' }
  await installReadRoutes(page, state)
  await openReview(page)
  await page.getByLabel('Reversal reason').fill('Private first-actor reason')
  await installSession(page, 'Admin', ACTOR_B)
  await page.reload()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Private first-actor reason')).toHaveCount(0)
  await expect(page.getByRole('button', {
    name: `Review reversal for original adjustment ${ORIGINAL}`,
  }).first()).toBeVisible()
  const exposed = await page.evaluate(() =>
    `${location.href}${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`)
  expect(exposed).not.toContain('Private first-actor reason')
})

test('reflows at 320px with text spacing, forced colours, keyboard safety, and 44px targets', async ({ page }) => {
  const state = { committed: false, operationId: '' }
  await installReadRoutes(page, state)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await openReview(page)
  await page.addStyleTag({ content: `html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const dialog = page.getByRole('dialog')
  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  const targets = await dialog.locator('button:visible, a:visible, textarea:visible')
    .evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  await page.setViewportSize({ width: 320, height: 360 })
  await page.getByLabel('Reversal reason').focus()
  await expect(page.getByLabel('Reversal reason')).toBeFocused()
  await axe(page)
})

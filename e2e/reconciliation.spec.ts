import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { reconciliationFixture, CLIENT, FINDING, JOB, RESERVATION } from '../src/test/reconciliationFixture'
import type { ResolutionCommand } from '../src/api/reconciliationApi'
import type { ReconciliationAction } from '../src/types/reconciliation'
async function session(page: Page, role = 'Admin') {
  await page.addInitScript(({ clientId, role }) => {
    const user = { id: 'operator', email: 'operator@example.test', displayName: 'Operator', role, clientId, accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 }
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh', user }, version: 0 }))
  }, { clientId: CLIENT, role })
}
async function keyboardReach(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible()
  for (let steps = 0; steps < 80; steps++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Control was not reachable in the keyboard reading order.')
}
function receipt(command: ResolutionCommand, replayed = false) {
  return { schemaVersion: 1, operationId: command.operationId, findingId: command.findingId, action: command.action, applied: !replayed, replayed, resolvedAt: '2026-10-05T08:10:00Z', caseVersion: 'opaque-resolved',
    afterState: { schemaVersion: 1, evidenceFingerprint: 'c'.repeat(64), jobStatus: command.action === 'commit_confirmed_execution' ? 'completed' : command.action === 'authorize_safe_reexecution' ? 'reserved' : 'failed', attemptOutcomeStatus: command.action === 'commit_confirmed_execution' ? 'succeeded' : command.action === 'authorize_safe_reexecution' ? 'execution_unknown' : 'failed', attemptExecutionPhase: command.action === 'authorize_safe_reexecution' ? 'dispatched' : 'resolved', attemptCount: 1, currentAttemptId: command.action === 'authorize_safe_reexecution' ? null : FINDING, leaseState: 'none', reservationState: command.action === 'commit_confirmed_execution' ? 'committed' : command.action === 'authorize_safe_reexecution' ? 'active' : 'released', estimatedCredits: '2.2500', actualCredits: command.action === 'commit_confirmed_execution' ? '1.2345' : null, resultIds: [], usageIds: [], providerCostIds: [], ledgerOperationIds: [], outcomeEventIds: [], outboxEventIds: [] } }
}
const url = `/billing/clients/${CLIENT}/reconciliation`
test.beforeEach(async ({ page }) => { await session(page) })
test('keyboard confirmation, reason semantics, cancellation focus and responsive accessibility', async ({ page }) => {
  let posts = 0
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'POST') posts++
    await route.fulfill({ json: reconciliationFixture() })
  })
  await page.goto(url)
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).focus()
  await page.keyboard.press('Enter')
  const action = page.getByRole('button', { name: 'Release confirmed non-execution' })
  await action.focus(); await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Confirm case action' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel confirmation' })).toBeFocused()
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Reason (required)' })).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('link', { name: /Reason:/ }).click()
  await expect(page.getByRole('textbox', { name: 'Reason (required)' })).toBeFocused()
  if (process.env.RECONCILIATION_MANUAL_A11Y === '1') await page.pause()
  expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).toMatchObject({ violations: [] })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible(); await expect(action).toBeFocused()
  await action.click()
  await expect(dialog).toBeVisible()
  await page.setViewportSize({ width: 320, height: 640 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; }' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const button = page.getByRole('button', { name: 'Cancel confirmation' })
  const bounds = await button.boundingBox()
  expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44)
  await button.click()
  await expect(page.getByRole('list', { name: 'Reconciliation cases' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(posts).toBe(0)
})
test('unknown outcome uses identical actor/Client command; explicit replay confirms receipt', async ({ page }) => {
  const bodies: string[] = []
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: reconciliationFixture() }); return }
    bodies.push(route.request().postData()!)
    if (bodies.length === 1) { await route.abort(); return }
    await route.fulfill({ json: receipt(JSON.parse(bodies[0]!), true) })
  })
  await page.goto(url)
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Release confirmed non-execution' }).click()
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('Trusted provider confirms no execution')
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByRole('dialog')).toContainText('Outcome unknown')
  await page.getByRole('dialog').getByRole('button', { name: 'Check same operation' }).click()
  await expect(page.getByText(/Prior resolution replay confirmed/)).toBeVisible()
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0])
  const command = JSON.parse(bodies[0]!)
  expect(Object.keys(command)).toEqual(['operationId', 'clientId', 'findingId', 'jobId', 'reservationId', 'action', 'reason', 'expectedCaseVersion', 'evidenceFingerprint', 'providerProofId'])
  expect(command.operationId).toMatch(/-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/)
  expect(command).toMatchObject({ clientId: CLIENT, findingId: FINDING, jobId: JOB, reservationId: RESERVATION })
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Trusted provider confirms')
})
test('fresh state refusal prevents POST and Client switch hides all prior private evidence', async ({ page }) => {
  let gets = 0; let posts = 0
  const otherClient = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'POST') posts++
    if (new URL(route.request().url()).searchParams.get('clientId') === otherClient) { await route.fulfill({ json: { ...reconciliationFixture(), clientId: otherClient, items: [] } }); return }
    const fixture = reconciliationFixture(); gets++
    if (gets > 2) fixture.items[0]!.evidenceFingerprint = 'd'.repeat(64)
    await route.fulfill({ json: fixture })
  })
  await page.goto(url)
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Release confirmed non-execution' }).click()
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('Reason retained on stale evidence')
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByText(/Case state changed or the action was refused/)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Case state changed' })).toBeFocused()
  expect(posts).toBe(0)
  await page.goto(`/billing/clients/${otherClient}/reconciliation`)
  await expect(page.getByText(/No reconciliation cases/)).toBeVisible()
  await expect(page.getByText(FINDING, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
for (const action of ['commit_confirmed_execution', 'release_confirmed_non_execution', 'authorize_safe_reexecution'] as ReconciliationAction[]) {
  test(`only fresh server-authorized ${action} can submit`, async ({ page }) => {
    let command: ResolutionCommand | undefined
    const fixture = reconciliationFixture(); const item = fixture.items[0]!
    item.allowedActions = [action]
    if (action === 'authorize_safe_reexecution') { item.providerProofs[0]!.proofType = 'deduplicated_replay_safe'; item.providerProofs[0]!.validityMode = 'unbounded_key_lifetime' }
    if (action === 'commit_confirmed_execution') {
      item.providerProofs = []
      item.usage = { usageId: FINDING, jobId: JOB, attemptId: FINDING, reservationId: RESERVATION, clientId: CLIENT, accountId: CLIENT, providerName: 'fixture', modelName: 'fixture-model', inputTokens: null, outputTokens: null, imageCount: 1, chargedCredits: '1.2345', correlationId: 'fixture-correlation', observedAt: fixture.asOf, createdAt: fixture.asOf }
    }
    await page.route('**/api/billing/reconciliation**', async route => {
      if (route.request().method() === 'GET') { await route.fulfill({ json: fixture }); return }
      command = JSON.parse(route.request().postData()!)
      await route.fulfill({ json: receipt(command!) })
    })
    await page.goto(url)
    await keyboardReach(page, page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }))
    await page.keyboard.press('Enter')
    const text = { commit_confirmed_execution: 'Commit confirmed execution', release_confirmed_non_execution: 'Release confirmed non-execution', authorize_safe_reexecution: 'Authorize safe re-execution' }[action]
    await keyboardReach(page, page.getByRole('button', { name: text, exact: true }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toContainText('2.2500 abstract Soveris credit hold')
    await keyboardReach(page, page.getByRole('textbox', { name: 'Reason (required)' }))
    await page.keyboard.type('Validated immutable evidence')
    await keyboardReach(page, page.getByRole('button', { name: 'Confirm resolution' }))
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Resolution applied at/)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Resolution confirmed.' })).toBeFocused()
    await expect(page.getByRole('region', { name: 'Confirmed resolution state' })).toContainText(action === 'commit_confirmed_execution' ? 'committed' : action === 'authorize_safe_reexecution' ? 'active' : 'released')
    expect(command?.action).toBe(action)
    expect(command?.providerProofId === null).toBe(action === 'commit_confirmed_execution')
  })
}
test('filters reset snapshot and cursor continuation sends no repeated filters', async ({ page }) => {
  const queries: Record<string, string>[] = []
  await page.route('**/api/billing/reconciliation**', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams)
    queries.push(params)
    const fixture = reconciliationFixture()
    if (params.cursor) { fixture.items[0]!.finding.findingId = '01995d88-7740-73f1-8000-000000000099' }
    else fixture.nextCursor = 'opaque-page'
    await route.fulfill({ json: fixture })
  })
  await page.goto(url)
  await page.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('critical')
  await page.getByLabel('Minimum age (seconds)').fill('3600')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByRole('button', { name: 'Load more cases' })).toBeEnabled()
  await page.getByRole('button', { name: 'Load more cases' }).click()
  await expect(page.getByText(/2 cases loaded/)).toBeVisible()
  expect(queries[queries.length - 1]).toEqual({ clientId: CLIENT, cursor: 'opaque-page' })
  expect(queries).toContainEqual({ clientId: CLIENT, pageSize: '20', severity: 'critical', minimumAgeSeconds: '3600' })
})

test('authorization refresh cancels old confirmation while unknown recovery retains no private state', async ({ page }) => {
  let reads = 0
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'POST') { await route.abort(); return }
    reads++
    const fixture = reconciliationFixture()
    if (reads > 3) fixture.items = []
    await route.fulfill({ json: fixture })
  })
  await page.goto(url)
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Release confirmed non-execution' }).click()
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('Private retained reason')
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByRole('dialog')).toContainText('Outcome unknown')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('auth:refreshed')))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check same operation' })).toHaveCount(0)
  await expect(page.getByText(/No reconciliation cases/)).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('Private retained reason')
})

test('denial purges evidence and permission loss makes no new reconciliation request', async ({ page }) => {
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'POST') { await route.fulfill({ status: 403, json: { title: 'Forbidden', code: 'reconciliation_forbidden', detail: 'private dependency detail must never render' } }); return }
    await route.fulfill({ json: reconciliationFixture() })
  })
  await page.goto(url)
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Release confirmed non-execution' }).click()
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('Audit reason')
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByRole('heading', { name: 'Reconciliation access denied' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeFocused()
  expect(await page.locator('body').innerText()).not.toContain(FINDING)
  expect(await page.locator('body').innerText()).not.toContain('private dependency detail')
})

test('accepted evidence and guarded recovery survive capability loss; landscape and keyboard viewport remain usable', async ({ page }) => {
  let capabilityReads = 0
  let posted: ResolutionCommand | undefined
  await page.route('**/api/backoffice/clients/*/capabilities', async route => { capabilityReads++; await route.fulfill({ status: 403, json: { code: 'feature_not_available', title: 'Feature unavailable' } }) })
  await page.route('**/api/billing/reconciliation**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: reconciliationFixture() }); return }
    posted = JSON.parse(route.request().postData()!)
    await route.fulfill({ json: receipt(posted!) })
  })
  await page.goto(url)
  await page.setViewportSize({ width: 640, height: 320 })
  await page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true }).click()
  await page.getByText('Accepted Job', { exact: true }).click()
  await expect(page.getByText('a'.repeat(64), { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Release confirmed non-execution' }).click()
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('Accepted provider proof remains authoritative')
  await page.setViewportSize({ width: 320, height: 300 }) // Reduced visual area while a virtual keyboard is open.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expect(page.getByRole('region', { name: 'Confirmed resolution state' })).toContainText('released')
  expect(posted?.action).toBe('release_confirmed_non_execution')
  expect(capabilityReads).toBe(0) // Recovery never consults admission capability or rewrites its evidence.
})

test('partial pagination failure retains verified rows and exposes stale state', async ({ page }) => {
  await page.route('**/api/billing/reconciliation**', async route => {
    if (new URL(route.request().url()).searchParams.has('cursor')) { await route.fulfill({ status: 503, json: { code: 'reconciliation_dependency_unavailable', title: 'Unavailable' } }); return }
    const fixture = reconciliationFixture(); fixture.nextCursor = 'pending-page'
    await route.fulfill({ json: fixture })
  })
  await page.goto(url)
  await page.getByRole('button', { name: 'Load more cases' }).click()
  await expect(page.getByText(/Partial results retained/)).toBeVisible()
  await expect(page.getByRole('button', { name: `Inspect case ${FINDING}` }).filter({ visible: true })).toBeVisible()
})

test('GET permission denial restores focus to the cleared access state', async ({ page }) => {
  await page.route('**/api/billing/reconciliation**', route => route.fulfill({ status: 403, json: { title: 'Forbidden', code: 'reconciliation_forbidden' } }))
  await page.goto(url)
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Reconciliation access denied' })).toBeVisible()
})

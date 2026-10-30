import { test, expect, type Page } from '@playwright/test'
import { completeChallenge, installChallengeProvider } from './accountAbuseProvider'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const cases: Record<string, string> = JSON.parse(readFileSync(new URL('./fixtures/account-journeys-cases.json', import.meta.url), 'utf8'))

const origin = 'http://127.0.0.1:5173'
const prefix = '/api/backoffice/auth'
const password = 'Story164 original private phrase with spaces '
const newPassword = 'Story164 replacement private phrase with spaces '
const sensitive = new Set<string>()

function bridge(action: string, body: unknown): Record<string, any> {
  const helper = process.env.ACCOUNT_JOURNEYS_BRIDGE
  const context = process.env.ACCOUNT_JOURNEYS_CONTEXT

  if (!helper || !context) {
    throw new Error('Canonical Infrastructure account browser context is required')
  }

  try {
    return JSON.parse(execFileSync('python3', [helper, context, action], {
      input: JSON.stringify(body), encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
    }))
  } catch {
    throw new Error(`Owned fixture phase failed: ${action}; private diagnostics withheld`)
  }
}

function address(): string {
  const email = `story164-${randomUUID()}@example.test`
  sensitive.add(email)

  return email
}

async function signup(page: Page, email: string): Promise<string> {
  sensitive.add(password)
  await page.goto('/signup')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await completeChallenge(page)
  const receipt = page.waitForResponse(response => response.url().endsWith(prefix + '/register'))
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const response = await receipt
  expect(response.status()).toBe(202)
  const pending = (await response.json()).pendingToken as string
  sensitive.add(pending)
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  return pending
}

function mail(email: string, kind = 'verify', excluded: string[] = []): string {
  const proof = bridge('mail', { email, kind, excluded }).proof as string
  sensitive.add(proof)

  return proof
}

async function verify(page: Page, proof: string): Promise<void> {
  await page.goto('/verify-email#proof=' + proof)
  await expect(page).toHaveURL(origin + '/verify-email')
  await expect(page.getByRole('button', { name: 'Check sign-in method' })).toBeVisible()
  const contextResponse = page.waitForResponse(response => response.url().endsWith(prefix + '/registration/proof-context'))
  await page.getByRole('button', { name: 'Check sign-in method' }).click()

  if ((await contextResponse).status() !== 200) {
    return
  }
  await page.getByLabel('Original signup password').fill(password)
  await page.getByRole('button', { name: 'Verify email', exact: true }).click()
}

async function rememberSession(page: Page): Promise<{ access: string; refresh: string }> {
  const session = await page.evaluate(() => ({ access: localStorage.getItem('backoffice_access_token') ?? '', refresh: localStorage.getItem('backoffice_refresh_token') ?? '' }))
  sensitive.add(session.access)
  sensitive.add(session.refresh)

  return session
}

test.beforeEach(async ({ context }) => {
  expect(bridge('begin-case', {}).ready).toBe(true)
  await installChallengeProvider(context)
  sensitive.clear()
  sensitive.add(password)
  sensitive.add(newPassword)
})

test.afterEach(async ({ page, browser }, info) => {
  try {
    if (!page.isClosed()) {
      await rememberSession(page).catch(() => undefined)
    }

    const privacy = bridge('privacy', { secrets: [...sensitive] })
    const digests = [...sensitive].filter(Boolean).map(value => ({ length: value.length, sha256: createHash('sha256').update(value).digest('hex') }))
    writeFileSync(info.outputPath('privacy.json'), JSON.stringify({ ...privacy, digests }, null, 2))
    expect(privacy.pass).toBe(true)
  } finally {
    // The public TestInfo error model is scrubbed before Playwright can build
    // its automatic failure context. Preserve failing source positions only.
    for (const error of info.errors) {
      const position = error.stack?.match(/account-journeys-live\.spec\.ts:(\d+):(\d+)/)

      if (position) {
        info.annotations.push({ type: 'private-failure-location', description: `account-journeys-live.spec.ts:${position[1]}:${position[2]}` })
      }

      error.message = 'Account browser assertion failed; private diagnostics withheld.'
      error.stack = ''
      error.errorContext = undefined
      error.value = undefined
    }

    for (const context of browser.contexts()) {
      for (const browserPage of context.pages()) {
        await browserPage.evaluate(() => {
          document.documentElement.replaceChildren()
          history.replaceState(null, '', '/')
        }).catch(() => undefined)
      }
    }

    sensitive.clear()
  }
})

test(cases.happy, async ({ page, browser }, info) => {
  const email = address()
  const pending = await signup(page, email)
  const before = bridge('snapshot', { email })
  expect(before).toMatchObject({ users: 0, clients: 0, pending: 1, consumed: 0 })
  const denied = await page.request.get(prefix + '/current', { headers: { Authorization: 'Bearer ' + pending } })
  expect(denied.status()).toBe(401)
  expect((await page.request.post(prefix + '/refresh', { data: { refreshToken: pending } })).status()).toBe(401)
  const proof = mail(email)
  const separate = await browser.newContext({ baseURL: origin })

  try {
    const continuation = await separate.newPage()
    await continuation.goto('/verify-email#proof=' + proof)
    expect(bridge('snapshot', { email })).toMatchObject({ users: 0, clients: 0, consumed: 0 })
    expect(await continuation.evaluate(() => !localStorage.getItem('backoffice_access_token') && !localStorage.getItem('backoffice_refresh_token'))).toBe(true)
    expect(await continuation.evaluate(values => values.every(value => !JSON.stringify([history.state, localStorage, sessionStorage]).includes(value)), [pending, proof, password])).toBe(true)
    await continuation.getByRole('button', { name: 'Check sign-in method' }).click()
    await continuation.getByLabel('Original signup password').fill(password)
    await continuation.getByRole('button', { name: 'Verify email', exact: true }).click()
    await expect(continuation.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
    await expect(continuation.getByLabel('Product name', { exact: true })).toBeFocused()
    await rememberSession(continuation)
    const after = bridge('snapshot', { email })
    expect(after).toMatchObject({ users: 1, clients: 1, owners: 1, verified: 1, customers: 1, products: 0, wallets: 0,
      subscriptions: 0, grants: 0, domains: 0, platformGrants: 0, consumed: 1 })
    writeFileSync(info.outputPath('effects.json'), JSON.stringify({ before, after }, null, 2))
    await continuation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await continuation.reload()
    await expect(continuation.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
    await expect(continuation.getByRole('dialog')).toHaveCount(0)
    expect(bridge('snapshot', { email }).products).toBe(0)
  } finally {
    await separate.close()
  }
})

test(cases.continuation, async ({ page, browser }) => {
  const email = address()
  await signup(page, email)
  const proof = mail(email)
  await page.goto('/verify-email#proof=' + proof)
  await expect(page.getByRole('button', { name: 'Check sign-in method' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/reopen the newest applicable email link/i)).toBeVisible()
  expect(bridge('snapshot', { email }).consumed).toBe(0)
  await verify(page, proof)
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  await rememberSession(page)
  const replayContext = await browser.newContext({ baseURL: origin })

  try {
    const replay = await replayContext.newPage()
    await verify(replay, proof)
    await expect(replay.getByRole('heading', { name: 'Activation complete' })).toBeVisible()
    expect(await replay.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    await replay.getByRole('link', { name: 'Log in', exact: true }).click()
    await replay.goBack()
    expect(bridge('snapshot', { email })).toMatchObject({ users: 1, clients: 1, consumed: 1 })
  } finally {
    await replayContext.close()
  }
})

test(cases.correction, async ({ page }) => {
  await page.clock.install()
  const email = address()
  const corrected = address()
  await signup(page, email)
  const original = mail(email)
  bridge('release-mail-budget', { email })
  await page.clock.fastForward(61000)
  await page.getByRole('button', { name: 'Request another email', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Another email requested')
  const resent = mail(email, 'verify', [original])
  expect(resent !== original).toBe(true)
  const staleOriginal = await page.request.post(prefix + '/registration/verify', { headers: { Origin: origin }, data: { proof: original, password } })
  expect(staleOriginal.status()).toBe(400)
  expect((await staleOriginal.json()).code).toBe('invalid_or_expired_proof')
  await page.clock.fastForward(61000)
  await page.getByLabel('Correct email address').fill(corrected)
  const correctionResponse = page.waitForResponse(response => response.url().endsWith(prefix + '/registration/correct-email'))
  await page.getByRole('button', { name: 'Request email correction' }).click()
  expect((await correctionResponse).status()).toBe(202)
  await expect(page.getByRole('status').filter({ hasText: 'does not confirm an address change or delivery' })).toBeVisible()
  const current = mail(corrected)
  expect(bridge('snapshot', { email }).pending).toBe(0)
  expect(bridge('snapshot', { email: corrected })).toMatchObject({ pending: 1, users: 0 })
  const staleResent = await page.request.post(prefix + '/registration/verify', { headers: { Origin: origin }, data: { proof: resent, password } })
  expect(staleResent.status()).toBe(400)
  expect((await staleResent.json()).code).toBe('invalid_or_expired_proof')
  const count = bridge('snapshot', { email: corrected }).proofs
  await page.clock.fastForward(61000)
  const unchangedResponse = page.waitForResponse(response => response.url().endsWith(prefix + '/registration/correct-email'))
  await page.getByRole('button', { name: 'Request email correction' }).click()
  expect((await unchangedResponse).status()).toBe(202)
  await expect(page.getByRole('status')).toContainText('Correction requested')
  expect(bridge('snapshot', { email: corrected }).proofs).toBe(count)
  await verify(page, current)
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
})

test(cases.expiry, async ({ page }) => {
  const email = address()
  await signup(page, email)
  const proof = mail(email)
  bridge('expire-proof', { email })
  await verify(page, proof)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(bridge('snapshot', { email })).toMatchObject({ users: 0, clients: 0, consumed: 0 })
  await page.reload()
  await expect(page.getByText(/reopen the newest applicable email link/i)).toBeVisible()
  const expiredPending = address()
  await page.clock.install()
  await signup(page, expiredPending)
  mail(expiredPending)
  bridge('expire-pending', { email: expiredPending })
  await page.clock.fastForward(61000)
  await page.getByRole('button', { name: 'Request another email', exact: true }).click()
  await expect(page.getByText(/expired or unavailable in this page/i)).toBeVisible()
  expect(bridge('snapshot', { email: expiredPending }).users).toBe(0)
})

test(cases.reset, async ({ page, browser }) => {
  const email = address()
  await signup(page, email)
  await verify(page, mail(email))
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const prior = await rememberSession(page)
  const oldTab = await page.context().newPage()
  await oldTab.goto('/products')
  await expect(oldTab.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
  const revision = bridge('snapshot', { email }).revision
  bridge('release-mail-budget', { email })
  const recoveryContext = await browser.newContext({ baseURL: origin })

  try {
    const recovery = await recoveryContext.newPage()
    await recovery.goto('/forgot-password')
    await recovery.getByLabel('Email address').fill(email)
    await recovery.getByRole('button', { name: 'Request reset instructions' }).click()
    await expect(recovery.getByRole('heading', { name: 'Check for reset instructions' })).toBeVisible()
    const proof = mail(email, 'reset')
    await recovery.goto('/reset-password#proof=' + proof)
    expect(bridge('snapshot', { email }).revision).toBe(revision)
    await recovery.getByLabel('New password').fill(newPassword)
    await recovery.getByRole('button', { name: 'Reset password', exact: true }).click()
    await expect(recovery.getByRole('heading', { name: 'Password reset', exact: true })).toBeVisible()
    expect(await recovery.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    expect(BigInt(bridge('snapshot', { email }).revision) > BigInt(revision)).toBe(true)
    expect((await recovery.request.get(prefix + '/current', { headers: { Authorization: 'Bearer ' + prior.access } })).status()).toBe(401)
    expect((await recovery.request.post(prefix + '/refresh', { data: { refreshToken: prior.refresh } })).status()).toBe(401)
    expect((await recovery.request.post(prefix + '/login', { data: { email, password } })).status()).toBe(401)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(oldTab.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await recovery.getByRole('link', { name: 'Log in', exact: true }).click()
    await recovery.getByLabel('Email address').fill(email)
    await recovery.getByLabel('Password', { exact: true }).fill(newPassword)
    await recovery.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(recovery).toHaveURL(/\/(dashboard|products)$/)
    await rememberSession(recovery)
  } finally {
    await recoveryContext.close()
  }
})

test(cases.lostResponse, async ({ page, browser }) => {
  const email = address()
  await signup(page, email)
  const proof = mail(email)
  await page.route('**/auth/registration/verify', async route => {
    const response = await route.fetch()
    const result = await response.json()

    if (result.session) {
      sensitive.add(result.session.accessToken)
      sensitive.add(result.session.refreshToken)
    }

    await route.abort('failed')
  })
  await verify(page, proof)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(bridge('snapshot', { email })).toMatchObject({ clients: 1, users: 1, consumed: 1 })
  const nextContext = await browser.newContext({ baseURL: origin })

  try {
    const next = await nextContext.newPage()
    await verify(next, proof)
    await expect(next.getByRole('heading', { name: 'Activation complete' })).toBeVisible()
    expect(await next.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    await next.getByRole('link', { name: 'Log in', exact: true }).click()
    await next.getByLabel('Email address').fill(email)
    await next.getByLabel('Password', { exact: true }).fill(password)
    await next.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(next).toHaveURL(/\/(dashboard|products)$/)
    await rememberSession(next)
  } finally {
    await nextContext.close()
  }
})

test(cases.forgot, async ({ page }) => {
  const pending = address()
  await signup(page, pending)
  mail(pending)
  const unknown = address()

  for (const email of [pending, unknown]) {
    const before = bridge('mail-count', { email }).count
    await page.goto('/forgot-password')
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Request reset instructions' }).click()
    await expect(page.getByRole('heading', { name: 'Check for reset instructions' })).toBeVisible()
    expect(bridge('mail-count', { email }).count).toBe(before)
    expect(bridge('snapshot', { email }).users).toBe(0)
  }
})

test(cases.delivery, async ({ page }) => {
  const email = address()
  const pending = await signup(page, email)
  const proof = mail(email)
  const before = bridge('snapshot', { email })
  let posts = 0
  page.on('request', request => {
    if (request.method() === 'POST') {
      posts++
    }
  })

  for (const path of ['/signup', '/login', '/check-email', '/verify-email', '/forgot-password', '/reset-password', '/account-proof-init.js', '/appearance-init.js']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await page.request.fetch(path, { method })
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toContain('no-store')
      expect(response.headers()['referrer-policy']).toBe('no-referrer')
      expect(response.headers()['x-content-type-options']).toBe('nosniff')
    }
  }

  for (const fragment of ['#proof=' + proof, '#proof=' + proof + '&proof=' + proof, '#proof=' + 'A'.repeat(9000)]) {
    await page.goto('/verify-email' + fragment)
    await expect(page).toHaveURL(origin + '/verify-email')
    expect(await page.evaluate(values => location.hash === '' && values.every(value => !JSON.stringify([history.state, localStorage, sessionStorage]).includes(value)), [proof, pending, password])).toBe(true)
  }

  expect(posts).toBe(0)
  expect(bridge('snapshot', { email })).toEqual(before)
})


import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const cases = JSON.parse(readFileSync(new URL('./fixtures/google-account-cases.json', import.meta.url), 'utf8')) as Record<string, string>
const secrets = new Set<string>()
const pendingResponses = new Set<Promise<unknown>>()
const prefix = '/api/backoffice/auth/google'

function fixture(action: string, body: unknown): Record<string, any> {
  try {
    return JSON.parse(execFileSync('python3', [process.env.ACCOUNT_JOURNEYS_BRIDGE!, process.env.ACCOUNT_JOURNEYS_CONTEXT!, action], {
      input: JSON.stringify(body), encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
    }))
  } catch {
    throw new Error('Owned Google browser fixture failed; private values withheld')
  }
}

function address(): string {
  const email = `story164-${randomUUID()}@example.test`
  secrets.add(email)

  return email
}

async function provider(page: Page, email: string, scenario: 'trusted' | 'mailbox' | 'bad-signature' | 'cancel'): Promise<void> {
  await page.route('https://accounts.google.com/o/oauth2/v2/auth**', async route => {
    const authorization = new URL(route.request().url())
    for (const name of ['state', 'nonce', 'code_challenge']) {
      secrets.add(authorization.searchParams.get(name)!)
    }
    const state = authorization.searchParams.get('state')!
    const code = scenario === 'cancel' ? null : fixture('google', { authorizationUrl: authorization.href, email, scenario }).code as string
    if (code) {
      secrets.add(code)
    }
    // Provider document only: callback secrets travel in a form body. No SDK,
    // application query string, token decoding or browser identity stub exists.
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><form method="post" action="http://127.0.0.1:5173${prefix}/callback"><input type="hidden" name="state" value="${state}">${code ? `<input type="hidden" name="code" value="${code}">` : '<input type="hidden" name="error" value="access_denied">'}</form><script>document.forms[0].submit()</script>` })
  })
}

async function enter(page: Page, path: '/signup' | '/login'): Promise<void> {
  await page.goto(path)
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/account/google/complete')
  expect(await page.evaluate(() => !JSON.stringify([history.state, sessionStorage]).includes('code='))).toBe(true)
}

async function finish(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish sign-in', exact: true }).click()
}

async function rememberSession(page: Page): Promise<void> {
  const values = await page.evaluate(() => [localStorage.getItem('backoffice_access_token'), localStorage.getItem('backoffice_refresh_token')])
  values.forEach(value => {
    if (value) {
      secrets.add(value)
    }
  })
}

function captureSecrets(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (['accessToken', 'refreshToken', 'pendingToken', 'proof', 'csrf'].includes(key) && typeof child === 'string') {
      secrets.add(child)
    } else if (typeof child === 'object') {
      captureSecrets(child)
    }
  }
}

test.beforeEach(async ({ context }) => {
  secrets.clear()
  context.on('response', response => {
    if (!response.url().includes('/api/backoffice/auth/')) {
      return
    }
    const capture = response.json().then(captureSecrets).catch(() => undefined)
    pendingResponses.add(capture)
    void capture.finally(() => pendingResponses.delete(capture))
  })
})
test.afterEach(async ({ page, browser, context }, info) => {
  try {
    await Promise.allSettled([...pendingResponses])
    await rememberSession(page)
    for (const cookie of await context.cookies()) {
      secrets.add(cookie.value)
    }
    expect(fixture('privacy', { secrets: [...secrets] }).pass === true).toBe(true)
    // Digests, case dispositions and source locations are the only retained data.
    writeFileSync(info.outputPath('secret-digests.json'), JSON.stringify([...secrets].map(value => ({ bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') }))))
  } finally {
    for (const error of info.errors) {
      const position = error.stack?.match(/google-account-live\.spec\.ts:(\d+):(\d+)/)
      if (position) {
        info.annotations.push({ type: 'private-failure-location', description: `google-account-live.spec.ts:${position[1]}:${position[2]}` })
      }
      error.message = 'Google browser assertion failed; private diagnostics withheld.'
      error.stack = ''
      error.errorContext = undefined
      error.value = undefined
    }
    for (const browserContext of browser.contexts()) {
      for (const browserPage of browserContext.pages()) {
        await browserPage.evaluate(() => {
          document.documentElement.replaceChildren()
          history.replaceState(null, '', '/')
        }).catch(() => undefined)
      }
    }
    secrets.clear()
  }
})

test(cases.trusted, async ({ page }) => {
  const email = address()
  await provider(page, email, 'trusted')
  await enter(page, '/signup')
  const before = fixture('snapshot', { email })
  expect(before.users === 0 && before.clients === 0).toBe(true)
  await finish(page)
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  const after = fixture('snapshot', { email })
  expect(after.users === 1 && after.clients === 1 && after.passwordMethods === 0 && after.externalIdentities === 1).toBe(true)
  expect(after.products === 0 && after.wallets === 0 && after.subscriptions === 0 && after.platformGrants === 0).toBe(true)
  await rememberSession(page)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await enter(page, '/login')
  await finish(page)
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(fixture('snapshot', { email }).clientId === after.clientId).toBe(true)
})

test(cases.mailbox, async ({ page, context }) => {
  const email = address()
  await provider(page, email, 'mailbox')
  await enter(page, '/signup')
  await finish(page)
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const before = fixture('snapshot', { email })
  expect(before.users === 0 && before.clients === 0 && before.pending === 1).toBe(true)
  expect(await page.getByLabel('Correct email address').count()).toBe(0)
  const proof = fixture('mail', { email, kind: 'verify', excluded: [] }).proof as string
  secrets.add(proof)
  const lost = await context.newPage()
  await provider(lost, email, 'mailbox')
  await lost.goto('/verify-email#proof=' + proof)
  await lost.getByRole('button', { name: 'Check sign-in method' }).click()
  expect(await lost.getByLabel('Original signup password').count()).toBe(0)
  await lost.getByRole('button', { name: 'Verify and continue with Google', exact: true }).click()
  await expect(lost).toHaveURL('http://127.0.0.1:5173/account/google/complete')
  await finish(lost)
  await expect(lost.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  await rememberSession(lost)
  const after = fixture('snapshot', { email })
  expect(after.users === 1 && after.passwordMethods === 0 && after.externalIdentities === 1).toBe(true)
})

test(cases.denial, async ({ page, context }) => {
  const email = address()
  await provider(page, email, 'bad-signature')
  await enter(page, '/signup')
  const foreign = await context.browser()!.newContext()
  const other = await foreign.newPage()
  await other.goto('http://127.0.0.1:5173/account/google/complete')
  await finish(other)
  expect(fixture('snapshot', { email }).users === 0).toBe(true)
  await foreign.close()
  await finish(page)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(fixture('snapshot', { email }).users === 0).toBe(true)
})

test(cases.cancel, async ({ page }) => {
  const email = address()
  await provider(page, email, 'cancel')
  await enter(page, '/signup')
  await finish(page)
  await expect(page.getByText(/cancelled/i)).toBeVisible()
  await page.reload()
  await finish(page)
  expect(fixture('snapshot', { email }).users === 0).toBe(true)
})

test(cases.link, async ({ page }) => {
  const email = address()
  const password = 'Isolated Google browser local account password phrase'
  secrets.add(password)
  await page.goto('/signup')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const proof = fixture('mail', { email, kind: 'verify', excluded: [] }).proof as string
  secrets.add(proof)
  await page.goto('/verify-email#proof=' + proof)
  await page.getByRole('button', { name: 'Check sign-in method' }).click()
  await page.getByLabel('Original signup password').fill(password)
  await page.getByRole('button', { name: 'Verify email', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  const before = fixture('snapshot', { email })
  await rememberSession(page)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await provider(page, email, 'trusted')
  await enter(page, '/login')
  await finish(page)
  await page.getByRole('link', { name: 'Sign in to the existing account', exact: true }).click()
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm Google linking' })).toBeVisible()
  await rememberSession(page)
  await page.getByLabel('Existing account password').fill(password)
  await page.getByRole('button', { name: 'Verify existing account', exact: true }).click()
  expect(fixture('snapshot', { email }).externalIdentities === 0).toBe(true)
  await page.getByRole('button', { name: 'Confirm and link Google', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Google account linked' })).toBeVisible()
  const after = fixture('snapshot', { email })
  expect(after.clientId === before.clientId && after.users === 1 && after.clients === 1 && after.passwordMethods === 1 && after.externalIdentities === 1).toBe(true)
})

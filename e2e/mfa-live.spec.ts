import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { completeChallenge, installChallengeProvider } from './accountAbuseProvider'

const cases = JSON.parse(readFileSync(new URL('./fixtures/mfa-cases.json', import.meta.url), 'utf8')) as Record<string, string>
const secrets = new Set<string>()
const captures = new Set<Promise<unknown>>()

function fixture(action: string, body: unknown): Record<string, any> {
  try {
    return JSON.parse(execFileSync('python3', [process.env.ACCOUNT_JOURNEYS_BRIDGE!, process.env.ACCOUNT_JOURNEYS_CONTEXT!, action], {
      input: JSON.stringify(body), encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
    }))
  } catch {
    throw new Error('Owned MFA fixture failed; private values withheld')
  }
}

function remember(value: string): string {
  secrets.add(value)

  return value
}

function capture(value: unknown): void {
  if (typeof value === 'string') {
    remember(value)
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(capture)
  }
}

async function google(page: Page, email: string): Promise<void> {
  await page.route('https://accounts.google.com/o/oauth2/v2/auth**', async route => {
    const authorization = new URL(route.request().url())
    const state = remember(authorization.searchParams.get('state')!)
    remember(authorization.searchParams.get('nonce')!)
    remember(authorization.searchParams.get('code_challenge')!)
    const code = remember(fixture('google', { authorizationUrl: authorization.href, email, scenario: 'trusted' }).code)
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><form method="post" action="http://127.0.0.1:5173/api/backoffice/auth/google/callback"><input type="hidden" name="state" value="${state}"><input type="hidden" name="code" value="${code}"></form><script>document.forms[0].submit()</script>` })
  })
}

async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(result.violations.length === 0).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test.beforeEach(async ({ context }) => {
  secrets.clear()
  expect(fixture('begin-case', {}).ready === true).toBe(true)
  await installChallengeProvider(context)
  context.on('response', response => {
    if (!response.url().includes('/api/backoffice/auth/')) {
      return
    }

    const pending = response.json().then(value => {
      // Only fields containing private material are privacy canaries. Public
      // protocol labels also occur legitimately in application logs.
      for (const key of ['accessToken', 'refreshToken', 'csrf', 'csrfToken', 'secret', 'manualKey', 'qrPngBase64', 'recoveryCodes']) {
        if (key in value) {
          capture(value[key])
        }
      }

      if (value.challenge) {
        capture(value.challenge.secret)
      }

      if (value.session) {
        capture(value.session.accessToken)
        capture(value.session.refreshToken)
      }
    }).catch(() => undefined)
    captures.add(pending)
    void pending.finally(() => captures.delete(pending))
  })
})

test.afterEach(async ({ browser, context }, info) => {
  try {
    await Promise.allSettled([...captures])

    for (const cookie of await context.cookies()) {
      remember(cookie.value)
    }

    expect(fixture('privacy', { secrets: [...secrets] }).pass === true).toBe(true)
  } finally {
    for (const failure of info.errors) {
      const position = failure.stack?.match(/mfa-live\.spec\.ts:(\d+):(\d+)/)

      if (position) {
        info.annotations.push({ type: 'private-failure-location', description: `mfa-live.spec.ts:${position[1]}:${position[2]}` })
      }

      failure.message = 'MFA browser assertion failed; private diagnostics withheld.'
      failure.stack = ''
      failure.errorContext = undefined
      failure.value = undefined
    }

    for (const ownedContext of browser.contexts()) {
      for (const page of ownedContext.pages()) {
        await page.evaluate(() => document.documentElement.replaceChildren()).catch(() => undefined)
      }
    }

    secrets.clear()
  }
})

for (const palette of ['light', 'dark']) {
  test(cases[palette], async ({ page, context }) => {
    const email = remember(`story164-${randomUUID()}@example.test`)
    await page.emulateMedia({ colorScheme: palette === 'dark' ? 'dark' : 'light' })
    await google(page, email)
    await page.goto('/signup')
    await completeChallenge(page)
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await page.getByRole('button', { name: 'Finish sign-in', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
    await page.goto('/account/security')
    await expect(page.getByText('No authenticator is enrolled.')).toBeVisible()
    expect(await page.getByLabel(/password/i).count()).toBe(0)
    await page.getByRole('button', { name: 'Confirm this identity with Google' }).click()
    await page.getByRole('button', { name: 'Finish identity confirmation' }).click()
    await page.getByRole('button', { name: 'Create authenticator setup' }).click()
    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', palette)
    await expect(page.getByRole('img', { name: /Authenticator setup QR image/ })).toBeVisible()
    const manualKey = remember((await page.locator('dd.select-all').textContent())!)
    expect(/^[A-Z2-7]{32}$/.test(manualKey)).toBe(true)
    expect(await page.evaluate(value => !JSON.stringify([localStorage, sessionStorage, history.state]).includes(value), manualKey)).toBe(true)
    await accessible(page)
    const setupCode = remember(fixture('mfa-code', { manualKey, offset: 0 }).code)
    await page.getByLabel('Authenticator code').focus()
    await page.keyboard.insertText(setupCode)
    await page.getByRole('button', { name: 'Confirm authenticator', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible()
    const codes = await page.getByRole('list', { name: 'Recovery codes' }).locator('li').allTextContents()
    codes.forEach(remember)
    expect(codes.length === 10).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    await expect(page.getByRole('button', { name: 'Continue to fresh sign-in' })).toBeDisabled()
    await page.getByRole('checkbox', { name: 'I saved these codes privately.' }).check()
    expect(fixture('snapshot', { email }).platformGrants === 0).toBe(true)
    expect(fixture('health-grant', { email }).changed === true).toBe(true)
    await page.getByRole('button', { name: 'Continue to fresh sign-in' }).click()
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await page.getByRole('button', { name: 'Finish sign-in', exact: true }).click()
    await expect(page.getByLabel('Authenticator code')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    await accessible(page)
    await page.getByLabel('Authenticator code').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Verify code', exact: true })).toBeFocused()
    await page.getByLabel('Authenticator code').fill(setupCode)
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
    await expect(page.getByRole('alert')).toBeFocused()
    const loginCode = remember(fixture('mfa-code', { manualKey, offset: 1 }).code)
    await page.getByLabel('Authenticator code').fill(loginCode)
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.goto('/platform/health')
    await expect(page.getByText('Backoffice API process', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Overall readiness — API control plane' })).toBeVisible()
    await accessible(page)
    const healthResponse = page.waitForResponse(response => response.url().endsWith('/api/backoffice/health'))
    await page.getByRole('button', { name: 'Refresh health', exact: true }).click()
    expect((await healthResponse).status() === 200).toBe(true)
    await expect(page.getByText('Backoffice API process', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'My workspace', exact: true }).click()
    await expect(page.getByText('Backoffice API process', { exact: true })).toHaveCount(0)
    await page.goBack()
    await expect(page.getByText('Backoffice API process', { exact: true })).toBeVisible()
    await page.goto('/account/security')
    const challengeResponse = page.waitForResponse(response => response.url().endsWith('/auth/mfa/challenge/start'))
    await page.getByRole('button', { name: 'Verify authenticator for privileged access' }).click()
    const cancelledChallenge = await (await challengeResponse).json()
    remember(cancelledChallenge.challenge.secret)
    remember(cancelledChallenge.csrfToken)
    await expect(page.getByRole('heading', { name: 'Verify authenticator', exact: true })).toBeVisible()
    const cancellationResponse = page.waitForResponse(response => response.url().endsWith('/auth/mfa/challenge/cancel'))
    await page.getByRole('button', { name: 'Cancel verification', exact: true }).click()
    expect((await cancellationResponse).status() === 200).toBe(true)
    await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible()
    const access = remember((await page.evaluate(() => localStorage.getItem('backoffice_access_token')))!)
    const headers = { Authorization: `Bearer ${access}`, Origin: new URL(page.url()).origin, 'X-MFA-CSRF': cancelledChallenge.csrfToken }
    const cancellationBody = { challengeId: cancelledChallenge.challenge.id, challengeSecret: cancelledChallenge.challenge.secret, purpose: 'step_up' }
    const replay = await page.request.post('/api/backoffice/auth/mfa/challenge/verify', { headers, data: { ...cancellationBody, code: loginCode } })
    expect(replay.status() === 400).toBe(true)
    const wrongMethod = await page.request.get('/api/backoffice/auth/mfa/challenge/cancel', { headers })
    expect(wrongMethod.status() === 405).toBe(true)
    const extendedPath = await page.request.post('/api/backoffice/auth/mfa/challenge/cancel/extra', { headers, data: cancellationBody })
    expect(extendedPath.status() === 400).toBe(true)
    const queryProof = await page.request.post('/api/backoffice/auth/mfa/challenge/cancel?unexpected=1', { headers, data: cancellationBody })
    expect(queryProof.status() === 400).toBe(true)
    const other = await context.newPage()
    await other.goto('/account/security')
    await expect(other.getByText('Authenticator enabled.')).toBeVisible()
    await page.goto('/account/security')
    await page.getByRole('button', { name: 'Sign out for lost-factor recovery' }).click()
    await expect(other.getByRole('heading', { name: 'Verify your current session' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await page.getByRole('button', { name: 'Finish sign-in', exact: true }).click()
    await page.getByRole('link', { name: 'Use a recovery code or approved recovery ticket' }).click()
    await page.getByLabel('Recovery code', { exact: true }).fill(codes[0])
    await page.getByRole('button', { name: 'Verify recovery proof', exact: true }).click()
    await expect(page.getByText(/Recovery proof accepted/)).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
    await page.getByRole('button', { name: 'Create replacement setup' }).click()
    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel enrollment', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/account/mfa/enroll')
    await expect(page.getByText(/This setup is no longer available/)).toBeVisible()
    expect(fixture('health-revoke', { email }).changed === true).toBe(true)
    await page.goto('/platform/health')
    await expect(page.getByText('Backoffice API process', { exact: true })).toHaveCount(0)
    expect(await page.locator('script[src^="/src/"]').count()).toBe(0)
  })
}

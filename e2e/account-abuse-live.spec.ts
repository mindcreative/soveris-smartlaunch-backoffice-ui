import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { CHALLENGE_ORIGIN, completeChallenge, installChallengeProvider } from './accountAbuseProvider'

const cases: Record<string, string> = JSON.parse(readFileSync(new URL('./fixtures/account-abuse-cases.json', import.meta.url), 'utf8')).browserCases
const prefix = '/api/backoffice/auth'
const secrets = new Set<string>()
const responses = new Set<Promise<void>>()
const consoleMessages: string[] = []
const consoleControl = 'account-abuse-browser-capture-control'

function fixture(action: string, body: unknown): Record<string, unknown> {
  try {
    return JSON.parse(execFileSync('python3', [process.env.ACCOUNT_JOURNEYS_BRIDGE!, process.env.ACCOUNT_JOURNEYS_CONTEXT!, action],
      { input: JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }))
  } catch {
    throw new Error('Owned abuse fixture failed; private diagnostics withheld')
  }
}

function capture(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (['contextId', 'nonce', 'csrf', 'pendingToken', 'accessToken', 'refreshToken'].includes(key) && typeof child === 'string') {
      secrets.add(child)

      if (key === 'nonce') {
        secrets.add('fixture.' + child)
      }
    } else {
      capture(child)
    }
  }
}

test.beforeEach(async ({ context, page }) => {
  expect(fixture('begin-case', {}).ready).toBe(true)
  secrets.clear()
  consoleMessages.length = 0
  context.on('console', message => consoleMessages.push(message.text()))
  await page.evaluate(marker => console.info(marker), consoleControl)
  await installChallengeProvider(context)
  context.on('response', response => {
    if (response.url().includes(prefix)) {
      const operation = response.json().then(capture).catch(() => undefined)
      responses.add(operation)
      void operation.finally(() => responses.delete(operation))
    }
  })
})

test.afterEach(async ({ context, browser }, info) => {
  try {
    await Promise.allSettled([...responses])

    for (const cookie of await context.cookies()) {
      secrets.add(cookie.value)
    }

    writeFileSync(info.outputPath('browser-secret-digests.json'), JSON.stringify([...secrets].map(value => ({
      bytes: Buffer.byteLength(value, 'utf8'), sha256: createHash('sha256').update(value).digest('hex'),
    }))))
    const producerControl = consoleMessages.includes(consoleControl)
    const privateMatches = consoleMessages.some(message => [...secrets].some(secret => secret.length > 0 && message.includes(secret)))
    writeFileSync(info.outputPath('browser-console-privacy.json'), JSON.stringify({
      capturedMessages: consoleMessages.length, producerControl, privateMatches,
      limitation: 'Test-owned browser console control; raw console content is never retained.',
    }))
    expect(producerControl && !privateMatches).toBe(true)
    expect(fixture('privacy', { secrets: [...secrets] }).pass === true).toBe(true)
  } finally {
    for (const error of info.errors) {
      const position = error.stack?.match(/account-abuse-live\.spec\.ts:(\d+):(\d+)/)
      if (position) {
        info.annotations.push({ type: 'private-failure-location', description: `account-abuse-live.spec.ts:${position[1]}:${position[2]}` })
      }

      error.message = 'Account abuse assertion failed; private diagnostics withheld.'
      error.stack = ''
      error.errorContext = undefined
      error.value = undefined
    }

    for (const owned of browser.contexts()) {
      for (const page of owned.pages()) {
        await page.evaluate(() => {
          document.documentElement.replaceChildren()
          history.replaceState(null, '', '/')
        }).catch(() => undefined)
      }
    }
  }
})

test(cases.isolation, async ({ page, context }) => {
  const providerFrames: string[] = []
  context.on('request', request => {
    if (request.url().startsWith('https://challenges.cloudflare.com/')) {
      providerFrames.push(new URL(request.frame().url()).origin)
    }
  })
  const response = await page.goto('/signup')
  expect(response!.headers()['content-security-policy'].includes('frame-src ' + CHALLENGE_ORIGIN)).toBe(true)
  await completeChallenge(page)
  expect(providerFrames.length > 0 && providerFrames.every(origin => origin === CHALLENGE_ORIGIN)).toBe(true)
  const frame = page.locator('iframe[data-account-challenge]')
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  const cookie = (await context.cookies()).find(item => item.name.includes('admission'))
  expect(!!cookie && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.domain === '127.0.0.1' && cookie.path === prefix + '/').toBe(true)
  expect((await context.cookies(CHALLENGE_ORIGIN)).length).toBe(0)
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))
  expect([...secrets, cookie!.value].every(secret => !storage.includes(secret))).toBe(true)
  expect(await page.evaluate(() => !localStorage.getItem('backoffice_access_token') && !localStorage.getItem('backoffice_refresh_token'))).toBe(true)
})

test(cases.messages, async ({ page }) => {
  const contextResponse = page.waitForResponse(response => response.url().endsWith(prefix + '/admission/context'))
  await page.goto('/signup')
  const bound = await (await contextResponse).json()
  await page.frameLocator('iframe[data-account-challenge]').getByRole('button', { name: 'Complete test security check' }).waitFor()
  await page.evaluate(({ nonce, origin }) => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-account-challenge]')!
    const data = { type: 'account-challenge:success', nonce, token: 'foreign-token' }
    window.postMessage(data, location.origin)
    for (const event of [
      { origin: 'http://foreign.test', source: frame.contentWindow, data },
      { origin, source: window, data },
      { origin, source: frame.contentWindow, data: { ...data, nonce: 'old' } },
      { origin, source: frame.contentWindow, data: { ...data, extra: true } },
    ]) window.dispatchEvent(new MessageEvent('message', event))
  }, { nonce: bound.nonce, origin: CHALLENGE_ORIGIN })
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled()
  await completeChallenge(page)
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled()
})

test(cases.retry, async ({ page, context }) => {
  await context.route('https://challenges.cloudflare.com/**', route => route.abort())
  await page.goto('/signup')
  const email = `story164-${randomUUID()}@example.test`; const password = 'Story166 retry private phrase'
  secrets.add(email); secrets.add(password)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  const retry = page.getByRole('button', { name: 'Retry security check' })
  await expect(retry).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled()
  await context.unroute('https://challenges.cloudflare.com/**')
  await retry.focus(); await page.keyboard.press('Enter')
  await completeChallenge(page)
  expect(await page.getByLabel('Email address').inputValue() === email).toBe(true)
  expect(await page.getByLabel('Password', { exact: true }).inputValue() === password).toBe(true)
})

test(cases.denial, async ({ page }) => {
  const email = `story164-${randomUUID()}@example.test`; const password = 'Story166 denial private phrase'
  secrets.add(email); secrets.add(password)
  const before = fixture('snapshot', { email })
  let attempts = 0
  await page.route('**' + prefix + '/register', route => { attempts++; return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '60' }, body: '{"code":"account_temporarily_unavailable"}' }) })
  await page.goto('/signup')
  await page.getByLabel('Email address').fill(email); await page.getByLabel('Password', { exact: true }).fill(password)
  await completeChallenge(page)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  expect(await page.getByLabel('Email address').inputValue() === email).toBe(true)
  expect(await page.getByLabel('Password', { exact: true }).inputValue() === password).toBe(true)
  await page.getByRole('button', { name: 'Retry security check' }).click()
  await completeChallenge(page)
  expect(attempts).toBe(1)
  expect(JSON.stringify(fixture('snapshot', { email })) === JSON.stringify(before)).toBe(true)

  // Freeze before releasing either denial so awaited browser assertions cannot
  // consume the final second of the measured retry window.
  const clockTime = Date.now()
  await page.clock.install({ time: clockTime - 60_000 })
  await page.clock.pauseAt(clockTime)

  for (const denial of [
    { status: 429, code: 'account_rate_limited', seconds: 600, message: 'Too many attempts. Please wait and try again.' },
    { status: 503, code: 'account_temporarily_unavailable', seconds: 60, message: 'Account services are temporarily unavailable. Please try again shortly.' },
  ]) {
    let contextAttempts = 0
    let releaseDenial: () => void = () => {}
    const denialReady = new Promise<void>(resolve => { releaseDenial = resolve })
    const contextPath = '**' + prefix + '/admission/context'
    await page.route(contextPath, async route => {
      contextAttempts++

      if (contextAttempts === 1) {
        await denialReady
        await route.fulfill({ status: denial.status, contentType: 'application/json',
          headers: { 'Retry-After': String(denial.seconds) }, body: JSON.stringify({ code: denial.code }) })
      } else {
        await route.continue()
      }
    })

    await page.goto('/signup')
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    // Leave useful field focus before failure to exercise keyboard recovery
    // while the retry button is intentionally disabled.
    await page.getByLabel('Password', { exact: true }).blur()
    releaseDenial()
    const guidance = page.getByRole('status')
    const retry = page.getByRole('button', { name: 'Retry security check' })
    await expect(guidance).toHaveText(denial.message)
    await expect(guidance).toBeFocused()
    await expect(retry).toBeDisabled()
    await expect(page.getByText(`Retry available in ${denial.seconds} seconds.`)).toHaveAttribute('aria-live', 'off')
    await page.keyboard.press('Enter')
    await page.clock.fastForward((denial.seconds - 1) * 1000)
    await expect(retry).toBeDisabled()
    expect(contextAttempts).toBe(1)
    await expect(guidance).toHaveText(denial.message)
    await page.clock.fastForward(1000)
    await expect(retry).toBeEnabled()
    expect(contextAttempts).toBe(1)
    await retry.focus()
    await page.keyboard.press('Enter')
    await completeChallenge(page)
    expect(contextAttempts).toBe(2)
    expect(await page.getByLabel('Email address').inputValue() === email).toBe(true)
    expect(await page.getByLabel('Password', { exact: true }).inputValue() === password).toBe(true)
    expect(attempts).toBe(1)
    expect(JSON.stringify(fixture('snapshot', { email })) === JSON.stringify(before)).toBe(true)
    await page.unroute(contextPath)
  }
})

test(cases.documents, async ({ page }) => {
  await page.goto('/signup'); await completeChallenge(page)
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__documentMarker = 'same' })
  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__documentMarker)).toBe('same')
  expect(await page.locator('#account-document-frame-policy').getAttribute('content')).toBe("frame-src 'none'")
  expect(await page.locator('iframe').count()).toBe(0)
  await page.getByRole('link', { name: 'Create account', exact: true }).click()
  await completeChallenge(page)
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__documentMarker === undefined)).toBe(true)
  for (const path of ['/Signup', '/signup/']) {
    await page.goto(path); await expect(page).toHaveURL('http://127.0.0.1:5173/signup'); await completeChallenge(page)
  }
})

test(cases.history, async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Create account', exact: true }).click(); await completeChallenge(page)
  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
  await page.goBack(); await completeChallenge(page)
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
  expect(await page.locator('iframe').count()).toBe(0)
  // Exercise the supported restoration handler as well as native history.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  expect(await page.locator('#account-document-frame-policy').getAttribute('content')).toBe("frame-src 'none'")
})

test(cases.mobile, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/signup')
  const child = page.frameLocator('iframe[data-account-challenge]')
  const button = child.getByRole('button', { name: 'Complete test security check' })
  await button.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations.length).toBe(0)
})

test(cases.proxy, async ({ request }) => {
  for (const path of [prefix + '/register?alias=1', prefix + '/register/suffix', prefix + '/%72egister', prefix + '/admission/context?alias=1']) {
    const response = await request.post(path, { data: {}, maxRedirects: 0 })
    expect(response.status()).toBe(400)
    expect(response.headers()['content-type'].startsWith('application/json')).toBe(true)
  }
  expect((await request.get(prefix + '/register')).status()).toBe(405)
  const oversized = await request.post(prefix + '/register', { data: 'x'.repeat(16385), headers: { 'Content-Type': 'application/json' } })
  expect(oversized.status()).toBe(400)
  expect(oversized.headers()['content-type'].startsWith('application/json')).toBe(true)
})

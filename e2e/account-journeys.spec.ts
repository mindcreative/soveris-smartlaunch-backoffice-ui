import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { currentAuthorityFixture } from '../src/test/authorityFixtures'
import { fulfillLocal, installTimeZoneRoute } from './localPresentationMocks'
import { readFileSync } from 'node:fs'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const proof = 'A'.repeat(43)

test('built account starts under its enforced CSP while dynamic evaluation stays blocked', async ({ page }) => {
  const template = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')
  const policy = template.match(/add_header Content-Security-Policy "([^"]+)" always;/)![1]
    .replace('__ACCOUNT_API_CONNECT_ORIGIN__', '')
  await page.route('**/signup', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'Content-Security-Policy': policy } })
  })
  await page.goto('/signup')
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible()
  await page.route('**/fixtures/csp-probe.js', route => route.fulfill({ contentType: 'application/javascript',
    body: "try { Function('return true')(); document.documentElement.dataset.cspEvalBlocked = 'false' } catch { document.documentElement.dataset.cspEvalBlocked = 'true' }" }))
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.src = '/fixtures/csp-probe.js'
    document.head.append(script)
  })
  await expect(page.locator('html')).toHaveAttribute('data-csp-eval-blocked', 'true')
})

test('proof is scrubbed before optional requests and never posts on open, reload, back or prefetch', async ({ page }) => {
  const posts: string[] = []
  const referrers: string[] = []
  await page.route('**/api/backoffice/**', route => {
    posts.push(route.request().method())

    if (route.request().url().endsWith('/registration/proof-context')) {
      return route.fulfill({ json: { authMethod: 'email_password', expiresIn: 300, completed: false } })
    }

    return route.fulfill({ status: 400, json: { code: 'invalid_or_expired_proof' } })
  })
  page.on('request', request => { referrers.push(request.headers().referer ?? '') })
  await page.goto('/verify-email#proof=' + proof)
  await expect(page).toHaveURL(/\/verify-email$/)
  await expect(page.getByRole('button', { name: 'Check sign-in method' })).toBeVisible()
  expect(posts).toEqual([])
  expect(referrers.every(value => !value.includes(proof))).toBe(true)
  expect(await page.evaluate(() => JSON.stringify([history.state, localStorage, sessionStorage]).includes('A'.repeat(43)))).toBe(false)
  await page.reload()
  await expect(page.getByText(/reopen the newest applicable email link/i)).toBeVisible()
  await page.goto('/verify-email#proof=' + proof)
  await expect(page).toHaveURL(/\/verify-email$/)
  await page.getByRole('button', { name: 'Check sign-in method' }).click()
  await expect(page.getByLabel('Original signup password')).toBeVisible()
  await page.getByLabel('Original signup password').fill('discard on the next link')
  await page.goto('/verify-email#proof=' + proof + '&proof=' + proof)
  await expect(page).toHaveURL(/\/verify-email$/)
  await expect(page.getByLabel('Original signup password')).toHaveCount(0)
  expect(await page.evaluate(() => !JSON.stringify([history.state, localStorage, sessionStorage]).includes('A'.repeat(43)))).toBe(true)
  await page.getByRole('link', { name: 'Log in', exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(/\/verify-email$/)
  expect(posts).toEqual(['POST'])
})

test('each public account screen follows System, reflows and passes axe without secret artifacts', async ({ page }, info) => {
  const palette = info.project.name === 'dark' ? 'dark' : 'light'
  const pages = [
    ['/signup', 'Create account'], ['/login', 'Log in'], ['/check-email', 'Check your email'],
    ['/verify-email#proof=' + proof, 'Verify your email'], ['/forgot-password', 'Forgot password?'],
    ['/reset-password#proof=' + proof, 'Reset your password'],
    ['/account/google/complete', 'Finish Google sign-in'],
  ]

  for (const [path, title] of pages) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page).toHaveTitle(`${title} · SmartLaunch · Soveris`)
    await expect(page.locator('html')).toHaveAttribute('data-theme', palette)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])

    for (const viewport of [{ width: 320, height: 780 }, { width: 780, height: 320 }]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByRole('link', { name: 'Log in', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeInViewport()
    }

    await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1280, height: 720 })
  }
})

test('signup validates focus, preserves pasted inputs through theme changes and sends a single anonymous request', async ({ page }, info) => {
  let registrations = 0
  await page.route('**/api/backoffice/auth/register', async route => {
    registrations++
    expect(route.request().headers().authorization === undefined).toBe(true)
    const request = route.request().postDataJSON()
    expect(Object.keys(request).sort()).toEqual(['email', 'password', 'returnIntent'])

    await route.fulfill({ status: 202, json: { status: 'check_email', pendingToken: proof, expiresIn: 86400 } })
  })
  await page.goto('/signup')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByLabel('Email address')).toBeFocused()
  await page.getByLabel('Email address').fill('fixture@example.test')
  await page.getByLabel('Password', { exact: true }).fill(' a synthetic password ')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ colorScheme: info.project.name === 'light' ? 'dark' : 'light' })
  expect(await page.getByLabel('Password', { exact: true }).inputValue().then(value => value === ' a synthetic password ')).toBe(true)
  await page.getByRole('button', { name: 'Create account', exact: true }).dblclick()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused()
  expect(registrations).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
  await page.reload()
  await expect(page.getByText(/reload cannot recover/i)).toBeVisible()
})

test('fresh activation authorization opens the existing creation modal once with zero product mutations', async ({ page }) => {
  let productMutations = 0
  let currentLookups = 0
  const authority = currentAuthorityFixture({ permissions: ['products:view', 'products:create'] })
  await installTimeZoneRoute(page)
  await page.route('**/api/backoffice/auth/registration/proof-context', route => route.fulfill({ json: { authMethod: 'email_password', expiresIn: 300, completed: false } }))
  await page.route('**/api/backoffice/auth/registration/verify', route => route.fulfill({ json: {
    status: 'activated', nextAction: 'create_first_product', session: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600, user: authority },
  } }))
  await page.route('**/api/backoffice/auth/current', route => {
    currentLookups++

    return route.fulfill({ json: authority })
  })
  await page.route('**/api/backoffice/clients/*/products**', route => {
    if (route.request().method() !== 'GET') {
      productMutations++
    }

    return fulfillLocal(route, { json: { items: [], page: 1, totalPages: 1, totalCount: 0, pageSize: 20 } })
  })
  await page.goto('/verify-email#proof=' + proof)
  await page.getByRole('button', { name: 'Check sign-in method' }).click()
  await page.getByLabel('Original signup password').fill('original')
  await page.getByRole('button', { name: 'Verify email', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('dialog', { name: 'Create your first product' })).toBeVisible()
  await expect(page.getByLabel('Product name', { exact: true })).toBeFocused()
  expect(currentLookups).toBeGreaterThan(0)
  expect(productMutations).toBe(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(productMutations).toBe(0)
})

test('reset and completed activation replay never grant session authority', async ({ page }) => {
  let resets = 0
  await page.route('**/api/backoffice/auth/password/reset', route => {
    resets++

    return route.fulfill({ json: { status: 'password_reset', loginRequired: true } })
  })
  await page.goto('/reset-password#proof=' + proof)
  expect(resets).toBe(0)
  await page.getByLabel('New password').fill(' a new synthetic password ')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Password reset', exact: true })).toBeFocused()
  expect(resets).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
  await page.route('**/api/backoffice/auth/registration/verify', route => route.fulfill({ json: { status: 'activation_complete', loginRequired: true } }))
  await page.route('**/api/backoffice/auth/registration/proof-context', route => route.fulfill({ json: { authMethod: 'email_password', expiresIn: 300, completed: false } }))
  await page.goto('/verify-email#proof=' + proof)
  await page.getByRole('button', { name: 'Check sign-in method' }).click()
  await page.getByLabel('Original signup password').fill('original')
  await page.getByRole('button', { name: 'Verify email', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Activation complete' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token') === null)).toBe(true)
})

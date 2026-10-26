import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const cases: Record<string, string> = JSON.parse(readFileSync(new URL('./fixtures/account-journeys-cases.json', import.meta.url), 'utf8'))
const origin = 'http://127.0.0.1:5173'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test(cases.marketing, async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-soveris-ingress-client-address': '127.0.0.1' })
  const marketing = 'http://127.0.0.1:5188'
  const analytics: string[] = []
  page.on('request', request => {
    if (/\/api\/bff\/(events|session|session_update)/.test(request.url())) {
      analytics.push('product-analytics')
    }
  })

  for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport)

    for (const entry of ['signup', 'login']) {
      await page.goto(marketing + '/account/' + entry + '?return=https://untrusted.invalid')
      await expect(page.getByRole('link', { name: 'Get started free' })).toHaveAttribute('href', origin + '/signup')
      await expect(page.getByRole('link', { name: 'Log in', exact: true })).toHaveAttribute('href', origin + '/login')
      expect((await page.context().cookies()).some(cookie => cookie.name === 'session_id')).toBe(false)
    }
  }

  expect(analytics).toEqual([])
  const denied = await page.request.get(marketing + '/account/signup', { headers: { host: 'customer.example.test', 'x-forwarded-host': '127.0.0.1:5188' } })
  expect(denied.status()).toBe(404)

  for (const path of ['/', '/account', '/signup']) {
    await page.goto(marketing + path)
    await expect(page.getByRole('heading', { name: 'Soveris Origin', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Get started free' })).toHaveCount(0)
    const primary = page.getByRole('link', { name: 'Join the Origin waitlist', exact: true })
    // At the mobile breakpoint the Header copy is in the closed disclosure.
    const toggle = page.getByRole('button', { name: 'Open navigation', exact: true })

    if (await toggle.isVisible()) {
      await toggle.click()
    }

    await expect(primary).toHaveCount(2)

    for (const link of await primary.all()) {
      await expect(link).toHaveAttribute('href', '/signup')
    }

    await expect(page.locator('.product-header').getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
  }

  let visitorRequest = false
  await page.route('**/api/bff/submit_pending', route => {
    const body = route.request().postDataJSON()
    visitorRequest = body.product_slug === 'account' && route.request().method() === 'POST'

    return route.fulfill({ status: 400, json: { error: 'invalid_token' } })
  })
  await page.goto(marketing + '/account/verify-submission?token=nonsecret-visitor-route-fixture')
  await expect(page.getByRole('heading', { name: 'Verification Link Invalid', exact: true })).toBeVisible()
  expect(visitorRequest).toBe(true)
})

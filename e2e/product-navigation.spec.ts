import { test, expect, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

const manifests: Record<string, Record<string, string>> = JSON.parse(readFileSync(new URL('./fixtures/product-navigation-cases.json', import.meta.url), 'utf8'))
const stage = process.env.PRODUCT_NAVIGATION_STAGE ?? ''
const cases = manifests[stage]
const localDevelopment = stage === 'local-development'
const marketingOrigin = localDevelopment ? 'http://localhost:3000' : 'http://127.0.0.1:5188'
const customerOrigin = localDevelopment ? 'http://127.0.0.1:3000' : 'http://localhost:5188'
const boundOrigin = localDevelopment ? 'http://product.localhost:3000' : 'http://product.localhost:5188'
const accountOrigin = localDevelopment ? 'http://localhost:5173' : 'http://127.0.0.1:5173'
const unavailableText = 'Account access is temporarily unavailable'
const desktop = { width: 1280, height: 900 }
const mobile = { width: 320, height: 780 }
const spacingStyle = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }'

if (!cases) {
  throw new Error('Product navigation requires an explicit supported stage')
}

test.use({ trace: 'off', screenshot: 'off', video: 'off', colorScheme: 'light' })

test.beforeEach(async ({ page }) => {
  if (localDevelopment) {
    // Chromium maps these public hosts to the owned listener, including development HMR.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())

      if (![marketingOrigin, customerOrigin, boundOrigin].includes(url.origin)) {
        await route.abort('blockedbyclient')

        return
      }

      await route.continue()
    })
  }

  // Register only the declared technical document URLs ahead of the local fallback.
  await page.route('https://docs.example.test/**', async route => {
    const url = new URL(route.request().url())
    const allowed = url.pathname === '/terms' && url.search === '' ||
      url.pathname === '/privacy' && ['', '?version=2'].includes(url.search)

    if (!allowed) {
      await route.abort('blockedbyclient')

      return
    }

    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Technical document fixture</title><h1>Technical document fixture</h1><p>Test content only; no approved legal text.</p></html>' })
  })

  await page.setExtraHTTPHeaders({ 'x-soveris-ingress-client-address': '127.0.0.1' })
  await page.setViewportSize(desktop)
})

test.afterEach(async ({}, info) => {
  for (const error of info.errors) {
    const position = /product-navigation\.spec\.ts:(\d+):(\d+)/.exec(error.stack ?? '')

    if (position) {
      info.annotations.push({ type: 'private-failure-location', description: `product-navigation.spec.ts:${position[1]}:${position[2]}` })
    }
  }
})

async function visit(page: Page, path = '/', origin = marketingOrigin) {
  await page.goto(origin + path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Layout effects and event listeners must be active before using controls.
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--product-header-height'))).not.toBe('')
}

function header(page: Page): Locator {
  return page.locator('.product-header')
}

async function expectUnobscuredTarget(page: Page, target: string) {
  await expect.poll(async () => page.evaluate(id => {
    const section = document.getElementById(id)
    const stickyHeader = document.querySelector('.product-header')

    if (!section || !stickyHeader) {
      return false
    }

    const heading = section.querySelector('h1, h2')

    if (!heading) {
      return false
    }

    const bounds = heading.getBoundingClientRect()

    return bounds.top >= stickyHeader.getBoundingClientRect().bottom - 1 && bounds.top < window.innerHeight && bounds.bottom > 0
  }, target)).toBe(true)
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

async function expectTargets(page: Page, features: boolean, questions: boolean) {
  const actual = ['hero', ...(features ? ['features'] : []), ...(questions ? ['faq'] : []), 'form']

  for (const target of actual) {
    await expect(page.locator(`section#${target}`)).toHaveCount(1)
    await expect(page.locator(`section#${target}`)).toHaveAttribute('tabindex', '-1')
    await expect(page.locator(`section#${target}`)).toHaveAttribute('aria-labelledby', `product-${target}-heading`)
  }

  await expect(page.locator('#features')).toHaveCount(features ? 1 : 0)
  await expect(page.locator('#faq')).toHaveCount(questions ? 1 : 0)
  await expect(page.locator('#principles')).toHaveCount(features ? 1 : 0)
  const ids = await page.locator('[id]').evaluateAll(elements => elements.map(element => element.id))
  expect(new Set(ids).size).toBe(ids.length)
}

async function expectMinimumTargets(page: Page) {
  const controls = await page.locator('.product-header a, .product-header button, #hero a, footer a').all()

  for (const control of controls) {
    if (await control.isVisible()) {
      const bounds = await control.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
    }
  }
}

if (stage === 'valid' || localDevelopment) {
  test(cases.breakpoints, async ({ page }) => {
    await visit(page, '/#features')
    const toggle = header(page).locator('button[aria-controls="product-navigation-panel"]')
    const panel = page.locator('#product-navigation-panel')
    const sections = header(page).getByRole('navigation', { name: 'Product sections', exact: true })

    for (const width of [768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1080 })
      await expect(toggle).toBeHidden()
      await expect(panel).toBeHidden()
      await expect(sections).toBeVisible()
      await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toBeVisible()
    }

    for (const width of [767, 375, 320]) {
      await page.setViewportSize({ width, height: 780 })
      await expect(toggle).toBeVisible()
      await expect(sections).toBeHidden()
      await toggle.click()
      await expect(panel).toBeVisible()
      await expectMinimumTargets(page)
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(toggle).toBeFocused()
    }

    await toggle.click()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(toggle).toBeHidden()
    await expect(panel).toBeHidden()
    await expect(sections).toBeVisible()
  })

  test(cases.parity, async ({ page }) => {
    for (const path of ['/?campaign=story169', '/smartlaunch?campaign=story169', '/%73martlaunch?campaign=story169']) {
      await visit(page, path)
      const original = page.url()
      const primary = header(page).getByRole('link', { name: 'Get early access', exact: true })
      const heroPrimary = page.locator('#hero').getByRole('link', { name: 'Get early access', exact: true })
      await expect(primary).toHaveAttribute('href', '#form')
      await expect(heroPrimary).toHaveAttribute('href', '#form')
      await page.evaluate(() => { Object.assign(window, { navigationDocumentMarker: 'same-document' }) })
      await primary.click()
      await expect(page).toHaveURL(original + '#form')
      await expect(page.locator('#form')).toBeFocused()
      await expectUnobscuredTarget(page, 'form')
      await header(page).getByRole('link', { name: 'How it works', exact: true }).click()
      await expect(page).toHaveURL(original + '#features')
      await expect(page.locator('#features')).toBeFocused()
      await page.goBack()
      await expect(page).toHaveURL(original + '#form')
      await expectUnobscuredTarget(page, 'form')
      await page.goForward()
      await expect(page).toHaveURL(original + '#features')
      await expectUnobscuredTarget(page, 'features')
      await page.evaluate(() => window.scrollTo({ top: 0 }))
      await header(page).getByRole('link', { name: 'How it works', exact: true }).click()
      await expect(page).toHaveURL(original + '#features')
      await expect(page.locator('#features')).toBeFocused()
      await expectUnobscuredTarget(page, 'features')
      expect(await page.evaluate(() => (window as unknown as { navigationDocumentMarker: string }).navigationDocumentMarker)).toBe('same-document')

      for (const fragment of ['features', 'faq', 'form', 'principles']) {
        await visit(page, path + '#' + fragment)
        await expectUnobscuredTarget(page, fragment === 'principles' ? 'features' : fragment)
      }
    }
  })

  test(cases.partial, async ({ page }) => {
    for (const [slug, features, questions] of [
      ['smartlaunch', true, true], ['navigation-features', true, false], ['navigation-faq', false, true], ['navigation-required', false, false],
    ] as const) {
      await visit(page, '/' + slug)
      await expectTargets(page, features, questions)
      const sectionLinks = header(page).getByRole('navigation', { name: 'Product sections', exact: true }).getByRole('link')
      expect(await sectionLinks.allTextContents()).toEqual([
        ...(features ? [slug === 'smartlaunch' ? 'How it works' : 'Features'] : []), ...(questions ? ['FAQ'] : []),
      ])
      await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
      await expect(page.locator('#hero').getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
      await expect(page.locator('#hero').getByRole('link', { name: 'See how it works', exact: true })).toHaveCount(features ? 1 : 0)
    }
  })

  test(cases.malformed, async ({ page }) => {
    for (const slug of ['navigation-unknown', 'navigation-absent']) {
      await visit(page, '/' + slug)
      await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveCount(0)
      await expect(page.locator('#hero').getByRole('link')).toHaveCount(0)
      await expect(page.locator('#form input[name="email"]')).toBeEditable()
    }

    await visit(page, '/navigation-independent')
    await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '/signup')
    await expect(page.locator('#hero').getByRole('link', { name: 'See how it works', exact: true })).toHaveAttribute('href', 'https://example.test/explanation')
    await visit(page, '/navigation-qualified?campaign=qualified')
    await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
    await page.locator('#hero').getByRole('link', { name: 'See how it works', exact: true }).click()
    await expect(page).toHaveURL(marketingOrigin + '/navigation-qualified?campaign=qualified#features')
  })

  test(cases.login, async ({ page }) => {
    for (const viewport of [desktop, mobile]) {
      await page.setViewportSize(viewport)
      await visit(page)
      const login = header(page).getByRole('link', { name: 'Log in', exact: true })
      await expect(login).toHaveCount(1)
      await expect(login).toBeVisible()
      await expect(login).toHaveAttribute('href', accountOrigin + '/login')

      if (viewport === mobile) {
        await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false')
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
        await expect(login).toHaveCount(1)
        await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
      }

      if (!localDevelopment) {
        await login.click()
        await expect(page).toHaveURL(accountOrigin + '/login')
        await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
        await expect(page.locator('[data-testid="admin-shell"]')).toHaveCount(0)
        await expect(page.getByRole('link', { name: /platform|billing|dashboard/i })).toHaveCount(0)
      }
    }
  })

  test(cases.isolation, async ({ page }) => {
    await visit(page, '/origin')
    await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
    await expect(header(page).getByRole('link', { name: 'Join the Origin waitlist', exact: true })).toHaveAttribute('href', '/signup')

    for (const [origin, path, title] of [
      [customerOrigin, '/', 'Customer product: smartlaunch'], [customerOrigin, '/smartlaunch', 'Customer product: smartlaunch'],
      [boundOrigin, '/', 'Customer product: customer-product'], [boundOrigin, '/customer-product', 'Customer product: customer-product'],
    ]) {
      await page.setExtraHTTPHeaders({ 'x-soveris-ingress-client-address': '127.0.0.1', 'x-forwarded-host': new URL(marketingOrigin).host, forwarded: 'host=' + new URL(marketingOrigin).host + ';proto=http' })
      await visit(page, path + '?customer=one', origin)
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
      await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
      expect(await page.content()).not.toContain(accountOrigin + '/login')
      await header(page).getByRole('link', { name: 'Get early access', exact: true }).click()
      await expect(page).toHaveURL(origin + path + '?customer=one#form')
    }

    const denied = await page.goto(boundOrigin + '/smartlaunch')
    expect(denied?.status()).toBe(404)
  })

  test(cases.disclosure, async ({ page }) => {
    await page.setViewportSize(mobile)
    await visit(page)
    const toggle = header(page).locator('button[aria-controls="product-navigation-panel"]')
    const panel = page.locator('#product-navigation-panel')
    await expect(panel).toBeHidden()
    await expect(header(page).getByRole('link', { name: 'How it works', exact: true })).toHaveCount(0)
    await header(page).getByRole('link', { name: 'Log in', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAttribute('aria-controls', 'product-navigation-panel')
    await page.keyboard.press('Tab')
    await expect(panel.getByRole('link', { name: 'How it works', exact: true })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Space')
    await expect(panel).toBeHidden()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await panel.getByRole('link', { name: 'FAQ', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(page.locator('#faq')).toBeFocused()
    await expectUnobscuredTarget(page, 'faq')
    await toggle.click()
    await panel.getByRole('link', { name: 'Get early access', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(page.locator('#form')).toBeFocused()
    await toggle.click()
    await page.locator('#hero h1').click()
    await expect(panel).toBeHidden()
    await toggle.click()
    const email = page.locator('#form input[name="email"]')
    await email.focus()
    await expect(panel).toBeHidden()
    await expect(email).toBeFocused()
  })

  test(cases.transitions, async ({ page }) => {
    await page.setViewportSize(mobile)
    await visit(page)
    let toggle = header(page).locator('button[aria-controls="product-navigation-panel"]')
    await toggle.click()
    await page.locator('#product-navigation-panel a').first().focus()
    await page.setViewportSize(desktop)
    await expect(page.locator('#product-navigation-panel')).toBeHidden()
    await expect(header(page).getByRole('navigation', { name: 'Product sections', exact: true }).getByRole('link').first()).toBeFocused()
    await page.setViewportSize(mobile)
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    // An explicitly configured independent route preserves the real Next transition check.
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.locator('footer').getByRole('link', { name: 'Independent route', exact: true }).evaluate(link => (link as HTMLElement).click())
    await expect(page).toHaveURL(marketingOrigin + '/navigation-required')
    await expect(page.locator('#features')).toHaveCount(0)
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    toggle = header(page).locator('button[aria-controls="product-navigation-panel"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await visit(page, '/navigation-independent')
    await toggle.click()
    await page.locator('#product-navigation-panel').getByRole('link', { name: 'Get early access', exact: true }).click()
    await expect(page).toHaveURL(marketingOrigin + '/signup')
    await expect(page.getByRole('heading', { name: 'Soveris Origin', exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => {
      const focused = document.activeElement

      return focused instanceof HTMLElement && Boolean(focused.closest('[hidden]'))
    })).toBe(false)

    await page.setViewportSize(mobile)
    await visit(page, '/navigation-required')
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.keyboard.press('Tab')
    await expect(page.locator('#product-navigation-panel').getByRole('link', { name: 'Get early access', exact: true })).toBeFocused()
    await page.setViewportSize(desktop)
    await expect(page.locator('#product-navigation-panel')).toBeHidden()
    await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toBeFocused()
  })

  test(cases.footer, async ({ page }) => {
    for (const [origin, path] of [[marketingOrigin, '/'], [marketingOrigin, '/smartlaunch?campaign=footer'],
      [customerOrigin, '/smartlaunch?campaign=customer'], [boundOrigin, '/']] as const) {
      await visit(page, path, origin)
      const footer = page.getByRole('navigation', { name: 'Footer', exact: true })
      await expect(footer.getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
      await footer.getByRole('link', { name: 'Get early access', exact: true }).click()
      await expect(page).toHaveURL(origin + path + '#form')
      await expect(page.locator('#form')).toBeFocused()
      await expectUnobscuredTarget(page, 'form')
      await expect(page.locator('footer')).toContainText(`© ${new Date().getFullYear()}`)
      await expect(page.locator('footer a[href="/privacy"], footer a[href="/terms"]')).toHaveCount(0)
    }

    for (const slug of ['footer-optional', 'footer-missing']) {
      await visit(page, '/'+slug)
      await expect(page.locator('footer a, footer nav')).toHaveCount(0)
      await expect(page.locator('footer')).toContainText('All rights reserved.')
    }

    await page.route('**/api/bff/submit_pending', route => route.fulfill({ status: 400, json: { error: 'invalid_token' } }))
    await page.goto(marketingOrigin+'/smartlaunch/verify-submission?token=nonsecret-footer-fixture')
    await expect(header(page)).toBeVisible()
    await expect(page.locator('footer a[href^="#"]')).toHaveCount(0)
    await expect(page.locator('footer').getByRole('link', { name: 'Independent route', exact: true })).toHaveAttribute('href', '/navigation-required')
  })

  test(cases.footerIdentity, async ({ page }) => {
    await visit(page, '/footer-duplicates')
    const footer = page.getByRole('navigation', { name: 'Footer', exact: true })
    const longLabel = 'L'.repeat(120)
    await expect(footer.getByRole('link', { name: 'Get early access', exact: true })).toHaveCount(1)
    await expect(footer.getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')
    await expect(footer.getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute('href', '#features')
    await expect(footer.getByRole('link', { name: 'Distinct action', exact: true })).toHaveAttribute('href', '#form')
    await expect(footer.getByRole('link', { name: 'Privacy fixture', exact: true })).toHaveCount(2)
    await expect(footer.getByRole('link', { name: 'Different name', exact: true })).toHaveAttribute('href', 'https://docs.example.test/privacy')
    await expect(footer.getByRole('link', { name: longLabel, exact: true })).toHaveAttribute('href', '/long-label')
    await expect(footer.getByRole('heading', { name: 'Duplicates omitted', exact: true })).toHaveCount(0)
    expect(await footer.getByRole('heading').allTextContents()).toEqual(['Product', 'Documents'])
    await page.setViewportSize(mobile)
    await expectMinimumTargets(page)
    await expectNoOverflow(page)
    const scan = await new AxeBuilder({ page }).include('footer').analyze()
    expect(scan.violations).toEqual([])
  })

  test(cases.footerInteraction, async ({ page, context }) => {
    await visit(page, '/footer-duplicates?campaign=kept')
    const footer = page.getByRole('navigation', { name: 'Footer', exact: true })
    const features = footer.getByRole('link', { name: 'How it works', exact: true })
    await features.focus()
    await expect(features).toBeFocused()
    expect(await features.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(marketingOrigin+'/footer-duplicates?campaign=kept#features')
    await expect(page.locator('#features')).toBeFocused()
    await expectUnobscuredTarget(page, 'features')
    const repeatedFragmentHistoryLength = await page.evaluate(() => history.length)
    await features.click()
    await expect(page.locator('#features')).toBeFocused()
    expect(await page.evaluate(() => history.length)).toBe(repeatedFragmentHistoryLength)
    await footer.getByRole('link', { name: 'Get early access', exact: true }).click()
    await page.goBack()
    await expect(page).toHaveURL(marketingOrigin+'/footer-duplicates?campaign=kept#features')
    await page.reload()
    await expectUnobscuredTarget(page, 'features')
    const opened = context.waitForEvent('page')
    await features.click({ modifiers: ['Control'] })
    const modified = await opened
    await expect(modified).toHaveURL(marketingOrigin+'/footer-duplicates?campaign=kept#features')
    await modified.close()
    await expect(page).toHaveURL(marketingOrigin+'/footer-duplicates?campaign=kept#features')
    await footer.getByRole('link', { name: 'Terms fixture', exact: true }).click()
    await expect(page).toHaveURL('https://docs.example.test/terms')
    await expect(page.getByRole('heading', { name: 'Technical document fixture', exact: true })).toBeVisible()
  })

  test(cases.accessibility, async ({ page }) => {
    for (const slug of ['smartlaunch', 'navigation-features', 'navigation-faq', 'navigation-required']) {
      for (const viewport of [desktop, mobile]) {
        await page.setViewportSize(viewport)
        await visit(page, '/' + slug)
        const results = await new AxeBuilder({ page }).include('.product-header').include('#hero').include('#features').include('#faq').include('#form').include('footer').analyze()
        expect(results.violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) }))).toEqual([])

        if (viewport === mobile) {
          await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
          const expanded = await new AxeBuilder({ page }).include('.product-header').analyze()
          expect(expanded.violations).toEqual([])
        }
      }
    }
  })

  test(cases.responsive, async ({ page }) => {
    await page.setViewportSize(mobile)
    await visit(page, '/smartlaunch#form')
    await expectUnobscuredTarget(page, 'form')
    await expectNoOverflow(page)
    await expectMinimumTargets(page)
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await expectMinimumTargets(page)
    await expectNoOverflow(page)
    await page.keyboard.press('Escape')
    const compactHeaderHeight = await header(page).evaluate(element => element.getBoundingClientRect().height)
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' + spacingStyle })
    await expect.poll(() => header(page).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(compactHeaderHeight)
    await expectUnobscuredTarget(page, 'form')
    await expectNoOverflow(page)
    await expectMinimumTargets(page)
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await expectNoOverflow(page)
    await page.locator('#product-navigation-panel').getByRole('link', { name: 'How it works', exact: true }).click()
    await expectUnobscuredTarget(page, 'features')
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).scrollBehavior)).toBe('auto')
    const toggle = page.getByRole('button', { name: 'Open navigation', exact: true })
    await page.keyboard.press('Tab')
    await toggle.focus()
    await expect(toggle).toBeFocused()
    expect(await toggle.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
    expect(await toggle.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2)
    await expectMinimumTargets(page)
    await page.setViewportSize({ width: 667, height: 320 })
    await toggle.click()
    const panel = page.locator('#product-navigation-panel')
    const lastAction = panel.getByRole('link', { name: 'Get early access', exact: true })
    await lastAction.scrollIntoViewIfNeeded()
    await expect(lastAction).toBeInViewport()
    expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await expectNoOverflow(page)
  })

  test(cases.form, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const accountMutations: string[] = []
    const analytics: string[] = []
    const submissions: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/backoffice/auth')) {
        accountMutations.push(request.url())
      }

      if (/\/api\/bff\/(events|session|session_update)/.test(request.url())) {
        analytics.push('product-analytics')
      }

      if (/\/api\/bff\/submit(?:$|_)/.test(request.url())) {
        submissions.push('interest-submit')
      }
    })
    await visit(page)
    await header(page).getByRole('link', { name: 'Get early access', exact: true }).click()
    await page.locator('#form input[name="email"]').fill('story169-interest@example.test')
    await expect(page.locator('#form input[name="email"]')).toHaveValue('story169-interest@example.test')
    await header(page).getByRole('link', { name: 'FAQ', exact: true }).click()
    await expect(page.locator('#faq')).toBeFocused()
    expect((await page.context().cookies()).some(cookie => cookie.name === 'session_id')).toBe(true)
    await expect.poll(async () => {
      await page.mouse.wheel(0, 10000)

      return page.evaluate(() => window.scrollY / (document.documentElement.scrollHeight - window.innerHeight) * 100)
    }).toBeGreaterThan(80)
    await expect.poll(() => analytics.length).toBeGreaterThan(0)
    expect(accountMutations).toEqual([])
    expect(submissions).toEqual([])
  })

  test(cases.entry, async ({ page }) => {
    for (const entry of ['login', 'signup']) {
      await page.goto(marketingOrigin + '/account/' + entry)
      await expect(page.getByRole('link', { name: 'Log in', exact: true })).toHaveAttribute('href', accountOrigin + '/login')
    }

    for (const slug of ['account', 'login', 'signup']) {
      await visit(page, '/' + slug)
      await expect(page.getByRole('heading', { name: 'Soveris Origin', exact: true })).toBeVisible()
      await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
    }

    await page.route('**/api/bff/submit_pending', route => route.fulfill({ status: 400, json: { error: 'invalid_token' } }))

    for (const [origin, slug, login] of [[marketingOrigin, 'smartlaunch', true], [customerOrigin, 'smartlaunch', false], [marketingOrigin, 'account', false]] as const) {
      await page.goto(origin + '/' + slug + '/verify-submission?token=nonsecret-navigation-fixture')
      await expect(page.getByRole('heading', { name: 'Verification Link Invalid', exact: true })).toBeVisible()
      await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(login ? 1 : 0)
      await expect(header(page).getByRole('link', { name: 'Get early access', exact: true })).toHaveCount(0)
      await expect(header(page).getByRole('navigation')).toHaveCount(0)
      await expect(page.locator('#form, #features, #faq, #hero')).toHaveCount(0)
    }
  })
} else {
  test(cases.configuration, async ({ page }) => {
    const provenPlatform = stage.endsWith('account')

    for (const viewport of [desktop, mobile]) {
      await page.setViewportSize(viewport)
      await visit(page)
      await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
      await expect(header(page).getByRole('button', { name: 'Log in', exact: true })).toHaveCount(provenPlatform ? 1 : 0)

      if (provenPlatform) {
        await expect(header(page).getByRole('button', { name: 'Log in', exact: true })).toBeDisabled()
        await expect(header(page).getByText(unavailableText, { exact: true })).toBeVisible()
      }

      expect(await page.content()).not.toContain(accountOrigin + '/login')
      expect(await page.content()).not.toContain('invalid.example.test')
      await expect(page.locator('#hero').getByRole('link', { name: 'Get early access', exact: true })).toHaveAttribute('href', '#form')

      if (viewport === mobile) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      }

      await header(page).getByRole('link', { name: 'Get early access', exact: true }).click()
      await expect(page).toHaveURL(marketingOrigin + '/#form')
      await expectUnobscuredTarget(page, 'form')
      await visit(page, '/', customerOrigin)
      await expect(header(page).getByRole('link', { name: 'Log in', exact: true })).toHaveCount(0)
      await expect(header(page).getByRole('button', { name: 'Log in', exact: true })).toHaveCount(0)
    }
  })
}

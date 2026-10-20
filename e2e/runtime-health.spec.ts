import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installSession } from './reportMocks'

for (const role of ['ClientAdmin', 'Editor', 'Viewer'] as const) {
  test(`customer ${role} never renders, requests or restores technical health`, async ({ page }, info) => {
    await installSession(page, role)

    const healthRequests: string[] = []
    page.on('request', request => { if (/\/(health|ready|live)(?:[/?]|$)/i.test(new URL(request.url()).pathname)) healthRequests.push(request.url()) })
    await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/, route => route.fulfill({ json: {
      fromDate: null, toDate: null, totalPageViews: 7600, totalSubmissions: 1248,
      verifiedSubmissions: 1032, verificationRate: .827, conversionRate: .164 } }))
    await page.goto('/dashboard')
    await expect(page.getByText('1,248')).toBeVisible()
    await expect(page.getByRole('region', { name: 'System Health' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText('1,248')).toBeVisible()
    await page.reload()
    await expect(page.getByText('1,248')).toBeVisible()
    await page.setViewportSize({ width: 320, height: 780 })
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    expect(healthRequests).toEqual([])
    await page.screenshot({ path: info.outputPath(`customer-${role}.png`), fullPage: true })
  })
}

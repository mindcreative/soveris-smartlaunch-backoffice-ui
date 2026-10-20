import type { Page } from '@playwright/test'
import { currentAuthorityFixture } from '../src/test/authorityFixtures'
import type { AuthUser } from '../src/types/auth'

/** Browser transport fixture: authority comes from the current-session response. */
export async function installCurrentSession(page: Page, overrides: Partial<AuthUser> = {}) {
  const user = currentAuthorityFixture(overrides)
  await page.addInitScript(() => {
    localStorage.setItem('backoffice_access_token', 'test-token')
    localStorage.setItem('backoffice_refresh_token', 'test-refresh')
    localStorage.setItem('backoffice-auth-persist', JSON.stringify({ state: { accessToken: 'test-token', refreshTokenValue: 'test-refresh' }, version: 2 }))
  })
  await page.route('**/api/backoffice/auth/current', route => route.fulfill({ json: user, headers: { 'cache-control': 'no-store' } }))
  await page.route('**/api/backoffice/auth/revoke', route => route.fulfill({ status: 204 }))
  return user
}

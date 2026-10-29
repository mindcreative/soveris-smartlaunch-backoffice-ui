import { beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '../api/endpoints'
import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { useAuthStore } from './authStore'

beforeEach(async () => {
  await useAuthStore.getState().clearSession()
  localStorage.clear()
})

it('preserves a replacement stored session when the pending activation current lookup fails before storage dispatch', async () => {
  let rejectCurrent!: (failure: unknown) => void
  vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise((_resolve, reject) => { rejectCurrent = reject }))
  const accepting = useAuthStore.getState().acceptActivationSession({
    user: currentAuthorityFixture(), accessToken: 'activation', refreshToken: 'activation-refresh', expiresIn: 3600,
  }, currentAuthorityEpoch())
  localStorage.setItem('backoffice_access_token', 'replacement')
  localStorage.setItem('backoffice_refresh_token', 'replacement-refresh')
  rejectCurrent({ status: 503 })

  await expect(accepting).resolves.toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBe('replacement')
  expect(localStorage.getItem('backoffice_refresh_token')).toBe('replacement-refresh')
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
})

it('preserves replacement tokens after a delayed malformed current projection without an epoch change', async () => {
  let resolveCurrent!: (projection: Awaited<ReturnType<typeof authApi.currentAuthority>>) => void
  vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise(resolve => { resolveCurrent = resolve }))
  const accepting = useAuthStore.getState().acceptActivationSession({
    user: currentAuthorityFixture(), accessToken: 'activation', refreshToken: 'activation-refresh', expiresIn: 3600,
  }, currentAuthorityEpoch())
  localStorage.setItem('backoffice_access_token', 'replacement')
  localStorage.setItem('backoffice_refresh_token', 'replacement-refresh')
  resolveCurrent({ invalid: true } as unknown as Awaited<ReturnType<typeof authApi.currentAuthority>>)

  await expect(accepting).resolves.toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBe('replacement')
  expect(localStorage.getItem('backoffice_refresh_token')).toBe('replacement-refresh')
})

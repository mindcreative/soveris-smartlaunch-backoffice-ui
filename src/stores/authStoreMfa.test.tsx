import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authApi } from '../api/endpoints'
import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { currentPrivilegedGeneration, setPrivilegedExperience } from '../auth/mfaAuthority'
import { mfaFlow } from '../account/mfaFlow'
import { AuthProvider } from '../hooks/useAuth'
import { billingAccountKeys } from '../queries/billingQueries'
import { queryClient } from '../queryClient'
import { currentAuthorityFixture, verifiedMfaFixture } from '../test/authorityFixtures'
import type { PasswordLoginResult } from '../account/models/mfa'
import { useAuthStore } from './authStore'

const pending = { status: 'mfa_required' as const, challenge: { id: '01990000-0000-7000-8000-000000000009', secret: 'A'.repeat(43),
  purpose: 'login' as const, expiresAt: new Date(Date.now() + 240_000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'Q'.repeat(43) }

beforeEach(async () => {
  setPrivilegedExperience(false)
  await useAuthStore.getState().clearSession()
  queryClient.clear()
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

function deferredAuthority() {
  let resolve!: (value: ReturnType<typeof currentAuthorityFixture>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ReturnType<typeof currentAuthorityFixture>>((accept, fail) => {
    resolve = accept
    reject = fail
  })

  return { promise, resolve, reject }
}

it('quarantines a current-authority response started before privilege retirement', async () => {
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'], ...verifiedMfaFixture })
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  queryClient.setQueryData(billingAccountKeys.account(user.clientId), { customerBalance: '10' })
  const epoch = currentAuthorityEpoch()
  const response = deferredAuthority()
  vi.spyOn(authApi, 'currentAuthority').mockReturnValue(response.promise)
  const request = useAuthStore.getState().revalidateAuthority()

  useAuthStore.getState().retirePrivileged()
  response.resolve(user)
  await request

  expect(useAuthStore.getState().user?.platformPermissions).toEqual([])
  expect(useAuthStore.getState().user?.assuranceGeneration).toBeNull()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(currentAuthorityEpoch()).toBe(epoch)
  expect(queryClient.getQueryData(billingAccountKeys.account(user.clientId))).toEqual({ customerBalance: '10' })
})

it.each([
  ['success', null], ['unauthorized', { status: 401 }], ['forbidden', { status: 403 }],
  ['unavailable', { status: 503 }], ['transport failure', new Error('Synthetic transport failure')],
] as const)('replaces invalidated reads and keeps the replacement pending after stale %s', async (_outcome, failure) => {
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'], ...verifiedMfaFixture })
  const fresh = { ...user, assuranceGeneration: '01990000-0000-7000-8000-000000000098' }
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  queryClient.setQueryData(billingAccountKeys.account(user.clientId), { customerBalance: '10' })
  const epoch = currentAuthorityEpoch()
  const staleResponse = deferredAuthority()
  const freshResponse = deferredAuthority()
  const current = vi.spyOn(authApi, 'currentAuthority').mockReturnValueOnce(staleResponse.promise).mockReturnValue(freshResponse.promise)
  const staleRequest = useAuthStore.getState().revalidateAuthority()

  useAuthStore.getState().retirePrivileged()
  const freshRequest = useAuthStore.getState().revalidateAuthority()
  const freshOutcome = freshRequest.then(() => undefined, error => error)
  const staleOutcome = staleRequest.then(() => undefined, error => error)
  const replacementStarted = current.mock.calls.length

  if (failure) {
    staleResponse.reject(failure)
  } else {
    staleResponse.resolve(user)
  }

  const staleResult = await staleOutcome
  const retainedUser = useAuthStore.getState().user
  const sharedRequest = useAuthStore.getState().revalidateAuthority()
  const requestsWhilePending = current.mock.calls.length
  freshResponse.resolve(fresh)
  const [freshResult] = await Promise.all([freshOutcome, sharedRequest])

  expect(staleResult).toBeUndefined()
  expect(freshResult).toBeUndefined()
  expect(replacementStarted).toBe(2)
  expect(requestsWhilePending).toBe(2)
  expect(retainedUser?.platformPermissions).toEqual([])
  expect(useAuthStore.getState().user?.assuranceGeneration).toBe(fresh.assuranceGeneration)
  expect(useAuthStore.getState().user?.platformPermissions).toEqual(fresh.platformPermissions)
  expect(currentAuthorityEpoch()).toBe(epoch)
  expect(queryClient.getQueryData(billingAccountKeys.account(user.clientId))).toEqual({ customerBalance: '10' })
})

it.each([null, 401, 403, 503])('ignores stale success or status %s after the replacement projection succeeds', async status => {
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'], ...verifiedMfaFixture })
  const fresh = { ...user, assuranceGeneration: '01990000-0000-7000-8000-000000000098' }
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  const staleResponse = deferredAuthority()
  const freshResponse = deferredAuthority()
  vi.spyOn(authApi, 'currentAuthority').mockReturnValueOnce(staleResponse.promise).mockReturnValue(freshResponse.promise)
  const staleRequest = useAuthStore.getState().revalidateAuthority()

  useAuthStore.getState().retirePrivileged()
  const freshRequest = useAuthStore.getState().revalidateAuthority()
  freshResponse.resolve(fresh)
  await freshRequest

  if (status === null) {
    staleResponse.resolve(user)
  } else {
    staleResponse.reject({ status })
  }

  await staleRequest

  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(useAuthStore.getState().authorityUnavailable).toBe(false)
  expect(useAuthStore.getState().user?.assuranceGeneration).toBe(fresh.assuranceGeneration)
})

it('owns pending login only in memory without installing a session or fetching private authority', async () => {
  vi.spyOn(authApi, 'login').mockResolvedValue(pending)
  const projection = vi.spyOn(authApi, 'currentAuthority')
  expect(await useAuthStore.getState().login('fixture@example.invalid', 'synthetic primary')).toBe('mfa_required')
  const state = useAuthStore.getState()
  expect(state.isAuthenticated).toBe(false)
  expect(state.user).toBeNull()
  expect(state.accessToken).toBeNull()
  expect(state.refreshTokenValue).toBeNull()
  expect(projection).not.toHaveBeenCalled()
  expect(mfaFlow.snapshot().login?.challenge.id).toBe(pending.challenge.id)
  expect(JSON.stringify({ ...localStorage })).not.toContain(pending.challenge.secret)
  expect(JSON.stringify({ ...localStorage })).not.toContain(pending.csrfToken)
})

it('rejects a late pending login after replacement tokens appear before storage dispatch', async () => {
  let resolve!: (value: PasswordLoginResult) => void
  const request = vi.spyOn(authApi, 'login').mockImplementation(() => new Promise(done => { resolve = done }))
  const signingIn = useAuthStore.getState().login('fixture@example.invalid', 'synthetic primary')
  await waitFor(() => expect(request).toHaveBeenCalled())
  localStorage.setItem('backoffice_access_token', 'replacement')
  localStorage.setItem('backoffice_refresh_token', 'replacement-refresh')
  resolve(pending)
  expect(await signingIn).toBe(false)
  expect(mfaFlow.snapshot().login).toBeNull()
  expect(localStorage.getItem('backoffice_access_token')).toBe('replacement')
})

it('retires privilege without changing the original family, customer cache or global authority epoch', () => {
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'] })
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  queryClient.setQueryData(billingAccountKeys.account(user.clientId), { customerBalance: '10' })
  queryClient.setQueryData(['platform', 'metadata'], { privatePlatformValue: 'retire' })
  const epoch = currentAuthorityEpoch()
  const generation = currentPrivilegedGeneration()
  useAuthStore.getState().retirePrivileged()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(useAuthStore.getState().accessToken).toBe('fixture-token')
  expect(useAuthStore.getState().user?.sessionId).toBe(user.sessionId)
  expect(useAuthStore.getState().user?.permissions).toEqual(user.permissions)
  expect(useAuthStore.getState().user?.platformPermissions).toEqual([])
  expect(currentAuthorityEpoch()).toBe(epoch)
  expect(currentPrivilegedGeneration()).toBe(generation + 1)
  expect(queryClient.getQueryData(billingAccountKeys.account(user.clientId))).toEqual({ customerBalance: '10' })
  expect(queryClient.getQueryData(['platform', 'metadata'])).toBeUndefined()
})

it('accepts a new server assurance generation without retiring still-authorized customer work', async () => {
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'] })
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  queryClient.setQueryData(billingAccountKeys.account(user.clientId), { customerBalance: '10' })
  const next = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'], ...verifiedMfaFixture,
    assuranceGeneration: '01990000-0000-7000-8000-000000000098' })
  vi.spyOn(authApi, 'currentAuthority').mockResolvedValue(next)
  const epoch = currentAuthorityEpoch()
  await useAuthStore.getState().revalidateAuthority()
  expect(useAuthStore.getState().user?.assuranceGeneration).toBe(next.assuranceGeneration)
  expect(currentAuthorityEpoch()).toBe(epoch)
  expect(queryClient.getQueryData(billingAccountKeys.account(user.clientId))).toEqual({ customerBalance: '10' })
})

it('fetches current authority on focus even when the stored token is unchanged', async () => {
  const user = currentAuthorityFixture()
  useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
  useAuthStore.getState().setUser(user)
  const current = vi.spyOn(authApi, 'currentAuthority').mockResolvedValue(user)
  render(<AuthProvider><span>customer work</span></AuthProvider>)
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(current).toHaveBeenCalledOnce())
})

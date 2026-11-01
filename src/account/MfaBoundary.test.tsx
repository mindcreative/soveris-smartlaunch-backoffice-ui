import { act, render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MfaBoundary } from './MfaBoundary'
import { mfaFlow } from './mfaFlow'
import { authApi } from '../api/endpoints'
import { useAuthStore } from '../stores/authStore'
import { queryClient } from '../queryClient'
import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { currentPrivilegedGeneration, setPrivilegedExperience } from '../auth/mfaAuthority'
import { currentAuthorityFixture } from '../test/authorityFixtures'

beforeEach(async () => {
  await useAuthStore.getState().clearSession()
  setPrivilegedExperience(false)
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount() {
  return render(<MemoryRouter><MfaBoundary><input aria-label="Customer draft" defaultValue="keep this draft" /></MfaBoundary></MemoryRouter>)
}

it('retires privileged caches at fresh and general deadlines without resetting customer work or looping', async () => {
  const now = Date.now()
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'], mfaState: 'enrolled', stepUpRequired: false,
    assuranceGeneration: '01990000-0000-7000-8000-000000000098', freshAssuranceExpiresAt: new Date(now + 1000).toISOString(),
    assuranceExpiresAt: new Date(now + 601_000).toISOString() })
  useAuthStore.getState().setTokens('same-token', 'same-refresh')
  useAuthStore.getState().setUser(user)
  const current = vi.spyOn(authApi, 'currentAuthority').mockResolvedValue(user)
  queryClient.setQueryDefaults(['customer-draft'], { gcTime: Infinity })
  queryClient.setQueryData(['customer-draft'], { keep: true })
  queryClient.setQueryData(['platform', 'private'], { retire: true })
  const epoch = currentAuthorityEpoch()
  const generation = currentPrivilegedGeneration()
  mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(currentPrivilegedGeneration()).toBeGreaterThan(generation)
  expect(queryClient.getQueryData(['platform', 'private'])).toBeUndefined()
  expect(queryClient.getQueryData(['customer-draft'])).toEqual({ keep: true })
  expect(screen.getByLabelText('Customer draft')).toHaveValue('keep this draft')
  expect(currentAuthorityEpoch()).toBe(epoch)
  expect(useAuthStore.getState().accessToken).toBe('same-token')
  expect(current).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(current).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(599_000) })
  expect(useAuthStore.getState().user?.platformPermissions).toEqual([])
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(queryClient.getQueryData(['customer-draft'])).toEqual({ keep: true })
  expect(current).toHaveBeenCalledTimes(2)
})

it('accepts only invalidation from another tab and does not rebroadcast claims or secrets', async () => {
  const post = vi.fn()
  const close = vi.fn()
  let receive: ((event: { data: unknown }) => void) | null = null
  vi.stubGlobal('BroadcastChannel', class {
    postMessage = post
    close = close
    set onmessage(listener: (event: { data: unknown }) => void) { receive = listener }
  })
  const user = currentAuthorityFixture({ platformPermissions: ['platform:billing:view'] })
  useAuthStore.getState().setTokens('same-token', 'same-refresh')
  useAuthStore.getState().setUser(user)
  const current = vi.spyOn(authApi, 'currentAuthority').mockResolvedValue({ ...user, platformPermissions: [], stepUpRequired: true,
    assuranceGeneration: null, assuranceExpiresAt: null, freshAssuranceExpiresAt: null })
  const view = mount()
  await act(async () => receive!({ data: { kind: 'invalidate', otp: 'do not accept' } }))
  expect(current).not.toHaveBeenCalled()
  await act(async () => receive!({ data: { kind: 'invalidate' } }))
  expect(useAuthStore.getState().user?.platformPermissions).toEqual([])
  expect(current).toHaveBeenCalledOnce()
  expect(post).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new Event('mfa:invalidate-peers')))
  expect(post).toHaveBeenCalledWith({ kind: 'invalidate' })
  view.unmount()
  expect(close).toHaveBeenCalledOnce()
})

it('removes one-time disclosures on expiry and on pagehide', async () => {
  mfaFlow.setCodes(['synthetic-one-time-code'])
  mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
  expect(mfaFlow.snapshot().codes).toBeNull()
  act(() => mfaFlow.setCodes(['replacement-display']))
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(mfaFlow.snapshot().codes).toBeNull()
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { authApi } from '../api/endpoints'
import { apiClient } from '../api/apiClient'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture, verifiedMfaFixture } from '../test/authorityFixtures'
import { mfaFlow } from './mfaFlow'
import { mfaApi } from './mfaApi'
import { googleAccountApi } from './googleAccountApi'
import type { MfaBoundChallenge } from './models/mfa'

const bound: MfaBoundChallenge = { challenge: { id: '01990000-0000-7000-8000-000000000009', secret: 'A'.repeat(43), purpose: 'login',
  expiresAt: new Date(Date.now() + 240_000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'Q'.repeat(43) }
const codes = Array.from({ length: 10 }, (_, index) => index.toString(16).toUpperCase().padStart(4, '0') + '-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')

beforeEach(async () => {
  await useAuthStore.getState().clearSession()
  localStorage.clear()
  mfaFlow.clear()
})
afterEach(() => vi.restoreAllMocks())

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

it('hands password pending login to memory without a private session, then accepts only final verified completion', async () => {
  vi.spyOn(authApi, 'login').mockResolvedValue({ status: 'mfa_required', challenge: { ...bound.challenge, purpose: 'login' }, csrfToken: bound.csrfToken })
  const user = currentAuthorityFixture({ ...verifiedMfaFixture, platformPermissions: [], permissions: ['products:view'] })
  vi.spyOn(authApi, 'currentAuthority').mockResolvedValue(user)
  const verify = vi.spyOn(mfaApi, 'verifyLogin').mockResolvedValue({ user, accessToken: 'verified-fixture', refreshToken: 'verified-refresh', expiresIn: 60 })
  open('/login')
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.invalid' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'synthetic primary' } })
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Finish sign-in' })
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000001' } })
  expect(screen.getByLabelText('Authenticator code')).toHaveValue('000001')
  await userEvent.click(screen.getByRole('button', { name: 'Verify code' }))
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true))
  expect(verify).toHaveBeenCalledOnce()
  expect(localStorage.getItem('backoffice_access_token')).toBe('verified-fixture')
  expect(mfaFlow.snapshot().login).toBeNull()
})

it('handles Google pending MFA without installing a primary-only session or completing from render', async () => {
  const complete = vi.spyOn(googleAccountApi, 'complete').mockResolvedValue({ status: 'mfa_required', challenge: { ...bound.challenge, purpose: 'login' }, csrfToken: bound.csrfToken })
  open('/account/google/complete')
  expect(complete).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Finish sign-in' }))
  await screen.findByRole('heading', { name: 'Finish sign-in' })
  await waitFor(() => expect(window.location.pathname).toBe('/account/mfa/challenge'))
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  expect(mfaFlow.snapshot().login?.challenge.id).toBe(bound.challenge.id)
})

it('keeps customer authority and focuses fixed linked feedback after wrong step-up OTP', async () => {
  const user = currentAuthorityFixture({ ...verifiedMfaFixture, platformPermissions: [] })
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(user)
  mfaFlow.setStepUp({ ...bound, challenge: { ...bound.challenge, purpose: 'step_up' } })
  vi.spyOn(mfaApi, 'verifyChallenge').mockRejectedValue({ code: 'invalid_mfa_flow', status: 400, message: 'private-canary' })
  open('/account/mfa/challenge')
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000001' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify code' }))
  const feedback = await screen.findByRole('alert')
  expect(feedback).toHaveFocus()
  expect(screen.getByLabelText('Authenticator code')).toHaveAttribute('aria-describedby', expect.stringContaining('mfa-feedback'))
  expect(screen.queryByText('private-canary')).not.toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(useAuthStore.getState().accessToken).toBe('current')
  expect(useAuthStore.getState().user?.permissions).toEqual(user.permissions)
})

it('requires a new saved acknowledgement and cannot reopen recovery material after leaving', async () => {
  mfaFlow.setCodes(codes)
  open('/account/mfa/enroll')
  const button = screen.getByRole('button', { name: 'Continue to fresh sign-in' })
  expect(button).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'I saved these codes privately.' }))
  expect(button).toBeEnabled()
  await userEvent.click(button)
  expect(mfaFlow.snapshot().codes).toBeNull()
  act(() => { window.history.pushState(null, '', '/account/mfa/enroll'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await screen.findByText(/This setup is no longer available/)
  expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument()
})

it('bounds wrong-code retries across the login and recovery handoff without installing a session', async () => {
  mfaFlow.setLogin({ ...bound, challenge: { ...bound.challenge, attemptsRemaining: 2 } })
  const verify = vi.spyOn(mfaApi, 'verifyLogin').mockRejectedValue({ code: 'invalid_mfa_flow', status: 400 })
  open('/account/mfa/challenge')

  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000001' } })
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(mfaFlow.snapshot().login?.challenge.attemptsRemaining).toBe(1 - attempt))
  }

  expect(screen.getByRole('button', { name: 'Verify code' })).toBeDisabled()
  expect(screen.getByText(/no retries left/)).toBeVisible()
  expect(verify).toHaveBeenCalledTimes(2)
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
})

it('rejects an in-flight verification result after the user leaves the MFA route', async () => {
  let finish!: (value: Awaited<ReturnType<typeof mfaApi.verifyLogin>>) => void
  mfaFlow.setLogin(bound)
  const verify = vi.spyOn(mfaApi, 'verifyLogin').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const user = currentAuthorityFixture()
  open('/account/mfa/challenge')
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000001' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify code' }))
  expect(verify).toHaveBeenCalledOnce()
  act(() => {
    window.history.pushState(null, '', '/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await screen.findByRole('heading', { name: 'Log in' })
  await act(async () => finish({ user, accessToken: 'late-session', refreshToken: 'late-refresh', expiresIn: 60 }))
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  expect(mfaFlow.snapshot().login).toBeNull()
})

it('renders a local blob QR and manual key without confirming from render, then clears both on retirement', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-synthetic-mfa')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const confirm = vi.spyOn(mfaApi, 'confirm')
  mfaFlow.setEnrollment({ enrollmentId: bound.challenge.id, expiresAt: bound.challenge.expiresAt, manualKey: 'A'.repeat(32),
    qrPngBase64: 'iVBORw0KGgo=', issuer: 'Soveris SmartLaunch', accountLabel: 'synthetic@example.invalid', csrfToken: bound.csrfToken, recovery: true })
  open('/account/mfa/enroll')
  const image = await screen.findByRole('img', { name: /Authenticator setup QR image/ })
  expect(image).toHaveAttribute('src', 'blob:owned-synthetic-mfa')
  expect(screen.getByText('A'.repeat(32))).toBeInTheDocument()
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.load(image)
  expect(revoke).toHaveBeenCalledWith('blob:owned-synthetic-mfa')
  act(() => mfaFlow.clear())
  expect(screen.queryByRole('img', { name: /Authenticator setup QR image/ })).not.toBeInTheDocument()
  expect(screen.queryByText('A'.repeat(32))).not.toBeInTheDocument()
  expect(create).toHaveBeenCalledOnce()
})

it('finishes same-session Google reauthentication only on the explicit action and asks no Google-only password', async () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  vi.spyOn(mfaApi, 'status').mockResolvedValue({ mfaState: 'none', mandatoryForPrivilege: false, hasLocalPassword: false, googleReauthenticationAvailable: true })
  const complete = vi.spyOn(googleAccountApi, 'reauthenticationComplete').mockResolvedValue({ ...bound, challenge: { ...bound.challenge, purpose: 'enrollment' } })
  open('/account/google/reauth-complete')
  expect(complete).not.toHaveBeenCalled()
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Finish identity confirmation' }))
  await screen.findByRole('heading', { name: 'Account security' })
  expect(mfaFlow.snapshot().primary?.challenge.purpose).toBe('enrollment')
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  expect(useAuthStore.getState().accessToken).toBe('current')
})

it('clears a typed security password on pagehide and privilege retirement while retaining customer access', async () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  vi.spyOn(mfaApi, 'status').mockResolvedValue({ mfaState: 'none', mandatoryForPrivilege: false, hasLocalPassword: true, googleReauthenticationAvailable: false })
  open('/account/security')
  const password = await screen.findByLabelText('Current account password', { exact: true })
  fireEvent.change(password, { target: { value: 'private primary fixture' } })
  act(() => window.dispatchEvent(new Event('auth:privileged-retired')))
  expect(password).toHaveValue('')
  fireEvent.change(password, { target: { value: 'second primary fixture' } })
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(screen.queryByLabelText('Current account password', { exact: true })).not.toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(useAuthStore.getState().accessToken).toBe('current')
})

it('retires factor-removal consent when privileged authority changes', async () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture({ ...verifiedMfaFixture }))
  mfaFlow.setPrimary({ ...bound, challenge: { ...bound.challenge, purpose: 'factor_change' } })
  vi.spyOn(mfaApi, 'status').mockResolvedValue({ mfaState: 'enrolled', mandatoryForPrivilege: false, hasLocalPassword: true, googleReauthenticationAvailable: false })
  const change = vi.spyOn(mfaApi, 'changeFactor')
  open('/account/security')
  const consent = await screen.findByRole('checkbox', { name: /I confirm removal/ })
  await userEvent.click(consent)
  expect(consent).toBeChecked()
  act(() => window.dispatchEvent(new Event('auth:privileged-retired')))
  expect(consent).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Remove authenticator' })).toBeDisabled()
  expect(change).not.toHaveBeenCalled()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
})

it('allows pasted spaced codes with leading zeros and waits for explicit verification', async () => {
  mfaFlow.setLogin(bound)
  const verify = vi.spyOn(mfaApi, 'verifyLogin')
  const user = userEvent.setup()
  open('/account/mfa/challenge')
  await user.click(screen.getByLabelText('Authenticator code'))
  await user.paste('000 001')
  expect(screen.getByLabelText('Authenticator code')).toHaveValue('000001')
  expect(screen.getByLabelText('Authenticator code')).toHaveAttribute('autocomplete', 'one-time-code')
  expect(verify).not.toHaveBeenCalled()
})


it.each(['step_up', 'google_link', 'factor_change'] as const)('cancels the bound authenticated %s challenge on the server and preserves separate primary proof', async purpose => {
  const user = currentAuthorityFixture({ ...verifiedMfaFixture, platformPermissions: [] })
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(user)
  const primary: MfaBoundChallenge = { ...bound, challenge: { ...bound.challenge, id: '01990000-0000-7000-8000-000000000010', purpose: 'replacement' } }
  mfaFlow.setPrimary(primary)
  const challenge: MfaBoundChallenge = { ...bound, challenge: { ...bound.challenge, purpose } }
  mfaFlow.setStepUp(challenge)
  vi.spyOn(mfaApi, 'status').mockResolvedValue({ mfaState: 'enrolled', mandatoryForPrivilege: false, hasLocalPassword: true, googleReauthenticationAvailable: false })
  const request = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: '{"status":"cancelled"}', status: 200 })
  open('/account/mfa/challenge')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel verification' }))
  await screen.findByRole('heading', { name: 'Account security' })
  expect(request).toHaveBeenCalledExactlyOnceWith('/auth/mfa/challenge/cancel', {
    challengeId: challenge.challenge.id, challengeSecret: challenge.challenge.secret, purpose,
  }, expect.objectContaining({ baseURL: '/api/backoffice', retryOnUnauthorized: false,
    headers: { 'X-MFA-CSRF': challenge.csrfToken } }))
  expect(mfaFlow.snapshot().stepUp).toBeNull()
  expect(mfaFlow.snapshot().primary).toEqual(primary)
  expect(useAuthStore.getState().accessToken).toBe('current')
})

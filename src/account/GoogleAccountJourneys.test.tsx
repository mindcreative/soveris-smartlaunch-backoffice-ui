import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { ADMISSION_FIXTURE, completeAccountChallenge, mockAccountAdmission } from '../test/accountAdmissionFixture'
import { authApi } from '../api/endpoints'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { accountFlow } from './accountFlow'
import { accountLifecycleApi } from './accountLifecycleApi'
import { googleAccountApi } from './googleAccountApi'

beforeEach(async () => {
  mockAccountAdmission()
  await useAuthStore.getState().clearSession()
  localStorage.clear()
  accountFlow.clear()
  vi.spyOn(authApi, 'revoke').mockResolvedValue()
})

function open(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
}

it.each(['/signup', '/login'])('offers a deliberate branded Google action and separator above the email form at %s', async path => {
  const start = vi.spyOn(googleAccountApi, 'start').mockRejectedValue({ status: 503, code: 'account_flow_unavailable', detail: 'private-canary' })
  open(path)
  const button = screen.getByRole('button', { name: 'Continue with Google' })

  expect(button.compareDocumentPosition(screen.getByLabelText('Email address')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('or')).toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
  if (path === '/signup') {
    await completeAccountChallenge()
  }

  await userEvent.click(button)
  await screen.findByRole('alert')

  if (path === '/signup') {
    expect(start).toHaveBeenCalledWith('signup', undefined, expect.any(AbortSignal), {
      contextId: ADMISSION_FIXTURE.contextId, token: 'fixture-challenge-token', csrf: ADMISSION_FIXTURE.csrf,
    })
  } else {
    expect(start).toHaveBeenCalledWith('login', undefined, expect.any(AbortSignal))
  }
  expect(screen.queryByText('private-canary')).not.toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(document.querySelector('script[src*="google"],iframe')).toBeNull()
})

it('does not complete from render or effect and consumes at most one deliberate completion attempt', async () => {
  const complete = vi.spyOn(googleAccountApi, 'complete').mockResolvedValue({ status: 'cancelled' })
  open('/account/google/complete')

  expect(complete).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Finish sign-in' }))
  await screen.findByText(/Google sign-in was cancelled/)

  expect(complete).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Finish sign-in' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Open linking confirmation' })).not.toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
})

it('requires explicit sign-out before a completion page can replace a current session', () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  const complete = vi.spyOn(googleAccountApi, 'complete')
  open('/account/google/complete')

  expect(screen.getByRole('button', { name: 'Sign out to continue' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Finish sign-in' })).not.toBeInTheDocument()
  expect(complete).not.toHaveBeenCalled()
})

it('keeps Google pending authority limited and replaces email correction with an explicit fresh-account action', () => {
  accountFlow.setPending({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 86400, authMethod: 'google' }, '')
  open('/check-email')

  expect(screen.queryByLabelText('Correct email address')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start again with another Google account' })).toBeInTheDocument()
  expect(screen.getByText(/no local password is created/i)).toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
})

it('identifies a lost-bearer proof only on request and resumes with Google without requesting a password', async () => {
  accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
  const context = vi.spyOn(accountLifecycleApi, 'proofContext').mockResolvedValue({ authMethod: 'google', expiresIn: 1200, completed: false })
  const start = vi.spyOn(googleAccountApi, 'start').mockRejectedValue({ status: 503, code: 'account_flow_unavailable' })
  const verify = vi.spyOn(accountLifecycleApi, 'verify')
  open('/verify-email')

  expect(context).not.toHaveBeenCalled()
  expect(verify).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Original signup password')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Check sign-in method' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Verify and continue with Google' }))

  expect(start).toHaveBeenCalledWith('resume_verification', 'A'.repeat(43), expect.any(AbortSignal))
  expect(screen.queryByLabelText('Original signup password')).not.toBeInTheDocument()
  expect(verify).not.toHaveBeenCalled()
})

it('requires fresh existing-password proof and a separate explicit confirmation before linking', async () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  const prove = vi.spyOn(googleAccountApi, 'linkProof').mockResolvedValue('A'.repeat(43))
  const link = vi.spyOn(googleAccountApi, 'link').mockResolvedValue()
  open('/account/google/link')

  expect(prove).not.toHaveBeenCalled()
  expect(link).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Existing account password'), { target: { value: ' original password ' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify existing account' }))
  const confirmation = await screen.findByRole('button', { name: 'Confirm and link Google' })

  expect(prove).toHaveBeenCalledWith(' original password ', 'current', expect.any(AbortSignal))
  expect(link).not.toHaveBeenCalled()
  await userEvent.click(confirmation)
  await screen.findByRole('heading', { name: 'Google account linked' })

  expect(link).toHaveBeenCalledWith('A'.repeat(43), 'current', expect.any(AbortSignal))
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
})

it('retires memory-only linking proof when the current authority changes', async () => {
  useAuthStore.getState().setTokens('current', 'current-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  vi.spyOn(googleAccountApi, 'linkProof').mockResolvedValue('A'.repeat(43))
  const link = vi.spyOn(googleAccountApi, 'link')
  open('/account/google/link')
  fireEvent.change(screen.getByLabelText('Existing account password'), { target: { value: ' original password ' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify existing account' }))
  await screen.findByRole('button', { name: 'Confirm and link Google' })
  await act(async () => useAuthStore.getState().clearSession())

  expect(screen.queryByRole('button', { name: 'Confirm and link Google' })).not.toBeInTheDocument()
  expect(link).not.toHaveBeenCalled()
})

it('shows completed guidance for a replayed Google proof without pending state or new authority', async () => {
  accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
  vi.spyOn(accountLifecycleApi, 'proofContext').mockResolvedValue({ authMethod: 'google', expiresIn: 1200, completed: true })
  const start = vi.spyOn(googleAccountApi, 'start')
  const verify = vi.spyOn(accountLifecycleApi, 'verify')
  open('/verify-email')
  await userEvent.click(screen.getByRole('button', { name: 'Check sign-in method' }))
  await screen.findByRole('heading', { name: 'Activation complete' })

  expect(screen.getByText(/Log in normally to continue/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Verify and continue with Google' })).not.toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
  expect(verify).not.toHaveBeenCalled()
  expect(accountFlow.proof('verify')).toBeNull()
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
  expect(localStorage.getItem('backoffice_access_token')).toBeNull()
})

it('preserves explicit email-password replay even when method inspection reports completion', async () => {
  accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
  vi.spyOn(accountLifecycleApi, 'proofContext').mockResolvedValue({ authMethod: 'email_password', expiresIn: 1200, completed: true })
  const verify = vi.spyOn(accountLifecycleApi, 'verify').mockResolvedValue({ status: 'activation_complete', loginRequired: true })
  open('/verify-email')
  await userEvent.click(screen.getByRole('button', { name: 'Check sign-in method' }))
  await userEvent.type(await screen.findByLabelText('Original signup password'), 'original fixture password')

  expect(verify).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
  await screen.findByRole('heading', { name: 'Activation complete' })

  expect(verify).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().isAuthenticated).toBe(false)
})

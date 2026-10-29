import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { accountFlow } from './accountFlow'
import { accountLifecycleApi } from './accountLifecycleApi'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { authApi } from '../api/endpoints'

beforeEach(() => {
  accountFlow.clear()
  localStorage.clear()
  useAuthStore.setState({ user: null, accessToken: null, refreshTokenValue: null, isAuthenticated: false,
    isInitialized: true, isLoading: false, authorityUnavailable: false })
  vi.spyOn(accountLifecycleApi, 'proofContext').mockResolvedValue({ authMethod: 'email_password', expiresIn: 1800, completed: false })
})

function open(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
}

describe('minimal account journeys', () => {
  it.each(['/signup', '/SIGNUP', '/signup/', '/SiGnUp/'])('preserves pending signup from %s without creating session authority', async path => {
    const register = vi.spyOn(accountLifecycleApi, 'register').mockResolvedValue({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 86400 })
    open(path)
    const user = userEvent.setup()
    const password = ' exact signup password '
    await user.type(screen.getByLabelText('Email address'), 'User+Tag@example.test')
    await user.type(screen.getByLabelText('Password', { exact: true }), password)
    await user.click(screen.getByRole('button', { name: 'Show password' }))

    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(password)
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'text')
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByRole('heading', { name: 'Check your email' })

    expect(register).toHaveBeenCalledWith({ email: 'user+tag@example.test', password, returnIntent: 'create_first_product' }, expect.any(AbortSignal))
    expect(accountFlow.pending()).toMatchObject({ pendingToken: 'A'.repeat(43), email: 'user+tag@example.test' })
    expect(screen.getByLabelText('Correct email address')).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
    expect(screen.getByText(/does not guarantee delivery/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request another email/i })).toBeDisabled()
  })

  it('focuses invalid fields with linked guidance and accepts password-manager paste', async () => {
    const register = vi.spyOn(accountLifecycleApi, 'register')
    open('/signup')
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!)

    expect(screen.getByLabelText('Email address')).toHaveFocus()
    expect(register).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@example.test' } })
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Password', { exact: true }))
    await user.paste(' pasted password with spaces ')

    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(' pasted password with spaces ')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Password', { exact: true })).not.toHaveAttribute('maxlength')
  })

  it('shows honest reload guidance without silently re-registering or resending', () => {
    const register = vi.spyOn(accountLifecycleApi, 'register')
    const resend = vi.spyOn(accountLifecycleApi, 'resend')
    open('/check-email')

    expect(screen.getByText(/reopen.*email.*check its sign-in method/i)).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('requires a deliberate verify action and permits original-password fallback after a bearer mismatch', async () => {
    accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    accountFlow.setPending({ status: 'check_email', pendingToken: 'Q'.repeat(42) + 'A', expiresIn: 86400 }, 'test@example.test')
    const verify = vi.spyOn(accountLifecycleApi, 'verify')
      .mockRejectedValueOnce({ code: 'invalid_or_expired_proof', status: 400 })
      .mockResolvedValueOnce({ status: 'activation_complete', loginRequired: true })
    open('/verify-email')

    expect(verify).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByRole('alert')
    expect(accountFlow.proof('verify')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Use original signup password' }))
    await userEvent.type(screen.getByLabelText('Original signup password'), ' old password ')
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByRole('heading', { name: 'Activation complete' })

    expect(verify).toHaveBeenLastCalledWith({ proof: 'A'.repeat(43), password: ' old password ' }, expect.any(AbortSignal))
    expect(accountFlow.proof('verify')).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('does not revive pending state from a late register response after navigation', async () => {
    let finish!: (receipt: { status: 'check_email'; pendingToken: string; expiresIn: number }) => void
    vi.spyOn(accountLifecycleApi, 'register').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    open('/signup')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await userEvent.click(screen.getByRole('link', { name: 'Log in' }))
    await act(async () => { finish({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 86400 }) })

    expect(window.location.pathname).toBe('/login')
    expect(accountFlow.pending()).toBeNull()
  })

  it('does not replace a signed-in identity until deliberate sign-out on this proof page', async () => {
    accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    useAuthStore.setState({ isAuthenticated: true, user: currentAuthorityFixture(), accessToken: 'existing', refreshTokenValue: 'refresh' })
    vi.spyOn(authApi, 'revoke').mockResolvedValue()
    const verify = vi.spyOn(accountLifecycleApi, 'verify')
    open('/verify-email')

    expect(screen.queryByRole('button', { name: 'Verify email' })).not.toBeInTheDocument()
    expect(verify).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out to continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Check sign-in method' }))
    await screen.findByLabelText('Original signup password')

    expect(accountFlow.proof('verify')).not.toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('treats committed activation/session failure as login-required without another verify', async () => {
    accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    const verify = vi.spyOn(accountLifecycleApi, 'verify').mockRejectedValue({ status: 503, code: 'account_flow_unavailable', loginRequired: true })
    open('/verify-email')
    await userEvent.click(screen.getByRole('button', { name: 'Check sign-in method' }))
    await userEvent.type(screen.getByLabelText('Original signup password'), 'original')
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByRole('heading', { name: 'Activation complete' })

    expect(verify).toHaveBeenCalledTimes(1)
    expect(accountFlow.proof('verify')).toBeNull()
  })

  it('invalidates an in-flight form and password on unsolicited authority retirement', async () => {
    let finish!: () => void
    vi.spyOn(accountLifecycleApi, 'register').mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 86400 })
    }))
    open('/signup')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await act(async () => { await useAuthStore.getState().clearSession(); finish() })

    await waitFor(() => expect(screen.getByLabelText('Password', { exact: true })).toHaveValue(''))
    expect(accountFlow.pending()).toBeNull()
  })

  it('clears an active password before a page can enter browser history cache', async () => {
    open('/signup')
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'private draft password' } })
    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
    expect(accountFlow.pending()).toBeNull()
  })

  it('does not restore sign-out continuation proof after leaving while server revocation is pending', async () => {
    let revoked!: () => void
    vi.spyOn(authApi, 'revoke').mockImplementation(() => new Promise(resolve => { revoked = resolve }))
    accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    useAuthStore.setState({ isAuthenticated: true, user: currentAuthorityFixture(), accessToken: 'existing', refreshTokenValue: 'refresh' })
    open('/verify-email')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out to continue' }))
    await screen.findByText(/reopen the newest applicable email link/i)
    await userEvent.click(screen.getByRole('link', { name: 'Log in' }))
    await act(async () => { revoked() })

    expect(window.location.pathname).toBe('/login')
    expect(accountFlow.proof('verify')).toBeNull()
  })

  it('does not redirect or install authority after leaving during the activation current lookup', async () => {
    accountFlow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    const user = currentAuthorityFixture()
    vi.spyOn(accountLifecycleApi, 'verify').mockResolvedValue({ status: 'activated', nextAction: 'create_first_product',
      session: { accessToken: 'activation', refreshToken: 'activation-refresh', expiresIn: 3600, user } })
    let fail!: (error: unknown) => void
    const lookup = vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    open('/verify-email')
    await userEvent.click(screen.getByRole('button', { name: 'Check sign-in method' }))
    fireEvent.change(screen.getByLabelText('Original signup password'), { target: { value: 'original' } })
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }))
    await act(async () => { fail({ status: 503 }) })

    expect(window.location.pathname).toBe('/signup')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(accountFlow.proof('verify')).toBeNull()
  })
})

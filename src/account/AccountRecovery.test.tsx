import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useAuthStore } from '../stores/authStore'
import { authApi } from '../api/endpoints'
import { apiClient } from '../api/apiClient'
import { currentAuthorityEpoch, retireAuthority } from '../auth/authorityEpoch'
import { accountFlow } from './accountFlow'
import { accountLifecycleApi } from './accountLifecycleApi'
import { currentAuthorityFixture } from '../test/authorityFixtures'

beforeEach(async () => {
  await useAuthStore.getState().clearSession()
  localStorage.clear()
  accountFlow.clear()
})

function open(path: string) {
  window.history.replaceState(null, '', path)
  render(<App />)
}

describe('recovery and login', () => {
  it.each(['eligible', 'unknown', 'disabled', 'pending', 'passwordless', 'privileged'])('keeps forgot outcome uniform: %s', async () => {
    const forgot = vi.spyOn(accountLifecycleApi, 'forgot').mockResolvedValue()
    open('/forgot-password')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.test' } })
    await userEvent.click(screen.getByRole('button', { name: 'Request reset instructions' }))
    await screen.findByRole('heading', { name: 'Check for reset instructions' })

    expect(forgot).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/if.*eligible.*instructions/i)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('never resets from rendering; explicit reset clears secrets and offers normal login without a session', async () => {
    accountFlow.setProof({ kind: 'reset', proof: 'A'.repeat(43), expiresAt: Date.now() + 100000 })
    const reset = vi.spyOn(accountLifecycleApi, 'reset').mockResolvedValue()
    open('/reset-password')

    expect(reset).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: ' replacement password ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await screen.findByRole('heading', { name: 'Password reset' })

    expect(reset).toHaveBeenCalledWith({ proof: 'A'.repeat(43), newPassword: ' replacement password ' }, expect.any(AbortSignal))
    expect(accountFlow.proof('reset')).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  })

  it('accepts exact legacy credentials without signup strength rules or raw error interpolation', async () => {
    const login = vi.spyOn(authApi, 'login').mockRejectedValue({ status: 401, message: 'private-canary' })
    open('/login')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: ' x ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')

    expect(login).toHaveBeenCalledWith({ email: 'fixture@example.test', password: ' x ' }, expect.any(AbortSignal))
    expect(screen.queryByText('private-canary')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('does not install or navigate from a login result arriving after deliberate navigation away', async () => {
    let release!: (result: Awaited<ReturnType<typeof authApi.login>>) => void
    const login = vi.spyOn(authApi, 'login').mockImplementation(() => new Promise(resolve => { release = resolve }))
    open('/login')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'old' } })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const signal = login.mock.calls[0][1]

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }))

    expect(signal?.aborted).toBe(true)
    await act(async () => { release({ accessToken: 'late', refreshToken: 'late-refresh', expiresIn: 3600, user: currentAuthorityFixture() }) })

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
    expect(localStorage.getItem('backoffice_refresh_token')).toBeNull()
    expect(window.location.pathname).toBe('/signup')
  })

  it('cancels the API client login request when leaving the page without installing a session', async () => {
    const cancelled = vi.fn()
    const post = vi.spyOn(apiClient, 'post').mockImplementation((_url, _body, config) => new Promise((_resolve, reject) => {
      config?.signal?.addEventListener?.('abort', () => {
        cancelled()
        reject({ code: 'ERR_CANCELED', message: 'Request cancelled' })
      }, { once: true })
    }))
    open('/login')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'old' } })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'fixture@example.test', password: 'old' }, { signal: expect.any(AbortSignal) })
    await userEvent.click(screen.getByRole('link', { name: 'Create account' }))
    await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: false, user: null, accessToken: null, refreshTokenValue: null })
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
    expect(localStorage.getItem('backoffice_refresh_token')).toBeNull()
    expect(window.location.pathname).toBe('/signup')
  })

  it('does not send an already aborted login', async () => {
    const login = vi.spyOn(authApi, 'login')
    const controller = new AbortController()
    controller.abort()

    await expect(useAuthStore.getState().login('fixture@example.test', 'old', controller.signal)).resolves.toBe(false)

    expect(login).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: false, accessToken: null })
  })

  it.each(['success', 'failure'] as const)('fences a superseded login %s without clearing replacement authority', async outcome => {
    let finish!: () => void
    const login = vi.spyOn(authApi, 'login').mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => {
        if (outcome === 'failure') {
          reject({ status: 401 })

          return
        }

        resolve({ accessToken: 'late', refreshToken: 'late-refresh', expiresIn: 3600, user: currentAuthorityFixture() })
      }
    }))
    const controller = new AbortController()
    const request = useAuthStore.getState().login('fixture@example.test', 'old', controller.signal)
    const result = outcome === 'failure' ? expect(request).rejects.toMatchObject({ status: 401 }) : expect(request).resolves.toBe(false)
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    retireAuthority()
    useAuthStore.getState().setTokens('replacement', 'replacement-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    finish()
    await result

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, isLoading: false, accessToken: 'replacement', refreshTokenValue: 'replacement-refresh' })
    expect(localStorage.getItem('backoffice_access_token')).toBe('replacement')
    expect(localStorage.getItem('backoffice_refresh_token')).toBe('replacement-refresh')
  })

  it.each(['success', 'failure', 'cancellation'] as const)('preserves a queued cross-tab replacement before its storage event: %s', async outcome => {
    let finish!: () => void
    const login = vi.spyOn(authApi, 'login').mockImplementation((_credentials, signal) => new Promise((resolve, reject) => {
      if (outcome === 'cancellation') {
        signal?.addEventListener('abort', () => reject({ code: 'ERR_CANCELED', message: 'Request cancelled' }), { once: true })

        return
      }

      finish = () => {
        if (outcome === 'failure') {
          reject({ status: 401 })

          return
        }

        resolve({ accessToken: 'late', refreshToken: 'late-refresh', expiresIn: 3600, user: currentAuthorityFixture() })
      }
    }))
    const controller = new AbortController()
    const request = useAuthStore.getState().login('fixture@example.test', 'old', controller.signal)
    const result = outcome === 'failure' ? expect(request).rejects.toMatchObject({ status: 401 }) : expect(request).resolves.toBe(false)
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    localStorage.setItem('backoffice_access_token', 'replacement')
    localStorage.setItem('backoffice_refresh_token', 'replacement-refresh')

    if (outcome === 'cancellation') {
      controller.abort()
    } else {
      finish()
    }

    await result

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, accessToken: null, refreshTokenValue: null })
    expect(localStorage.getItem('backoffice_access_token')).toBe('replacement')
    expect(localStorage.getItem('backoffice_refresh_token')).toBe('replacement-refresh')
  })

  it('does not retire authority again when a dispatched login is aborted', async () => {
    const login = vi.spyOn(authApi, 'login').mockImplementation((_credentials, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject({ code: 'ERR_CANCELED', message: 'Request cancelled' }), { once: true })
    }))
    const controller = new AbortController()
    const request = useAuthStore.getState().login('fixture@example.test', 'old', controller.signal)
    const result = expect(request).resolves.toBe(false)
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    const epoch = currentAuthorityEpoch()
    controller.abort()
    await result

    expect(currentAuthorityEpoch()).toBe(epoch)
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: false })
  })

  it('honors bounded login Retry-After and associates fixed guidance with both credential fields', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue({ status: 429, retryAfterSeconds: 60 })
    open('/login')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.test' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'old' } })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-describedby', 'login-error')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('aria-describedby', 'login-error')
  })
})

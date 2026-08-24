import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { billingApi } from '../../api/billingApi'
import { authApi } from '../../api/endpoints'
import { billingAccountKeys } from '../../queries/billingQueries'
import { queryClient } from '../../queryClient'
import { useAuthStore } from '../../stores/authStore'
import type { BillingAccountSnapshot } from '../../types/billing'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'

function snapshot(clientId: string, ownedBalance: string): BillingAccountSnapshot {
  return {
    creditAccountId: '11111111-2222-3333-4444-555555555555',
    clientId,
    ownedBalance,
    activelyReservedAmount: '1.0000',
    availableBalance: ownedBalance,
    activeReservationCount: 0,
    status: 'active',
    asOf: '2026-08-24T07:00:00+00:00',
  }
}

function setSession(role: 'Admin' | 'Viewer' = 'Admin') {
  useAuthStore.setState({
    accessToken: 'token',
    refreshTokenValue: 'refresh',
    user: {
      id: 'operator',
      email: 'operator@example.com',
      displayName: 'Operator',
      role,
      clientId: CLIENT_A,
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
    },
    isLoading: false,
    isAuthenticated: true,
    isInitialized: true,
  })
}

describe('Billing interactions and private transitions', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    setSession()
  })

  it('hides Billing navigation for a Viewer but lets the direct route ask the server', async () => {
    setSession('Viewer')
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_403', message: 'Insufficient permissions', status: 403,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith(CLIENT_A, expect.any(AbortSignal))
    expect(
      within(screen.getByRole('complementary', { name: 'Primary navigation' })).queryByRole(
        'link',
        { name: 'Billing' }
      )
    ).not.toBeInTheDocument()
  })

  it('opens an accessible mobile navigation and restores trigger focus on Escape', async () => {
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(snapshot(CLIENT_A, '10.0000'))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('10.0000')).length).toBeGreaterThan(0)

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    expect(screen.getByRole('complementary', { name: 'Mobile navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Mobile navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps only same-Client stale values with the original asOf while refreshing', async () => {
    const cached = snapshot(CLIENT_A, '10.0000')
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_A), cached)
    await queryClient.invalidateQueries({ queryKey: billingAccountKeys.account(CLIENT_A), exact: true })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockReturnValue(new Promise(() => undefined))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)

    render(<App />)

    expect(await screen.findByText('Cached snapshot may be stale. Values remain tied to the displayed Snapshot as of time.')).toBeInTheDocument()
    expect(screen.getAllByText('10.0000')).not.toHaveLength(0)
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(cached.asOf)
    expect(screen.getByRole('status', { name: /Refreshing account snapshot/i })).toBeInTheDocument()
  })

  it('never flashes the former Client during browser-history navigation', async () => {
    let resolveClientB: ((value: BillingAccountSnapshot) => void) | undefined
    vi.spyOn(billingApi, 'getAccountSnapshot').mockImplementation((clientId) => {
      if (clientId === CLIENT_A) return Promise.resolve(snapshot(CLIENT_A, '10.0000'))
      return new Promise((resolve) => {
        resolveClientB = resolve
      })
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    render(<App />)
    expect((await screen.findAllByText('10.0000')).length).toBeGreaterThan(0)

    window.history.pushState({}, '', `/billing/clients/${CLIENT_B}/account`)
    window.dispatchEvent(new PopStateEvent('popstate'))

    await screen.findByText(`Selected Client: ${CLIENT_B}`)
    expect(screen.queryByText('10.0000')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
    })

    resolveClientB?.(snapshot(CLIENT_B, '20.0000'))
    expect((await screen.findAllByText('20.0000')).length).toBeGreaterThan(0)
  })

  it('keeps the same-Client snapshot visible and labelled during manual refresh', async () => {
    let resolveRefresh: ((value: BillingAccountSnapshot) => void) | undefined
    const request = vi.spyOn(billingApi, 'getAccountSnapshot')
      .mockResolvedValueOnce(snapshot(CLIENT_A, '10.0000'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve
      }))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('10.0000')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
    expect(screen.getAllByText('10.0000')).not.toHaveLength(0)
    expect(screen.getByRole('status', { name: /Refreshing account snapshot/i })).toBeInTheDocument()
    expect(screen.getByText(/Cached snapshot may be stale/)).toBeInTheDocument()

    resolveRefresh?.(snapshot(CLIENT_A, '11.0000'))
    expect((await screen.findAllByText('11.0000')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Refresh snapshot' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Refresh snapshot' })).toHaveFocus()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('keeps a same-Client snapshot visible and marks it stale after refresh failure', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot')
      .mockResolvedValueOnce(snapshot(CLIENT_A, '10.0000'))
      .mockRejectedValue({ code: 'HTTP_500', message: 'Generic server error', status: 500 })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('10.0000')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Refresh snapshot' }))

    expect(await screen.findByText(/Refresh failed\. Cached snapshot may be stale/)).toBeInTheDocument()
    expect(screen.getAllByText('10.0000')).not.toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Account snapshot unavailable' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('clears the private session and snapshot cache after a 401', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_B), snapshot(CLIENT_B, '99.0000'))
    vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_401', message: 'Session expired', status: 401,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)

    render(<App />)

    expect(await screen.findByLabelText('Email address')).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(screen.queryByText('99.0000')).not.toBeInTheDocument()
  })

  it('retries a transient failure once and exposes a safe manual recovery', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_500', message: 'Generic server error', status: 500,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Account snapshot unavailable' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)

    request.mockResolvedValue(snapshot(CLIENT_A, '10.0000'))
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    expect((await screen.findAllByText('10.0000')).length).toBeGreaterThan(0)
  })

  it('returns to a validated direct URL after login', async () => {
    useAuthStore.setState({
      accessToken: null,
      refreshTokenValue: null,
      user: null,
      isLoading: false,
      isAuthenticated: false,
      isInitialized: true,
    })
    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
      user: {
        id: 'operator',
        email: 'operator@example.com',
        displayName: 'Operator',
        role: 'Admin',
        clientId: CLIENT_A,
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresIn: 3600,
      },
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(snapshot(CLIENT_A, '10.0000'))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_A}/account`)
    const user = userEvent.setup()
    render(<App />)

    await screen.findByLabelText('Email address')
    await user.type(screen.getByLabelText('Email address'), 'operator@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Account overview' })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_A}/account`)
  })

  it('rejects a cross-origin-shaped post-login return path', async () => {
    useAuthStore.setState({
      accessToken: null,
      refreshTokenValue: null,
      user: null,
      isLoading: false,
      isAuthenticated: false,
      isInitialized: true,
    })
    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
      user: {
        id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
        clientId: CLIENT_A, accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600,
      },
    })
    window.history.replaceState({ usr: { from: '/\\evil.example' } }, '', '/login')
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Email address'), 'operator@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByRole('heading', { name: /Welcome back/i })
    expect(window.location.pathname).toBe('/dashboard')
  })
})

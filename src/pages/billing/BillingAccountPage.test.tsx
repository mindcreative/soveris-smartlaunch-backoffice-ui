import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { billingApi } from '../../api/billingApi'
import { queryClient } from '../../queryClient'
import { useAuthStore } from '../../stores/authStore'
import type { BillingAccountSnapshot } from '../../types/billing'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const SNAPSHOT: BillingAccountSnapshot = {
  creditAccountId: '11111111-2222-3333-4444-555555555555',
  clientId: CLIENT_ID,
  ownedBalance: '99999999999999.9999',
  activelyReservedAmount: '20.0000',
  availableBalance: '99999999999979.9999',
  activeReservationCount: 0,
  status: 'active',
  asOf: '2026-08-24T07:00:00+00:00',
}

function authenticate(role: 'Admin' | 'Viewer' = 'Admin') {
  useAuthStore.setState({
    accessToken: 'token',
    refreshTokenValue: 'refresh',
    user: {
      id: 'operator',
      email: 'operator@example.com',
      displayName: 'Operator',
      role,
      clientId: CLIENT_ID,
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
    },
    isLoading: false,
    isAuthenticated: true,
    isInitialized: true,
  })
}

describe('Billing account routes and states', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    authenticate()
  })

  it('renders the server snapshot on a canonical direct route', async () => {
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(SNAPSHOT)
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/account`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Account overview' })).toHaveFocus()
    expect(await screen.findByText('99,999,999,999,999.9999')).toBeInTheDocument()
    expect(screen.getByText('20.0000')).toBeInTheDocument()
    expect(screen.getByText('Active reservations')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('active', { selector: 'span' })).toBeInTheDocument()
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(SNAPSHOT.asOf)
    expect(screen.getByLabelText(/Snapshot as of/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ledger/ })).toHaveAttribute(
      'href',
      `/billing/clients/${CLIENT_ID}/ledger`
    )
  })

  it('treats a configured all-zero account as a real snapshot', async () => {
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue({
      ...SNAPSHOT,
      ownedBalance: '0.0000',
      activelyReservedAmount: '0.0000',
      availableBalance: '0.0000',
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/account`)

    render(<App />)

    expect((await screen.findAllByText('0.0000')).length).toBe(3)
    expect(screen.queryByRole('heading', { name: 'Credit account not configured' })).not.toBeInTheDocument()
  })

  it('redirects /billing to the authenticated default Client without an alias request', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(SNAPSHOT)
    window.history.replaceState({}, '', '/billing')

    render(<App />)

    await screen.findByRole('heading', { name: 'Account overview' })
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/account`)
    expect(request).toHaveBeenCalledWith(CLIENT_ID, expect.any(AbortSignal))
  })

  it('does not request Billing data for an invalid Client route', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot')
    window.history.replaceState({}, '', '/billing/clients/not-a-guid/account')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Client context unavailable' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
  })

  it('replace-navigates a valid non-canonical GUID before requesting it', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(SNAPSHOT)
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID.toUpperCase()}/account`)

    render(<App />)

    await screen.findByRole('heading', { name: 'Account overview' })
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/account`)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(CLIENT_ID, expect.any(AbortSignal))
  })

  it('uses durable not-configured and permission-denied states without snapshot values', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot')
    request.mockRejectedValue({
      code: 'HTTP_404',
      message: 'Credit account not configured',
      status: 404,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/account`)
    const first = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Credit account not configured' })).toBeInTheDocument()
    expect(screen.queryByText('99,999,999,999,999.9999')).not.toBeInTheDocument()

    first.unmount()
    queryClient.clear()
    request.mockRejectedValue({
      code: 'HTTP_403',
      message: 'Insufficient permissions',
      status: 403,
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
    expect(screen.queryByText('99,999,999,999,999.9999')).not.toBeInTheDocument()
  })

  it('exposes the canonical ledger boundary without calling the account endpoint', async () => {
    const request = vi.spyOn(billingApi, 'getAccountSnapshot')
    const ledgerRequest = vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue({
      items: [],
      asOf: '2026-08-24T07:00:00+00:00',
      nextCursor: null,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID.toUpperCase()}/ledger`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Ledger history' })).toHaveFocus()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/ledger`)
    expect(await screen.findByRole('heading', { name: 'No ledger operations' })).toBeInTheDocument()
    expect(ledgerRequest).toHaveBeenCalledWith(CLIENT_ID, { filters: {} }, expect.any(AbortSignal))
    expect(request).not.toHaveBeenCalled()
  })
})

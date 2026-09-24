import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import * as adjustmentApi from '../../api/billingAdjustmentApi'
import { BillingAdjustmentContractError } from '../../api/billingAdjustmentApi'
import { authApi } from '../../api/endpoints'
import { queryClient } from '../../queryClient'
import { invalidateCreditAdjustmentScopes } from '../../queries/billingQueries'
import { useAuthStore } from '../../stores/authStore'
import type { CreditAdjustmentHistoryPage } from '../../types/billing'

const CLIENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-4222-8333-444444444444'
const ACTOR_ID = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'
const ADJUSTMENT_ID = '0199c000-0000-7000-8000-000000000001'

function page(nextCursor: string | null = null, adjustmentId = ADJUSTMENT_ID,
  amount = '10.000000000000000000'): CreditAdjustmentHistoryPage {
  return {
    items: [{
      schemaVersion: 1, clientId: CLIENT_ID,
      creditAccountId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      operationId: '0199c000-0000-7000-8000-000000000010', adjustmentId,
      ledgerId: '0199c000-0000-7000-8000-000000000020', amount,
      reason: 'Verified persisted reason', performedBy: ACTOR_ID,
      expectedWalletVersion: '40', walletVersionBefore: '40', walletVersionAfter: '41',
      beforeOwnedBalance: '100.000000000000000000',
      beforeReservedBalance: '20.000000000000000000',
      beforeAvailableBalance: '80.000000000000000000',
      afterOwnedBalance: amount.startsWith('-')
        ? '90.000000000000000000' : '110.000000000000000000',
      afterReservedBalance: '20.000000000000000000',
      afterAvailableBalance: amount.startsWith('-')
        ? '70.000000000000000000' : '90.000000000000000000',
      operationAsOf: '2026-09-24T08:09:10.123456', operationType: 'original',
      originalAdjustmentId: null, reversalAdjustmentId: null,
    }],
    asOf: '2026-09-24T09:00:00.000001', nextCursor,
  }
}

function authenticate(role: 'Admin' | 'Viewer' = 'Admin') {
  useAuthStore.setState({
    accessToken: 'token', refreshTokenValue: 'refresh', isLoading: false,
    isAuthenticated: true, isInitialized: true,
    user: { id: ACTOR_ID, email: 'operator@example.com', displayName: 'Operator', role,
      clientId: CLIENT_ID, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 },
  })
}

describe('Billing adjustment history experience', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    queryClient.clear()
    localStorage.clear()
    authenticate()
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/adjustments`)
  })

  it('owns the canonical route, breadcrumbs, focused heading and correctly ordered permission tab', async () => {
    const request = vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockResolvedValue(page())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Adjustment history' })).toHaveFocus()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await expect(request.mock.results[0]?.value).resolves.toEqual(page())
    expect(request).toHaveBeenCalledWith(CLIENT_ID, { filters: {} }, expect.any(AbortSignal))
    expect(within(screen.getByRole('navigation', { name: 'Billing workspace' }))
      .getAllByRole('link').map((link) => link.textContent))
      .toEqual(['Account', 'Ledger', 'Adjustments', 'Subscriptions'])
    expect(screen.getByRole('link', { name: 'Adjustments' })).toHaveAttribute('aria-current', 'page')
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(breadcrumbs).toHaveTextContent(`Billing/Adjustment history/Selected Client ${CLIENT_ID}`)
    expect(screen.getByRole('table', {
      name: 'Newest-first immutable Billing adjustment history',
    })).toBeInTheDocument()
  })

  it('canonicalizes uppercase routes and rejects invalid Client routes without requesting', async () => {
    const request = vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockResolvedValue(page())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID.toUpperCase()}/adjustments`)
    const rendered = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Adjustment history' })).toHaveFocus()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/adjustments`)
    expect(request).toHaveBeenCalledTimes(1)

    rendered.unmount()
    queryClient.clear()
    request.mockClear()
    window.history.replaceState({}, '', '/billing/clients/not-a-guid/adjustments')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Client context unavailable' }))
      .toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('shows labelled loading and the exact unfiltered empty state', async () => {
    let release: ((value: CreditAdjustmentHistoryPage) => void) | undefined
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockImplementation(
      () => new Promise((resolve) => { release = resolve }))
    render(<App />)
    expect(await screen.findByLabelText('Loading adjustment history…')).toBeInTheDocument()
    release?.({ items: [], asOf: page().asOf, nextCursor: null })
    expect(await screen.findByRole('heading', { name: 'No adjustment history' }))
      .toBeInTheDocument()
  })

  it('returns to the validated canonical history route after login', async () => {
    useAuthStore.setState({ accessToken: null, refreshTokenValue: null, user: null,
      isLoading: false, isAuthenticated: false, isInitialized: true })
    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600,
      user: { id: ACTOR_ID, email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
        clientId: CLIENT_ID, accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600 },
    })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockResolvedValue(page())
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Email address'), 'operator@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Adjustment history' })).toHaveFocus()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/adjustments`)
  })

  it('asks the server on a direct hidden-tab route and durably clears denied rows', async () => {
    authenticate('Viewer')
    const request = vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockRejectedValue({
      code: 'HTTP_403', message: 'Denied', status: 403,
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toHaveFocus()
    expect(screen.queryByRole('link', { name: 'Adjustments' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(queryClient.getQueryCache().findAll({
      queryKey: ['backoffice', 'private', 'billing'],
    })).toHaveLength(0))
  })

  it('starts fresh for filters and continuation 400 while keeping filter state private', async () => {
    const request = vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage')
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ items: [], asOf: page().asOf, nextCursor: null })
      .mockResolvedValueOnce(page('opaque-next'))
      .mockRejectedValueOnce({ code: 'credit_adjustment_history_invalid_query', message: 'bad', status: 400 })
      .mockResolvedValueOnce(page())
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('table')
    await user.type(screen.getByLabelText('Exact reason'), 'Exact & private')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(await screen.findByRole('heading', { name: 'No adjustments match these filters' }))
      .toBeInTheDocument()
    expect(request.mock.calls[1]?.[1]).toEqual({ filters: { reason: 'Exact & private' } })
    expect(window.location.search).toBe('')
    expect(localStorage.getItem('adjustment-history-filters')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    await screen.findByRole('button', { name: 'Load more' })
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('This adjustment history can no longer be continued'))
      .toBeInTheDocument()
    expect(request.mock.calls[3]?.[1]).toEqual({ cursor: 'opaque-next' })
    expect(screen.getByRole('table')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(5))
    expect(request.mock.calls[4]?.[1]).toEqual({ filters: {} })
  })

  it('renders distinct missing-zone, DST field, authorization and history dependency states', async () => {
    const request = vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage')
    request.mockRejectedValueOnce({ code: 'time_zone_not_set', message: 'missing', status: 409 })
    const rendered = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Saved timezone required' })).toHaveFocus()
    expect(screen.getByText(/contact an administrator/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try/i })).not.toBeInTheDocument()

    rendered.unmount(); queryClient.clear()
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/adjustments`)
    request.mockRejectedValueOnce({ code: 'local_time_ambiguous', message: 'ambiguous', status: 422,
      problemDetails: { code: 'local_time_ambiguous', field: 'from' } })
    const dst = render(<App />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByRole('link', { name: /From:/ })).toHaveAttribute('href', '#adjustment-history-from')
    dst.unmount()

    // The two 503 codes must give operators different, non-revealing remediation.
    for (const [code, heading] of [
      ['authorization_dependency_unavailable', 'Authorization unavailable'],
      ['credit_adjustment_history_dependency_unavailable', 'Adjustment history unavailable'],
    ] as const) {
      queryClient.clear()
      window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/adjustments`)
      request
        .mockRejectedValueOnce({ code, message: 'secret dependency detail', status: 503 })
        .mockRejectedValueOnce({ code, message: 'secret dependency detail', status: 503 })
      const service = render(<App />)
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByText('secret dependency detail')).not.toBeInTheDocument()
      service.unmount()
    }
  })

  it('suppresses contract-invalid evidence and removes visible rows on permission loss', async () => {
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage')
      .mockRejectedValueOnce(new BillingAdjustmentContractError('invalid evidence'))
      .mockResolvedValue(page())
    const first = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Adjustment history unavailable' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    first.unmount(); queryClient.clear()
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/adjustments`)
    render(<App />)
    await screen.findByRole('table')
    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, role: 'Viewer' } : null }))
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toHaveFocus()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('marks Story 3.5 invalidation stale and never flashes rows across Client history transitions', async () => {
    let releaseB: ((value: CreditAdjustmentHistoryPage) => void) | undefined
    let clientACalls = 0
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentHistoryPage').mockImplementation((clientId) => {
      if (clientId === CLIENT_B) return new Promise((resolve) => { releaseB = resolve })
      clientACalls += 1
      return Promise.resolve(page(null,
        clientACalls === 1 ? ADJUSTMENT_ID : '0199c000-0000-7000-8000-000000000003'))
    })
    render(<App />)
    await screen.findByRole('table')
    await invalidateCreditAdjustmentScopes(queryClient, CLIENT_ID)
    expect(await screen.findByText(/This adjustment history may be stale/)).toBeInTheDocument()

    window.history.pushState({}, '', `/billing/clients/${CLIENT_B}/adjustments`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await screen.findByText(`Selected Client: ${CLIENT_B}`)
    expect(document.querySelector(`[data-adjustment-id="${ADJUSTMENT_ID}"]`)).toBeNull()
    await waitFor(() => expect(releaseB).toBeDefined())
    releaseB?.({ ...page(null, '0199c000-0000-7000-8000-000000000002'),
      items: page().items.map((item) => ({ ...item, clientId: CLIENT_B,
        adjustmentId: '0199c000-0000-7000-8000-000000000002' })) })
    await waitFor(() => expect(document.querySelector(
      '[data-adjustment-id="0199c000-0000-7000-8000-000000000002"]')).not.toBeNull())
    window.history.back()
    await waitFor(() => expect(window.location.pathname)
      .toBe(`/billing/clients/${CLIENT_ID}/adjustments`))
    expect(document.querySelector(
      '[data-adjustment-id="0199c000-0000-7000-8000-000000000002"]')).toBeNull()
    await waitFor(() => expect(clientACalls).toBeGreaterThanOrEqual(2))
  })
})

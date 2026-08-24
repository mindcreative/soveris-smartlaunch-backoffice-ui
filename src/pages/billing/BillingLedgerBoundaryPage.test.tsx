import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { billingApi, BillingLedgerContractError } from '../../api/billingApi'
import { authApi } from '../../api/endpoints'
import { queryClient } from '../../queryClient'
import { useAuthStore } from '../../stores/authStore'
import {
  BILLING_LEDGER_TRANSACTION_TYPES,
  type BillingLedgerPage,
} from '../../types/billing'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'

function page(
  nextCursor: string | null = null,
  ledgerId = '77777777-7777-7777-7777-777777777779',
  amount = '20.0000'
): BillingLedgerPage {
  return {
    items: [{
      ledgerId,
      creditAccountId: ACCOUNT_ID,
      jobId: '22222222-2222-2222-2222-222222222222',
      reservationId: null,
      adjustmentId: null,
      operationId: '88888888-8888-8888-8888-888888888888',
      transactionType: 'reservation_committed',
      amount,
      balanceAfter: '99999999999999.9999',
      ruleId: null,
      ruleVersion: null,
      actorUserId: null,
      reason: 'A long untrusted reason that must remain visible and safely wrap.',
      createdAt: '2026-08-24T07:00:00+00:00',
    }],
    asOf: '2026-08-24T08:00:00+00:00',
    nextCursor,
  }
}

function authenticate() {
  useAuthStore.setState({
    accessToken: 'token', refreshTokenValue: 'refresh', isLoading: false,
    isAuthenticated: true, isInitialized: true,
    user: {
      id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
      clientId: CLIENT_ID, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
    },
  })
}

describe('Billing ledger experience', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    authenticate()
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/ledger`)
  })

  it('renders semantic desktop and equivalent narrow ledger representations', async () => {
    vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(page())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Ledger history' })).toHaveFocus()
    const table = await screen.findByRole('table', { name: 'Newest-first immutable Billing ledger operations' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(6)
    expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(6)
    expect(table.querySelector('tr[data-ledger-id]')).toHaveAttribute('data-ledger-id', page().items[0]?.ledgerId)
    expect(screen.getByRole('list', { name: 'Newest-first immutable Billing ledger operations' })).toBeInTheDocument()
    expect(screen.getAllByText('+20.0000')).toHaveLength(2)
    expect(screen.getAllByText('99,999,999,999,999.9999')).toHaveLength(2)
    expect(screen.getAllByText('Reservation committed / hold released').filter((element) => element.tagName !== 'OPTION')).toHaveLength(2)
    expect(screen.getAllByText('No actor recorded')).toHaveLength(2)
    expect(screen.getAllByText(ACCOUNT_ID)).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /Job|reservation|operation/i })).not.toBeInTheDocument()
  })

  it('renders every persisted type label and every present immutable field without future links', async () => {
    const template = page().items[0]!
    const amounts: Record<(typeof BILLING_LEDGER_TRANSACTION_TYPES)[number], string> = {
      subscription_grant: '1.0000', reservation: '-1.0000', consumption: '-1.0000',
      manual_adjustment: '-1.0000', reversal: '1.0000', promotion: '1.0000',
      reservation_expired: '1.0000', reservation_committed: '1.0000',
      reservation_released: '1.0000',
    }
    const labels = [
      'Subscription grant', 'Reservation hold', 'Credit consumption', 'Manual adjustment',
      'Reversal', 'Promotion', 'Reservation expired / hold released',
      'Reservation committed / hold released', 'Reservation released',
    ]
    const items = BILLING_LEDGER_TRANSACTION_TYPES.map((transactionType, index) => ({
      ...template,
      ledgerId: `77777777-7777-7777-7777-${String(999999999999 - index).padStart(12, '0')}`,
      transactionType,
      amount: amounts[transactionType],
      reservationId: '33333333-3333-3333-3333-333333333333',
      adjustmentId: '44444444-4444-4444-4444-444444444444',
      ruleId: '55555555-5555-5555-5555-555555555555',
      ruleVersion: 'v1',
      actorUserId: '66666666-6666-6666-6666-666666666666',
    }))
    vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue({
      items, asOf: page().asOf, nextCursor: null,
    })
    render(<App />)
    await screen.findByRole('table')

    for (const label of labels) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2)
    }
    for (const value of [
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      '66666666-6666-6666-6666-666666666666',
      'v1',
    ]) {
      expect(screen.getAllByText(value).length).toBeGreaterThanOrEqual(2)
    }
    const results = screen.getByRole('region', { name: 'Ledger operations' })
    expect(within(results).queryByRole('button', { name: /sort/i })).not.toBeInTheDocument()
    expect(within(results).queryByRole('link')).not.toBeInTheDocument()
  })

  it('focuses a validation summary and does not request invalid filters', async () => {
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(page())
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('table')

    await user.type(screen.getByLabelText('Credit account ID'), 'bad-guid')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByLabelText('Credit account ID')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('link', { name: /Credit account ID: Enter a complete/i })).toHaveAttribute(
      'href', '#ledger-creditAccountId'
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('normalizes applied filters, starts a fresh traversal, and clears safely', async () => {
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ items: [], asOf: page().asOf, nextCursor: null })
      .mockResolvedValueOnce(page())
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('table')

    await user.type(screen.getByLabelText('Credit account ID'), ACCOUNT_ID.toUpperCase())
    await user.selectOptions(screen.getByLabelText('Transaction type'), 'promotion')
    await user.selectOptions(screen.getByLabelText('Page size'), '50')
    const apply = screen.getByRole('button', { name: 'Apply filters' })
    await user.click(apply)

    expect(await screen.findByRole('heading', { name: 'No ledger operations match these filters' })).toBeInTheDocument()
    expect(request.mock.calls[1]?.[1]).toEqual({ filters: {
      creditAccountId: ACCOUNT_ID, transactionType: 'promotion', pageSize: 50,
    } })
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('heading', { name: 'Filter ledger operations' })).toHaveFocus()
    expect(request.mock.calls[2]?.[1]).toEqual({ filters: {} })
  })

  it('uses an opaque cursor, retains rows on continuation 400, and starts fresh explicitly', async () => {
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(page('opaque-cursor'))
      .mockRejectedValueOnce({ code: 'HTTP_400', message: 'Invalid ledger query', status: 400 })
      .mockResolvedValueOnce(page())
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('This ledger view can no longer be continued')).toBeInTheDocument()
    expect(screen.getAllByText('+20.0000')).toHaveLength(2)
    expect(request.mock.calls[1]?.[1]).toEqual({ cursor: 'opaque-cursor' })

    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
    expect(request.mock.calls[2]?.[1]).toEqual({ filters: {} })
  })

  it('lets a direct route ask the server when local navigation permission is absent', async () => {
    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, role: 'Viewer' } : null }))
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockRejectedValue({
      code: 'HTTP_403', message: 'Insufficient permissions', status: 403,
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith(CLIENT_ID, { filters: {} }, expect.any(AbortSignal))
  })

  it('removes visible private rows immediately when Billing permission is lost', async () => {
    vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(page())
    render(<App />)
    await screen.findByRole('table')

    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, role: 'Viewer' } : null }))

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().findAll({
      queryKey: ['backoffice', 'private', 'billing', 'ledger'],
    })).toHaveLength(0))
  })

  it('rejects an invalid direct Client route without a ledger request or cache entry', async () => {
    const request = vi.spyOn(billingApi, 'getLedgerPage')
    window.history.replaceState({}, '', '/billing/clients/not-a-guid/ledger')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Client context unavailable' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
  })

  it('replace-navigates an uppercase Client route before requesting the canonical Client', async () => {
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(page())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID.toUpperCase()}/ledger`)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Ledger history' })).toHaveFocus()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/ledger`)
    expect(request).toHaveBeenCalledWith(CLIENT_ID, { filters: {} }, expect.any(AbortSignal))
  })

  it('removes all rows immediately when a continuation violates the ledger contract', async () => {
    vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(page('opaque-cursor'))
      .mockRejectedValueOnce(new BillingLedgerContractError('continuation watermark mismatch'))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('heading', { name: 'Ledger unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('+20.0000')).not.toBeInTheDocument()
  })

  it('never flashes old ledger rows across Client A, Client B, and history back to A', async () => {
    const clientB = 'ffffffff-1111-2222-3333-444444444444'
    let releaseB: ((value: BillingLedgerPage) => void) | undefined
    let clientACalls = 0
    vi.spyOn(billingApi, 'getLedgerPage').mockImplementation((clientId) => {
      if (clientId === clientB) return new Promise((resolve) => { releaseB = resolve })
      clientACalls += 1
      return Promise.resolve(page(
        null,
        clientACalls === 1
          ? '77777777-7777-7777-7777-777777777779'
          : '77777777-7777-7777-7777-777777777777',
        clientACalls === 1 ? '10.0000' : '11.0000'
      ))
    })
    render(<App />)
    expect((await screen.findAllByText('+10.0000')).length).toBeGreaterThan(0)

    window.history.pushState({}, '', `/billing/clients/${clientB}/ledger`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await screen.findByText(`Selected Client: ${clientB}`)
    expect(screen.queryByText('+10.0000')).not.toBeInTheDocument()

    releaseB?.(page(null, '77777777-7777-7777-7777-777777777778', '30.0000'))
    expect((await screen.findAllByText('+30.0000')).length).toBeGreaterThan(0)

    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/ledger`))
    await screen.findByText(`Selected Client: ${CLIENT_ID}`)
    expect(screen.queryByText('+30.0000')).not.toBeInTheDocument()
    await waitFor(() => expect(clientACalls).toBe(2))
    expect((await screen.findAllByText('+11.0000')).length).toBeGreaterThan(0)
  })

  it('returns to a validated direct ledger URL after login', async () => {
    useAuthStore.setState({
      accessToken: null, refreshTokenValue: null, user: null,
      isLoading: false, isAuthenticated: false, isInitialized: true,
    })
    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600,
      user: {
        id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
        clientId: CLIENT_ID, accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600,
      },
    })
    vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(page())
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Email address'), 'operator@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Ledger history' })).toHaveFocus()
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/ledger`)
  })
})

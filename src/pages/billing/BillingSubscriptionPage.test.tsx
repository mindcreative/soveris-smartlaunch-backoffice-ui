import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { billingApi } from '../../api/billingApi'
import { queryClient } from '../../queryClient'
import { useAuthStore } from '../../stores/authStore'
import type {
  BillingSubscriptionCreationReceipt,
  BillingSubscriptionState,
  CreateBillingSubscriptionRequest,
} from '../../types/billing'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function authenticate(role: 'Admin' | 'Viewer' = 'Admin') {
  useAuthStore.setState({
    accessToken: 'token', refreshTokenValue: 'refresh', isLoading: false,
    isAuthenticated: true, isInitialized: true,
    user: {
      id: 'operator', email: 'operator@example.com', displayName: 'Operator', role,
      clientId: CLIENT_ID, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
    },
  })
}

function account(status: 'active' | 'suspended' | 'closed' = 'active') {
  return {
    creditAccountId: '11111111-2222-3333-4444-555555555555', clientId: CLIENT_ID,
    ownedBalance: '10.0000', activelyReservedAmount: '0.0000', availableBalance: '10.0000',
    activeReservationCount: 0, status, asOf: '2026-09-06T12:00:00+00:00', walletVersion: '1',
  }
}

function emptyState(): BillingSubscriptionState {
  return {
    clientId: CLIENT_ID, stateAsOf: '2026-09-06T12:00:00+00:00', current: null,
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: '2026-09-06T12:00:00+00:00', nextCursor: null },
  }
}

function currentState(): BillingSubscriptionState {
  return {
    ...emptyState(),
    current: {
      subscriptionId: '22222222-2222-3333-8444-555555555555',
      creationOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
      planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab', clientId: CLIENT_ID,
      planName: 'Pro', cycleCreditAmount: '1250.0000',
      entitlements: {
        schemaVersion: 1 as const,
        rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
        featureFlags: { contentGeneration: true, imageGeneration: true },
      },
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace',
      unusedCreditPolicy: 'rollover', billingCycleAnchor: '2026-09-01T00:00:00+00:00',
      status: 'active', validFrom: '2026-09-01T00:00:00+00:00', validTo: null,
      createdAt: '2026-09-01T00:00:00+00:00', updatedAt: '2026-09-01T00:00:00+00:00',
    },
  }
}

function creationReceipt(
  request: CreateBillingSubscriptionRequest,
  created = true
): BillingSubscriptionCreationReceipt {
  return {
    created,
    subscription: {
      subscriptionId: '22222222-2222-3333-8444-555555555555',
      creationOperationId: request.creationOperationId,
      planTermsOperationId: request.creationOperationId,
      clientId: CLIENT_ID,
      planName: request.planName,
      cycleCreditAmount: request.cycleCreditAmount,
      entitlements: request.entitlements,
      changeEffectivePolicy: request.changeEffectivePolicy,
      prorationPolicy: request.prorationPolicy,
      unusedCreditPolicy: request.unusedCreditPolicy,
      billingCycleAnchor: request.validFrom,
      status: 'active', validFrom: request.validFrom, validTo: request.validTo,
    },
    initialGrant: {
      grantId: '33333333-3333-4333-8333-555555555555',
      grantOperationId: '01991f20-2234-7abc-8abc-1234567890ab',
      ledgerEntryId: '44444444-4444-4444-8444-555555555555',
      planTermsOperationId: request.creationOperationId,
      planNameSnapshot: request.planName, entitlementsSnapshot: request.entitlements,
      grantType: 'billing_cycle', cycleStart: request.validFrom,
      cycleEnd: '2026-10-06T12:00:00.000000Z', creditAmount: request.cycleCreditAmount,
    },
    account: {
      creditAccountId: '11111111-2222-3333-4444-555555555555', clientId: CLIENT_ID,
      ownedBalance: '1260.0000', activelyReservedAmount: '0.0000',
      availableBalance: '1260.0000', status: 'active', asOf: '2026-09-06T12:00:01.000000Z',
    },
  }
}

async function fillValidSubscription() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Plan name'), 'Pro')
  await user.type(screen.getByLabelText('Cycle credit amount'), '1250.0000')
  await user.type(screen.getByLabelText('Requests per minute'), '60')
  await user.type(screen.getByLabelText('Concurrent AI operations'), '4')
  await user.click(screen.getByLabelText('Content generation'))
  await user.type(screen.getByLabelText('Valid from (UTC)'), new Date().toISOString().slice(0, 16))
  await user.click(screen.getByRole('button', { name: 'Review subscription' }))
  return user
}

describe('Billing subscription route and page state', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    authenticate()
  })

  it('renders creation only for an active configured account with no current subscription', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Subscriptions' })).toHaveFocus()
    expect(await screen.findByRole('heading', { name: 'Create subscription' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('complementary', { name: 'Primary navigation' }))
      .getByRole('link', { name: 'Billing' })).toBeInTheDocument()
  })

  it('renders current subscription read-only and hides creation controls', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(currentState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Current subscription' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Subscription lifecycle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause subscription' })).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create subscription' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create subscription/i })).not.toBeInTheDocument()
  })

  it('removes an open lifecycle confirmation on local permission revocation', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(currentState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Pause subscription' }))
    await user.type(screen.getByLabelText('Reason'), 'Private role-revocation reason')
    const existingUser = useAuthStore.getState().user
    if (!existingUser) throw new Error('Expected authenticated user')
    act(() => useAuthStore.getState().setUser({ ...existingUser, role: 'Viewer' }))
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Private role-revocation reason')).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
  })

  it('blocks creation when the account is missing or inactive', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    const accountRequest = vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_404', message: 'Credit account not configured', status: 404,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    const first = render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Credit account not configured' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Create subscription' })).not.toBeInTheDocument()

    first.unmount()
    queryClient.clear()
    accountRequest.mockResolvedValue(account('suspended'))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Subscription creation unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/account is suspended/i)).toBeInTheDocument()
  })

  it('canonicalizes a valid route and does not request invalid Client context', async () => {
    const stateRequest = vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID.toUpperCase()}/subscriptions`)
    const first = render(<App />)
    await screen.findByRole('heading', { name: 'Subscriptions' })
    expect(window.location.pathname).toBe(`/billing/clients/${CLIENT_ID}/subscriptions`)
    expect(stateRequest).toHaveBeenCalledTimes(1)

    first.unmount()
    queryClient.clear()
    stateRequest.mockClear()
    window.history.replaceState({}, '', '/billing/clients/not-a-guid/subscriptions')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Client context unavailable' })).toBeInTheDocument()
    expect(stateRequest).not.toHaveBeenCalled()
  })

  it('keeps direct navigation server-authoritative after local permission loss', async () => {
    authenticate('Viewer')
    const stateRequest = vi.spyOn(billingApi, 'getSubscriptionState').mockRejectedValue({
      code: 'HTTP_403', message: 'Insufficient permissions', status: 403,
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    })
    expect(stateRequest).toHaveBeenCalledWith(CLIENT_ID, { pageSize: 20 }, expect.any(AbortSignal))
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
  })

  it('queries direct navigation but hides creation when the local role lacks the mapped permission', async () => {
    authenticate('Viewer')
    const stateRequest = vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    const accountRequest = vi.spyOn(billingApi, 'getAccountSnapshot')
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(stateRequest).toHaveBeenCalledTimes(1)
    expect(accountRequest).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
  })

  it('disables creation when a fresh subscription precheck fails after safe cached state', async () => {
    const stateRequest = vi.spyOn(billingApi, 'getSubscriptionState')
      .mockResolvedValueOnce(emptyState())
      .mockRejectedValue(new Error('temporary failure'))
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    expect(await screen.findByLabelText('Plan name')).toBeEnabled()
    await queryClient.invalidateQueries({ queryKey: ['backoffice', 'private', 'billing', 'subscriptions'] })
    expect(await screen.findByRole('heading', { name: 'Fresh subscription state unavailable' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
    expect(stateRequest).toHaveBeenCalledTimes(3)
  })

  it('disables creation when a fresh account readiness check fails after a cached active account', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    const accountRequest = vi.spyOn(billingApi, 'getAccountSnapshot')
      .mockResolvedValueOnce(account())
      .mockRejectedValue(new Error('temporary failure'))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    expect(await screen.findByLabelText('Plan name')).toBeEnabled()
    await queryClient.invalidateQueries({ queryKey: [
      'backoffice', 'private', 'billing', 'account', CLIENT_ID,
    ] })
    expect(await screen.findByRole('heading', { name: 'Credit account readiness unavailable' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
    expect(accountRequest).toHaveBeenCalledTimes(3)
  })

  it('creates once and retains the immutable receipt separately from current state', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    const create = vi.spyOn(billingApi, 'createSubscription').mockImplementation(
      async (_clientId, request) => creationReceipt(request)
    )
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    await screen.findByRole('heading', { name: 'Create subscription' })
    const user = await fillValidSubscription()
    await user.dblClick(screen.getByRole('button', { name: 'Confirm creation' }))

    expect(await screen.findByRole('heading', { name: 'Created' })).toBeInTheDocument()
    expect(screen.getByText('Original balance outcome')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
    const sent = create.mock.calls[0]![1]
    expect(sent.creationOperationId).toMatch(/^........-....-7...-[89ab]...-............$/)
    expect(sent).not.toHaveProperty('clientId')
  })

  it('retains an unknown operation and offers only exact-body retry', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    const create = vi.spyOn(billingApi, 'createSubscription')
      .mockRejectedValueOnce(new Error('network disconnected'))
      .mockImplementationOnce(async (_clientId, request) => creationReceipt(request, false))
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    await screen.findByRole('heading', { name: 'Create subscription' })
    const user = await fillValidSubscription()
    await user.click(screen.getByRole('button', { name: 'Confirm creation' }))
    expect(await screen.findByRole('heading', { name: 'Outcome unknown' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry exact operation' }))
    expect(await screen.findByRole('heading', { name: 'Already completed' })).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]?.[1].creationOperationId).toBe(create.mock.calls[0]?.[1].creationOperationId)
    expect(create.mock.calls[1]?.[3]).toBe(create.mock.calls[0]?.[3])
  })

  it.each([
    [400, 'HTTP_400', 'Invalid subscription creation request'],
    [404, 'HTTP_404', 'Billing not configured'],
    [409, 'subscription_operation_conflict', 'Operation identity conflict'],
    [409, 'subscription_current_conflict', 'Current subscription conflict'],
    [409, 'credit_account_inactive', 'Credit account inactive'],
    [409, 'credit_balance_overflow', 'Credit balance capacity conflict'],
    [413, 'HTTP_413', 'Subscription request contract failure'],
    [415, 'HTTP_415', 'Subscription request contract failure'],
  ])('renders safe determinate outcome %s/%s', async (status, code, heading) => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    vi.spyOn(billingApi, 'createSubscription').mockRejectedValue({
      status, code, message: 'raw server detail must not be displayed',
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    await screen.findByRole('heading', { name: 'Create subscription' })
    const user = await fillValidSubscription()
    await user.click(screen.getByRole('button', { name: 'Confirm creation' }))
    const outcomeHeading = await screen.findByRole('heading', { name: heading })
    if (status === 400) {
      expect(screen.getByRole('alert', { name: 'Correct the subscription form' })).toHaveFocus()
    } else {
      expect(outcomeHeading).toHaveFocus()
    }
    expect(screen.queryByText('raw server detail must not be displayed')).not.toBeInTheDocument()
  })

  it('clears private state and creation controls on fresh POST authorization loss', async () => {
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(emptyState())
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(account())
    vi.spyOn(billingApi, 'createSubscription').mockRejectedValue({
      status: 403, code: 'HTTP_403', message: 'Insufficient permissions',
    })
    window.history.replaceState({}, '', `/billing/clients/${CLIENT_ID}/subscriptions`)
    render(<App />)
    await screen.findByRole('heading', { name: 'Create subscription' })
    const user = await fillValidSubscription()
    await user.click(screen.getByRole('button', { name: 'Confirm creation' }))
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
  })
})

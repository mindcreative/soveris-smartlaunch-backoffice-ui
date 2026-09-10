import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { billingApi } from '../../api/billingApi'
import type {
  BillingSubscriptionItem,
  BillingSubscriptionLifecycleReceipt,
  BillingSubscriptionState,
} from '../../types/billing'
import { SubscriptionLifecycleControls } from './SubscriptionLifecycleControls'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION_ID = '22222222-2222-3333-8444-555555555555'
const OPERATION_ID = '01991f20-5678-7abc-8abc-1234567890ab'

function item(overrides: Partial<BillingSubscriptionItem> = {}): BillingSubscriptionItem {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    creationOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    clientId: CLIENT_ID, planName: 'Pro', subscriptionTier: 'brand', tierRevision: '0',
    cycleCreditAmount: '99999999999999.9999',
    entitlements: {
      schemaVersion: 1,
      rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
      featureFlags: { contentGeneration: true, imageGeneration: true },
    },
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    billingCycleAnchor: '2026-09-01T00:00:00Z', status: 'active',
    validFrom: '2026-09-01T00:00:00Z', validTo: null,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function state(current: BillingSubscriptionItem | null = item()): BillingSubscriptionState {
  return {
    clientId: CLIENT_ID, stateAsOf: '2026-09-07T09:00:00Z', current,
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: '2026-09-07T09:00:00Z', nextCursor: null },
  }
}

const RECEIPT: BillingSubscriptionLifecycleReceipt = {
  lifecycleOperationId: OPERATION_ID, clientId: CLIENT_ID,
  subscriptionId: SUBSCRIPTION_ID, action: 'pause', previousStatus: 'active',
  status: 'paused', reason: 'Temporary administrative hold',
  effectiveAt: '2026-09-07T09:00:01Z', operationAsOf: '2026-09-07T09:00:01Z',
}

function ActiveSubscriptionObserver() {
  useQuery({
    queryKey: ['backoffice', 'private', 'billing', 'subscriptions', CLIENT_ID, 'state'],
    queryFn: ({ signal }) => billingApi.getSubscriptionState(CLIENT_ID, { pageSize: 20 }, signal),
    initialData: state(),
    staleTime: Infinity,
    retry: false,
  })
  return null
}

function renderControls(value = state()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const preflight = vi.fn().mockResolvedValue(value)
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionLifecycleControls
        clientId={CLIENT_ID}
        state={value}
        preflight={preflight}
        uuidFactory={() => OPERATION_ID}
      />
    </QueryClientProvider>
  )
  return {
    preflight,
    unmount: rendered.unmount,
    rerenderControls(next: BillingSubscriptionState) {
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <SubscriptionLifecycleControls
            clientId={CLIENT_ID}
            state={next}
            preflight={async () => next}
            uuidFactory={() => OPERATION_ID}
          />
        </QueryClientProvider>
      )
    },
  }
}

describe('SubscriptionLifecycleControls', () => {
  it('shows the exact active and due action matrices without terminal controls', () => {
    const { rerenderControls } = renderControls()
    expect(screen.getByRole('button', { name: 'Pause subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivate subscription' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expire subscription' })).not.toBeInTheDocument()

    const due = state(item({ validTo: '2026-09-07T09:00:00Z' }))
    rerenderControls(due)
    expect(screen.getByRole('button', { name: 'Expire subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause subscription' })).not.toBeInTheDocument()
  })

  it('runs an explicit authoritative refresh without creating an operation', async () => {
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
    const { preflight } = renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh lifecycle state' }))
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1))
    expect(post).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Authoritative lifecycle state refreshed')
  })

  it('labels and suppresses duplicate manual refresh while authority is pending', async () => {
    let resolve: ((value: BillingSubscriptionState) => void) | undefined
    const { preflight } = renderControls()
    preflight.mockImplementation(() => new Promise((next) => { resolve = next }))
    const user = userEvent.setup()
    const refresh = screen.getByRole('button', { name: 'Refresh lifecycle state' })
    await user.dblClick(refresh)
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Refreshing lifecycle state…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing authoritative lifecycle state')
    resolve?.(state())
    await waitFor(() => expect(screen.getByText('Authoritative lifecycle state refreshed.')).toBeVisible())
  })

  it('uses an accessible confirmation with safe dismissal and linked exact-reason errors', async () => {
    renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm Pause subscription' })
    expect(dialog).toHaveTextContent(CLIENT_ID)
    expect(dialog).toHaveTextContent(SUBSCRIPTION_ID)
    expect(dialog).toHaveTextContent('active → paused')
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Keep current status' })
      .find((button) => button.textContent === 'Keep current status')).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Confirm Pause' }))
    const reason = screen.getByLabelText('Reason')
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    const summary = screen.getByRole('alert')
    expect(summary).toHaveTextContent('Enter a reason')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.getByRole('link', { name: /Enter a reason/ })).toHaveAttribute('href', '#lifecycle-reason')
  })

  it('restores trigger focus on Escape and removes a pre-dispatch reason on auth teardown', async () => {
    renderControls()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Pause subscription' })
    await user.click(trigger)
    await user.type(screen.getByLabelText('Reason'), 'Private reason')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    expect(screen.getByLabelText('Reason')).toHaveValue('')
    await user.type(screen.getByLabelText('Reason'), 'Discard on logout')
    window.dispatchEvent(new CustomEvent('auth:cleared'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    expect(screen.getByLabelText('Reason')).toHaveValue('')
  })

  it('submits one confirmed operation and renders a neutral immutable receipt', async () => {
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockResolvedValue(RECEIPT)
    renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: RECEIPT.reason } })
    await user.click(screen.getByRole('button', { name: 'Confirm Pause' }))

    await screen.findByRole('heading', { name: 'Lifecycle operation completed' })
    expect(screen.getByText(OPERATION_ID)).toBeInTheDocument()
    expect(screen.getByText('active → paused')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Latest authoritative state as of/)).toHaveTextContent(state().stateAsOf)
    const heading = screen.getByRole('heading', { name: 'Lifecycle operation completed' })
    expect(heading).toHaveClass('focus-visible:ring-2')
    await user.click(screen.getByRole('button', { name: 'Continue with authoritative state' }))
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    expect(screen.getByLabelText('Reason')).toHaveValue('')
  })

  it('states the permanent grant consequence for Expire', async () => {
    renderControls(state(item({ validTo: '2026-09-07T09:00:00Z' })))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Expire subscription' }))
    expect(screen.getByText(/permanently stops future grants/)).toBeInTheDocument()
  })

  it('offers an authoritative refresh retry while retaining a valid receipt', async () => {
    const get = vi.spyOn(billingApi, 'getSubscriptionState')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(state(item({ status: 'paused' })))
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockResolvedValue(RECEIPT)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(['backoffice', 'private', 'billing', 'subscriptions', CLIENT_ID, 'state'], state())
    render(
      <QueryClientProvider client={queryClient}>
        <ActiveSubscriptionObserver />
        <SubscriptionLifecycleControls
          clientId={CLIENT_ID}
          state={state()}
          preflight={async () => state()}
          uuidFactory={() => OPERATION_ID}
        />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: RECEIPT.reason } })
    await user.click(screen.getByRole('button', { name: 'Confirm Pause' }))
    expect(await screen.findByRole('button', { name: 'Retry authoritative refresh' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry authoritative refresh' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with authoritative state' })).toBeVisible())
    expect(get).toHaveBeenCalledTimes(2)
    expect(screen.getByText(OPERATION_ID)).toBeVisible()
  })

  it('blocks replacement commands and offers exact retry after ambiguous reconciliation', async () => {
    vi.spyOn(billingApi, 'postSubscriptionLifecycle')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'disconnected' })
      .mockResolvedValueOnce(RECEIPT)
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(state(item({ status: 'paused' })))
    renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: RECEIPT.reason } })
    await user.click(screen.getByRole('button', { name: 'Confirm Pause' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry exact operation' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry exact operation' }))
    await screen.findByRole('heading', { name: 'Lifecycle operation completed' })
  })

  it.each([
    [400, 'HTTP_400', 'Invalid lifecycle request'],
    [404, 'HTTP_404', 'Subscription not found'],
    [409, 'subscription_lifecycle_operation_conflict', 'Operation identity conflict'],
    [409, 'subscription_lifecycle_state_conflict', 'Subscription state changed'],
    [409, 'subscription_lifecycle_transition_invalid', 'Lifecycle transition unavailable'],
    [409, 'subscription_expiration_not_due', 'Subscription expiration is not due'],
    [409, 'subscription_validity_ended', 'Subscription validity ended'],
    [413, 'HTTP_413', 'Lifecycle request too large'],
    [415, 'HTTP_415', 'Lifecycle media type rejected'],
  ])('renders sanitized determinate result %s/%s', async (status, code, heading) => {
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      status, code, message: 'raw private server material',
    })
    renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pause subscription' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: RECEIPT.reason } })
    await user.click(screen.getByRole('button', { name: 'Confirm Pause' }))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(post.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ reason: RECEIPT.reason }))
    expect(screen.queryByText('raw private server material')).not.toBeInTheDocument()
    expect(screen.getByText(RECEIPT.reason)).toBeInTheDocument()
  })
})

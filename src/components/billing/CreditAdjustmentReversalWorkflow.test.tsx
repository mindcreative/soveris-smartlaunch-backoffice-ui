import { createRef, StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as adjustmentApi from '../../api/billingAdjustmentApi'
import { billingApi } from '../../api/billingApi'
import { useAuthStore } from '../../stores/authStore'
import type {
  BillingAccountSnapshot,
  CreditAdjustmentFamily,
  CreditAdjustmentHistoryOriginalItem,
} from '../../types/billing'
import { CreditAdjustmentReversalWorkflow } from './CreditAdjustmentReversalWorkflow'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT_ID = '0199b9d2-a9b1-7000-8000-000000000002'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const ORIGINAL_ID = '0199b9d2-a9b1-7000-8000-000000000003'
const ORIGINAL: CreditAdjustmentHistoryOriginalItem = {
  schemaVersion: 1, clientId: CLIENT, creditAccountId: ACCOUNT_ID,
  operationId: '0199b9d2-a9b1-7000-8000-000000000001', adjustmentId: ORIGINAL_ID,
  ledgerId: '0199b9d2-a9b1-7000-8000-000000000004', operationType: 'original',
  amount: '-25.5000', reason: 'Original correction', performedBy: ACTOR,
  expectedWalletVersion: '12', walletVersionBefore: '12', walletVersionAfter: '13',
  beforeOwnedBalance: '100.0000', beforeReservedBalance: '20.0000',
  beforeAvailableBalance: '80.0000', afterOwnedBalance: '74.5000',
  afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000',
  operationAsOf: '2026-09-24T13:00:00.123456', originalAdjustmentId: null,
  reversalAdjustmentId: null,
}
const ACCOUNT: BillingAccountSnapshot = {
  clientId: CLIENT, creditAccountId: ACCOUNT_ID, ownedBalance: '74.5000',
  activelyReservedAmount: '20.0000', availableBalance: '54.5000',
  activeReservationCount: 1, status: 'active', asOf: '2026-09-24T14:00:00.123456',
  walletVersion: '13',
}
const FAMILY: CreditAdjustmentFamily = {
  original: ORIGINAL, reversal: null, asOf: '2026-09-24T14:00:01.123456',
}

function renderWorkflow(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } })
  const triggerRef = createRef<HTMLButtonElement>()
  const result = render(<QueryClientProvider client={queryClient}>
    <button ref={triggerRef}>History trigger</button>
    <CreditAdjustmentReversalWorkflow clientId={CLIENT} actorUserId={ACTOR}
      canAdjust canView selected={ORIGINAL} returnFocusRef={triggerRef} onClose={onClose} />
  </QueryClientProvider>)
  return { ...result, triggerRef, onClose }
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: {
    id: ACTOR, email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
    clientId: CLIENT, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
  } })
  vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
  vi.spyOn(adjustmentApi, 'getCreditAdjustmentFamily').mockResolvedValue(FAMILY)
})

describe('CreditAdjustmentReversalWorkflow', () => {
  it('opens from fresh reads with complete saved-time evidence and least-destructive focus', async () => {
    const user = userEvent.setup()
    const workflow = renderWorkflow()
    expect(screen.getByRole('status')).toHaveTextContent('Loading fresh reversal evidence')
    expect(await screen.findByRole('dialog', { name: 'Review adjustment reversal' }))
      .toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    for (const text of [
      `Selected Client ${CLIENT}`, ACCOUNT_ID, ORIGINAL_ID, 'Original correction',
      '2026-09-24 13:00:00.123456', '-25.5', '+25.5',
      '2026-09-24 14:00:00.123456', '2026-09-24 14:00:01.123456',
      'This appends one immutable compensating adjustment',
    ]) expect(screen.getByRole('dialog')).toHaveTextContent(text)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(workflow.onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(workflow.triggerRef.current).toHaveFocus())
  })

  it('focuses linked local reason errors and performs no confirm-time reads or UUID work', async () => {
    const user = userEvent.setup()
    renderWorkflow()
    await screen.findByRole('dialog')
    vi.mocked(billingApi.getAccountSnapshot).mockClear()
    vi.mocked(adjustmentApi.getCreditAdjustmentFamily).mockClear()
    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByRole('link', { name: /Reversal reason/ })).toHaveAttribute(
      'href', expect.stringMatching(/^#/))
    expect(billingApi.getAccountSnapshot).not.toHaveBeenCalled()
    expect(adjustmentApi.getCreditAdjustmentFamily).not.toHaveBeenCalled()
  })

  it('keeps the modal open and requires re-review when confirm-time evidence changes', async () => {
    vi.mocked(billingApi.getAccountSnapshot)
      .mockResolvedValueOnce(ACCOUNT)
      .mockResolvedValueOnce({ ...ACCOUNT, walletVersion: '14' })
    renderWorkflow()
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Reversal reason'), {
      target: { value: 'Compensate correction' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))
    expect(await screen.findByText(/Financial evidence changed/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not activate for view-only actors', async () => {
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}>
      <CreditAdjustmentReversalWorkflow clientId={CLIENT} actorUserId={ACTOR}
        canAdjust={false} canView selected={ORIGINAL} returnFocusRef={createRef()} onClose={vi.fn()} />
    </QueryClientProvider>)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(billingApi.getAccountSnapshot).not.toHaveBeenCalled()
  })

  it('single-flights Strict Mode activation and supports native Enter confirmation', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<StrictMode><QueryClientProvider client={queryClient}>
      <CreditAdjustmentReversalWorkflow clientId={CLIENT} actorUserId={ACTOR}
        canAdjust canView selected={ORIGINAL} returnFocusRef={createRef()} onClose={vi.fn()} />
    </QueryClientProvider></StrictMode>)
    await screen.findByRole('dialog')
    expect(billingApi.getAccountSnapshot).toHaveBeenCalledOnce()
    expect(adjustmentApi.getCreditAdjustmentFamily).toHaveBeenCalledOnce()
    screen.getByRole('button', { name: 'Confirm reversal' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })
})

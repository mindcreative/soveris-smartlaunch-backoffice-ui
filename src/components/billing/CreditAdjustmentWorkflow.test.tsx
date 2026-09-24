import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as adjustmentApi from '../../api/billingAdjustmentApi'
import { billingApi } from '../../api/billingApi'
import { creditAdjustmentRecoveryStore } from '../../stores/creditAdjustmentRecoveryStore'
import type { BillingAccountSnapshot, CreditAdjustmentPreview, CreditAdjustmentReceipt } from '../../types/billing'
import { CreditAdjustmentWorkflow } from './CreditAdjustmentWorkflow'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const AT = '2026-09-24T12:00:00.123456Z'
const SNAPSHOT: BillingAccountSnapshot = {
  creditAccountId: ACCOUNT_ID, clientId: CLIENT, ownedBalance: '100.0000',
  activelyReservedAmount: '20.0000', availableBalance: '80.0000', activeReservationCount: 1,
  status: 'active', asOf: '2026-09-24T12:00:00.000000', walletVersion: '12',
}
const PREVIEW: CreditAdjustmentPreview = {
  schemaVersion: 1, clientId: CLIENT, creditAccountId: ACCOUNT_ID, walletVersion: '12', asOf: AT,
  amount: '-25.5000', reason: 'Correct duplicate allocation', currentOwnedBalance: '100.0000',
  currentReservedBalance: '20.0000', currentAvailableBalance: '80.0000',
  projectedOwnedBalance: '74.5000', projectedReservedBalance: '20.0000',
  projectedAvailableBalance: '54.5000', maximumSafeDebit: '80.0000',
  minimumAllowedAmount: '-80.0000', walletInvariantEligible: true, ineligibilityCode: null,
}
const RECEIPT: CreditAdjustmentReceipt = {
  schemaVersion: 1, operationId: '0199b9d2-a9b1-7000-8000-000000000001',
  adjustmentId: '0199b9d2-a9b1-7000-8000-000000000003',
  ledgerId: '0199b9d2-a9b1-7000-8000-000000000004', clientId: CLIENT,
  creditAccountId: ACCOUNT_ID, amount: '-25.5000', reason: 'Correct duplicate allocation',
  performedBy: ACTOR, walletVersionBefore: '12', walletVersionAfter: '13',
  beforeOwnedBalance: '100.0000', beforeReservedBalance: '20.0000',
  beforeAvailableBalance: '80.0000', afterOwnedBalance: '74.5000',
  afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000', operationAsOf: AT,
}

function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } })}>{children}</QueryClientProvider>
}

function renderWorkflow() {
  return render(<CreditAdjustmentWorkflow clientId={CLIENT} snapshot={SNAPSHOT}
    accountDataUpdatedAt={1} actorUserId={ACTOR} />, { wrapper: Wrapper })
}

afterEach(() => {
  vi.restoreAllMocks()
  creditAdjustmentRecoveryStore.clearForTests()
})

describe('CreditAdjustmentWorkflow', () => {
  it('focuses linked validation errors and preserves the other field while correcting', async () => {
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    const reason = screen.getByLabelText('Reason')
    await user.type(reason, 'Correction')
    await user.click(screen.getByRole('button', { name: 'Preview adjustment' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByText('Enter a non-zero signed amount.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /Adjustment amount/ }))
    expect(screen.getByLabelText('Adjustment amount')).toHaveFocus()
    expect(reason).toHaveValue('Correction')
  })

  it('opens one named modal with exact evidence, Cancel focus, Escape restore, and preserved values', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    await user.type(screen.getByLabelText('Adjustment amount'), '-25.5000')
    await user.type(screen.getByLabelText('Reason'), 'Correct duplicate allocation')
    const trigger = screen.getByRole('button', { name: 'Preview adjustment' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Confirm credit adjustment' })
    expect(within(dialog).getByText(CLIENT)).toBeInTheDocument()
    expect(within(dialog).getByText(ACCOUNT_ID)).toBeInTheDocument()
    expect(within(dialog).getByText('-25.5000')).toBeInTheDocument()
    expect(within(dialog).getByText('Correct duplicate allocation')).toBeInTheDocument()
    expect(within(dialog).getAllByText('20.0000').length).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    expect(dialog).not.toHaveTextContent(/\$|USD|currency/i)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.getByLabelText('Adjustment amount')).toHaveValue('-25.5000')
    expect(screen.getByLabelText('Reason')).toHaveValue('Correct duplicate allocation')
  })

  it('renders ineligible guidance and never enables confirmation', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue({
      ...PREVIEW, amount: '-80.0001', projectedOwnedBalance: '19.9999',
      projectedAvailableBalance: '-0.0001', walletInvariantEligible: false,
      ineligibilityCode: 'insufficient_available_credits',
    })
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    await user.type(screen.getByLabelText('Adjustment amount'), '-80.0001')
    await user.type(screen.getByLabelText('Reason'), 'Correct duplicate allocation')
    await user.click(screen.getByRole('button', { name: 'Preview adjustment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm credit adjustment' })
    expect(within(dialog).getByText(/not eligible/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Confirm adjustment' })).toBeDisabled()
  })

  it('locks every modal exit and announces confirm-time progress', async () => {
    let release: ((preview: CreditAdjustmentPreview) => void) | undefined
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment')
      .mockResolvedValueOnce(PREVIEW)
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    await user.type(screen.getByLabelText('Adjustment amount'), '-25.5000')
    await user.type(screen.getByLabelText('Reason'), 'Correct duplicate allocation')
    await user.click(screen.getByRole('button', { name: 'Preview adjustment' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm adjustment' }))
    expect(screen.getByRole('status')).toHaveTextContent(/revalidating/i)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close confirmation' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { release?.({ ...PREVIEW, walletVersion: '13' }) })
  })

  it('does not claim the authoritative refresh completed while it is still pending', async () => {
    let releaseAccount: ((snapshot: BillingAccountSnapshot) => void) | undefined
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockResolvedValue(RECEIPT)
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockResolvedValue({
      items: [], asOf: AT, nextCursor: null,
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockImplementation(() =>
      new Promise((resolve) => { releaseAccount = resolve }))
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    await user.type(screen.getByLabelText('Adjustment amount'), '-25.5000')
    await user.type(screen.getByLabelText('Reason'), 'Correct duplicate allocation')
    await user.click(screen.getByRole('button', { name: 'Preview adjustment' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm adjustment' }))

    expect(await screen.findByText(/Receipt validated\. Refreshing the authoritative Account/i))
      .toBeInTheDocument()
    expect(screen.queryByText('The authoritative Account refresh completed.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start another adjustment' })).not.toBeInTheDocument()

    await act(async () => { releaseAccount?.(SNAPSHOT) })
    expect(await screen.findByText('The authoritative Account refresh completed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start another adjustment' })).toBeInTheDocument()
  })

  it('focuses linked field recovery when the server rejects preview validation', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockRejectedValue({
      status: 400, code: 'invalid_credit_adjustment_preview', message: 'Invalid preview',
    })
    const user = userEvent.setup()
    renderWorkflow()
    await user.click(screen.getByRole('button', { name: 'Adjust credits' }))
    await user.type(screen.getByLabelText('Adjustment amount'), '-25.5000')
    await user.type(screen.getByLabelText('Reason'), 'Correct duplicate allocation')

    await user.click(screen.getByRole('button', { name: 'Preview adjustment' }))

    await waitFor(() => expect(screen.getByText(
      'Review the exact amount accepted by the server.'
    )).toBeInTheDocument())
    expect(screen.getAllByRole('alert')[0]).toHaveFocus()
    await user.click(screen.getByRole('link', { name: /Adjustment amount/ }))
    expect(screen.getByLabelText('Adjustment amount')).toHaveFocus()
  })
})

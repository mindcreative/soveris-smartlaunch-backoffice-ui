import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CreditAdjustmentHistoryItem } from '../../types/billing'
import { AdjustmentHistoryResults } from './AdjustmentHistoryResults'

const ORIGINAL_ID = '0199c000-0000-7000-8000-000000000001'
const REVERSAL_ID = '0199c000-0000-7000-8000-000000000002'
const UNLINKED_ID = '0199c000-0000-7000-8000-000000000003'

function historyItem(overrides: Partial<CreditAdjustmentHistoryItem>): CreditAdjustmentHistoryItem {
  return {
    schemaVersion: 1,
    clientId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    creditAccountId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    operationId: '0199c000-0000-7000-8000-000000000010',
    adjustmentId: ORIGINAL_ID,
    ledgerId: '0199c000-0000-7000-8000-000000000020',
    amount: '123456789012345678.123456789012345678',
    reason: `Persisted operator reason ${'without truncation '.repeat(20)}`,
    performedBy: 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa',
    expectedWalletVersion: '40',
    walletVersionBefore: '40',
    walletVersionAfter: '41',
    beforeOwnedBalance: '1000.000000000000000000',
    beforeReservedBalance: '25.000000000000000000',
    beforeAvailableBalance: '975.000000000000000000',
    afterOwnedBalance: '124456789012346678.123456789012345678',
    afterReservedBalance: '25.000000000000000000',
    afterAvailableBalance: '124456789012346653.123456789012345678',
    operationAsOf: '2026-09-24T08:09:10.123456',
    operationType: 'original',
    originalAdjustmentId: null,
    reversalAdjustmentId: REVERSAL_ID,
    ...overrides,
  } as CreditAdjustmentHistoryItem
}

const items: CreditAdjustmentHistoryItem[] = [
  historyItem({}),
  historyItem({
    operationId: '0199c000-0000-7000-8000-000000000011',
    adjustmentId: REVERSAL_ID,
    ledgerId: '0199c000-0000-7000-8000-000000000021',
    amount: '-123456789012345678.123456789012345678',
    reason: 'Compensating reversal evidence',
    expectedWalletVersion: '41', walletVersionBefore: '41', walletVersionAfter: '42',
    beforeOwnedBalance: '124456789012346678.123456789012345678',
    beforeReservedBalance: '25.000000000000000000',
    beforeAvailableBalance: '124456789012346653.123456789012345678',
    afterOwnedBalance: '1000.000000000000000000',
    afterReservedBalance: '25.000000000000000000',
    afterAvailableBalance: '975.000000000000000000',
    operationAsOf: '2026-09-24T08:10:11.654321',
    operationType: 'reversal', originalAdjustmentId: ORIGINAL_ID,
    reversalAdjustmentId: null,
  }),
  historyItem({
    operationId: '0199c000-0000-7000-8000-000000000012',
    adjustmentId: UNLINKED_ID,
    ledgerId: '0199c000-0000-7000-8000-000000000022',
    amount: '0.000000000000000001', reason: 'Independent original',
    operationAsOf: '2026-09-24T08:11:12.000001',
    operationType: 'original', originalAdjustmentId: null, reversalAdjustmentId: null,
  }),
]

describe('AdjustmentHistoryResults', () => {
  it('uses a native, captioned six-column evidence table with scoped headers', () => {
    render(<AdjustmentHistoryResults items={items} />)
    const table = screen.getByRole('table', {
      name: 'Newest-first immutable Billing adjustment history',
    })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Time', 'Type and relationship', 'Signed credits', 'Reason and actor',
      'Balances before and after', 'Immutable identifiers and wallet versions',
    ])
    for (const header of within(table).getAllByRole('columnheader'))
      expect(header).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('region', { name: 'Scrollable adjustment history table' }))
      .toHaveAttribute('tabindex', '0')
  })

  it('renders all immutable evidence, exact signed quantities and relationship states', () => {
    const { container } = render(<AdjustmentHistoryResults items={items} />)
    const original = container.querySelector(`tr[data-adjustment-id="${ORIGINAL_ID}"]`)
    expect(original).not.toBeNull()
    const row = within(original as HTMLElement)
    for (const evidence of [
      'Schema version: 1', 'Client ID: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'Credit account ID: bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      'Operation ID: 0199c000-0000-7000-8000-000000000010',
      `Adjustment ID: ${ORIGINAL_ID}`,
      'Ledger ID: 0199c000-0000-7000-8000-000000000020',
      'Expected wallet version: 40', 'Wallet version before: 40', 'Wallet version after: 41',
      '2026-09-24 08:09:10.123456',
    ]) expect(row.getByText(evidence)).toBeInTheDocument()
    expect(row.getByText((_, element) => element?.tagName === 'P' &&
      element.textContent === 'Performed by: cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'))
      .toBeInTheDocument()
    expect(row.getByText('+123,456,789,012,345,678.123456789012345678')).toBeInTheDocument()
    for (const balance of ['Owned before', 'Reserved before', 'Available before',
      'Owned after', 'Reserved after', 'Available after'])
      expect(row.getByText(new RegExp(`^${balance}:`))).toBeInTheDocument()
    expect(row.getByText(`Reversed by ${REVERSAL_ID}`)).toBeInTheDocument()
    expect(screen.getAllByText(`Reversal of ${ORIGINAL_ID}`).length).toBeGreaterThan(0)
    expect(screen.getAllByText('No linked reversal in this snapshot').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-123,456,789,012,345,678.123456789012345678').length)
      .toBeGreaterThan(0)
  })

  it('provides equivalent narrow cards, long-content protection and no money or mutation actions', () => {
    const { container } = render(<AdjustmentHistoryResults items={items} />)
    const list = screen.getByRole('list', {
      name: 'Newest-first immutable Billing adjustment history',
    })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(container.querySelectorAll(`[data-adjustment-id="${ORIGINAL_ID}"]`)).toHaveLength(2)
    expect(within(list).getByText(/Persisted operator reason without truncation/))
      .toHaveClass('break-words')
    expect(container.querySelector('.select-text.break-all.font-mono')).not.toBeNull()
    expect(screen.getAllByText(/Corrections are recorded as separate compensating rows/).length)
      .toBeGreaterThan(0)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent(/\b(?:currency|revenue|money|eligible|edit(?:ed)?|delet(?:e|ed)|replac(?:e|ed))\b/i)
  })
})

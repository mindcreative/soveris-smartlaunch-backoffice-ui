import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AdjustmentHistoryFilters,
  EMPTY_ADJUSTMENT_HISTORY_FILTER_DRAFT,
  normalizeAdjustmentHistoryFilterDraft,
  type AdjustmentHistoryFilterDraft,
} from './AdjustmentHistoryFilters'

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const UUID_V7 = '0199c000-0000-7000-8000-000000000001'

function draft(overrides: Partial<AdjustmentHistoryFilterDraft>): AdjustmentHistoryFilterDraft {
  return { ...EMPTY_ADJUSTMENT_HISTORY_FILTER_DRAFT, ...overrides }
}

describe('adjustment history filter normalization', () => {
  it('normalizes exact local bounds, UUID kinds, enum and page size into a stable shape', () => {
    expect(normalizeAdjustmentHistoryFilterDraft(draft({
      from: '2026-09-24T08:00', to: '2026-09-24T09:00:00.1',
      actorUserId: ` ${UUID.toUpperCase()} `, reason: 'Exact persisted reason',
      operationId: ` ${UUID_V7.toUpperCase()} `,
      originalAdjustmentId: UUID_V7, reversalAdjustmentId: UUID_V7,
      operationType: 'original', pageSize: ' 20 ',
    }))).toEqual({
      filters: {
        from: '2026-09-24T08:00:00.000000', to: '2026-09-24T09:00:00.100000',
        actorUserId: UUID, reason: 'Exact persisted reason', operationId: UUID_V7,
        originalAdjustmentId: UUID_V7, reversalAdjustmentId: UUID_V7,
        operationType: 'original', pageSize: '20',
      }, errors: {},
    })
  })

  it('rejects UUID kind, nil actor, range, reason and page-size boundaries without a partial result', () => {
    const result = normalizeAdjustmentHistoryFilterDraft(draft({
      from: '2026-09-24T10:00', to: '2026-09-24T09:00',
      actorUserId: '00000000-0000-0000-0000-000000000000',
      operationId: UUID, originalAdjustmentId: 'bad',
      reason: ' leading', pageSize: '01', operationType: 'unsupported',
    }))
    expect(result.filters).toBeUndefined()
    expect(result.errors).toEqual(expect.objectContaining({
      range: expect.any(String), actorUserId: expect.any(String), operationId: expect.any(String),
      originalAdjustmentId: expect.any(String), reason: expect.any(String),
      pageSize: expect.any(String), operationType: expect.any(String),
    }))
    expect(normalizeAdjustmentHistoryFilterDraft(draft({ reason: '😀'.repeat(513) })).filters)
      .toBeUndefined()
    expect(normalizeAdjustmentHistoryFilterDraft(draft({ reason: 'line\nbreak' })).filters)
      .toBeUndefined()
    expect(normalizeAdjustmentHistoryFilterDraft(draft({ reason: '\uD800' })).filters)
      .toBeUndefined()
  })
})

describe('AdjustmentHistoryFilters', () => {
  it('keeps drafts private, applies normalized values, and clears with heading focus', async () => {
    const onApply = vi.fn()
    const onClear = vi.fn()
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<AdjustmentHistoryFilters appliedFiltersActive busy={false}
      onApply={onApply} onClear={onClear} />)

    fireEvent.change(screen.getByLabelText('Exact reason'), {
      target: { value: 'A & B' },
    })
    fireEvent.change(screen.getByLabelText('From (your saved timezone, inclusive)'), {
      target: { value: '2026-09-24T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(onApply).toHaveBeenCalledWith({
      from: '2026-09-24T08:00:00.000000', reason: 'A & B',
    })
    expect(storage).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Exact reason')).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('heading', {
      name: 'Filter adjustment history',
    })).toHaveFocus())
  })

  it('focuses a linked summary for local and server DST errors while retaining drafts', async () => {
    const { rerender } = render(<AdjustmentHistoryFilters appliedFiltersActive={false}
      busy={false} onApply={vi.fn()} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Operation ID'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    const summary = screen.getByRole('alert')
    await waitFor(() => expect(summary).toHaveFocus())
    fireEvent.click(screen.getByRole('link', { name: /Operation ID/ }))
    expect(screen.getByLabelText('Operation ID')).toHaveFocus()

    fireEvent.change(screen.getByLabelText('From (your saved timezone, inclusive)'), {
      target: { value: '2026-10-25T02:30' },
    })
    rerender(<AdjustmentHistoryFilters appliedFiltersActive={false} busy={false}
      onApply={vi.fn()} onClear={vi.fn()} serverFieldError={{
        field: 'from', message: 'Choose an unambiguous local time.',
      }} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByLabelText('From (your saved timezone, inclusive)'))
      .toHaveValue('2026-10-25T02:30')
    fireEvent.click(screen.getByRole('link', { name: /From/ }))
    expect(screen.getByLabelText('From (your saved timezone, inclusive)')).toHaveFocus()
  })

  it('exposes exact microsecond controls, closed choices, associations and 44px targets', () => {
    render(<AdjustmentHistoryFilters appliedFiltersActive={false} busy={false}
      onApply={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByLabelText('From (your saved timezone, inclusive)')).toHaveAttribute(
      'step', '0.000001')
    expect(screen.getByLabelText('Operation type')).toHaveTextContent('All operation types')
    expect(screen.getByLabelText('Page size')).toHaveTextContent('Server default (20)')
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveClass('min-h-11')
  })
})

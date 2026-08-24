import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEDGER_FILTER_DRAFT,
  normalizeLedgerFilterDraft,
  type LedgerFilterDraft,
} from './LedgerFilters'

const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function draft(overrides: Partial<LedgerFilterDraft>): LedgerFilterDraft {
  return { ...EMPTY_LEDGER_FILTER_DRAFT, ...overrides }
}

describe('normalizeLedgerFilterDraft', () => {
  it('trims and canonicalizes identifiers, enum, and bounded page size', () => {
    expect(normalizeLedgerFilterDraft(draft({
      creditAccountId: ` ${GUID.toUpperCase()} `,
      transactionType: ' PROMOTION ',
      pageSize: '100',
    }))).toEqual({
      filters: { creditAccountId: GUID, transactionType: 'promotion', pageSize: 100 },
      errors: {},
    })
  })

  it('converts local date-time values into explicit UTC instants', () => {
    const result = normalizeLedgerFilterDraft(draft({
      from: '2026-08-24T08:00',
      to: '2026-08-24T09:00',
    }))
    expect(result.errors).toEqual({})
    expect(result.filters?.from).toMatch(/^2026-08-24T\d{2}:00:00\.000Z$/)
    expect(result.filters?.to).toMatch(/^2026-08-24T\d{2}:00:00\.000Z$/)
  })

  it('rejects invalid GUIDs, page bounds, and a non-increasing range without losing draft data', () => {
    const result = normalizeLedgerFilterDraft(draft({
      actorUserId: 'bad', pageSize: '101', from: '2026-08-24T10:00', to: '2026-08-24T09:00',
    }))
    expect(result.filters).toBeUndefined()
    expect(result.errors).toEqual(expect.objectContaining({
      actorUserId: expect.any(String), pageSize: expect.any(String), range: expect.any(String),
    }))
  })
})

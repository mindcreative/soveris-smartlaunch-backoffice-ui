import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ResourceAccessConsequence } from '../../types/billing'
import { ResourceAccessConsequenceTimeline } from './ResourceAccessConsequenceTimeline'

const AT = '2026-09-20T12:00:00.000000Z'

function consequence(
  consequenceKind: ResourceAccessConsequence['consequenceKind'],
  index: number
): ResourceAccessConsequence {
  return {
    consequenceId: `33333333-2222-4333-8444-55555555555${index}`,
    projectionRunId: `44444444-2222-4333-8444-55555555555${index}`,
    projectionRevision: String(index + 1),
    causeIdentity: `cause-${index}`,
    consequenceKind,
    lossAt: AT,
    accessUntil: '2026-09-27T12:00:00.000000Z',
    earliestProofExpiry: null,
    retainedCount: 1,
    totalCount: 3,
    graceCount: consequenceKind === 'suspended' ? 0 : 2,
    suspendedCount: consequenceKind === 'suspended' ? 2 : 0,
    affectedResources: [],
    affectedResourcesTruncated: false,
    deadlineGroups: consequenceKind === 'suspended' ? [] : [{
      accessUntil: '2026-09-27T12:00:00.000000Z', graceCount: 2,
    }],
    deadlineGroupsTruncated: false, unlistedGraceCount: 0,
    suspensionGroups: consequenceKind === 'suspended' ? [{
      accessUntil: '2026-09-27T12:00:00.000000Z', suspendedCount: 2,
      reason: 'finite_limit',
    }] : [], unlistedSuspendedCount: 0,
    restoredCount: null, restoredAt: null,
    reminders: [],
    preservationFacts: {
      contentPreserved: true,
      assetsPreserved: true,
      ownershipPreserved: true,
      tlsEvidencePreserved: true,
      financialEffectsPreserved: true,
    },
    recordedAt: AT,
  }
}

describe('ResourceAccessConsequenceTimeline', () => {
  it('keeps different persisted grace deadlines with their own counts', () => {
    render(<ResourceAccessConsequenceTimeline consequences={[{
      ...consequence('grace_started', 0),
      deadlineGroups: [
        { accessUntil: '2026-09-22T12:00:00.000000Z', graceCount: 1 },
        { accessUntil: '2026-09-27T12:00:00.000000Z', graceCount: 1 },
      ],
    }]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText(/policy grace deadline for 1 affected resource is 2026-09-22.*policy grace deadline for 1 affected resource is 2026-09-27/)).toBeInTheDocument()
  })

  it('uses approved restoration facts and cause-specific suspension copy', () => {
    render(<ResourceAccessConsequenceTimeline consequences={[
      { ...consequence('restored', 0), restoredCount: 1, restoredAt: AT },
      { ...consequence('suspended', 1), suspensionGroups: [{
        accessUntil: '2026-09-27T12:00:00.000000Z', suspendedCount: 1,
        reason: 'routing_inactive',
      }] },
    ]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText(/1 affected resource regained eligibility at.*Resources with current ownership, TLS, and routing evidence were restored/)).toBeInTheDocument()
    expect(screen.getByText(/1 affected resource was suspended at.*because routing is inactive/)).toBeInTheDocument()
    expect(screen.queryByText(/policy limits were exceeded/)).not.toBeInTheDocument()
  })

  it('uses the fired reminder deadline and count for approved reminder copy', () => {
    render(<ResourceAccessConsequenceTimeline consequences={[{
      ...consequence('grace_started', 0),
      reminders: [{ reminderKind: 'reminder_24h',
        dueAt: '2026-09-26T12:00:00.000000Z',
        recordedAt: '2026-09-26T12:00:00.000000Z', graceCount: 1,
        earliestProofExpiry: null }],
    }]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText(/24 hours remain before the policy grace deadline for 1 over-limit affected resource/)).toBeInTheDocument()
  })

  it('uses the actual recorded time when a reminder worker runs late', () => {
    render(<ResourceAccessConsequenceTimeline consequences={[{
      ...consequence('grace_started', 0),
      reminders: [{ reminderKind: 'reminder_72h',
        dueAt: '2026-09-24T12:00:00.000000Z',
        recordedAt: '2026-09-25T12:00:00.000000Z', graceCount: 1,
        earliestProofExpiry: null }],
    }]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText(/48 hours remain before the policy grace deadline/)).toBeInTheDocument()
  })

  it('keeps persisted policy and proof deadlines distinct in history and reminder copy', () => {
    const proofExpiresAt = '2026-09-26T18:00:00.000000Z'
    render(<ResourceAccessConsequenceTimeline consequences={[{
      ...consequence('grace_started', 0), earliestProofExpiry: proofExpiresAt,
      reminders: [{ reminderKind: 'reminder_24h',
        dueAt: '2026-09-26T12:00:00.000000Z',
        recordedAt: '2026-09-26T12:00:00.000000Z', graceCount: 1,
        earliestProofExpiry: proofExpiresAt }],
    }]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText(/policy grace deadline for 2 affected resources is 2026-09-27/)).toBeInTheDocument()
    expect(screen.getAllByText(/Earliest known ownership or TLS proof expiry.*2026-09-26T18:00:00/)).toHaveLength(2)
    expect(screen.getByText(/24 hours remain before the policy grace deadline.*may stop serving earlier.*2026-09-26T18:00:00/)).toBeInTheDocument()
    expect(screen.queryByText(/routes/)).not.toBeInTheDocument()
  })

  it('renders factual copy for every persisted consequence kind', () => {
    render(<ResourceAccessConsequenceTimeline
      consequences={[
        consequence('scheduled', 0),
        consequence('grace_started', 1),
        consequence('suspended', 2),
        consequence('restored', 3),
        consequence('cancelled', 4),
      ]}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
    />)

    expect(screen.getByText(/access change was scheduled/i)).toBeInTheDocument()
    expect(screen.getByText(/Your access policy changed at.*New paid work is unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/2 affected resources were suspended at.*current policy limits were exceeded/)).toBeInTheDocument()
    expect(screen.getByText(/access was restored/i)).toBeInTheDocument()
    expect(screen.getByText(/scheduled access consequence was cancelled/i)).toBeInTheDocument()
    expect(screen.getAllByText('1 of 3')).toHaveLength(5)
  })

  it('keeps loading, empty, and invalid-history states distinct', () => {
    const retry = vi.fn()
    const { rerender } = render(<ResourceAccessConsequenceTimeline
      consequences={undefined}
      isLoading
      error={null}
      onRetry={retry}
    />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading consequence history')

    rerender(<ResourceAccessConsequenceTimeline
      consequences={[]}
      isLoading={false}
      error={null}
      onRetry={retry}
    />)
    expect(screen.getByText('No persisted consequence events are present.')).toBeInTheDocument()

    rerender(<ResourceAccessConsequenceTimeline
      consequences={undefined}
      isLoading={false}
      error={new Error('private detail')}
      onRetry={retry}
    />)
    expect(screen.getByRole('alert')).toHaveTextContent('could not be validated')
    expect(screen.queryByText('private detail')).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(retry).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 404])('hides cached consequence facts on %s', (status) => {
    render(<ResourceAccessConsequenceTimeline consequences={[consequence('grace_started', 0)]}
      isLoading={false} error={{ status }} onRetry={vi.fn()} />)
    expect(screen.queryByText(/Your access policy changed at/)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('could not be validated')
  })
})

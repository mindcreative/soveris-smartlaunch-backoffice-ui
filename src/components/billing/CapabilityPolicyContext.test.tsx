import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClientCapabilities } from '../../types/billing'
import { CapabilityPolicyContext } from './CapabilityPolicyContext'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CAPABILITIES: ClientCapabilities = {
  clientId: CLIENT,
  classificationSource: 'back_office.clients',
  classification: 'customer',
  classificationRevision: '5',
  policySource: 'customer_subscription',
  policyVersion: 'input-04-v1',
  subscription: {
    storedTier: 'brand', effectiveTier: 'basic', status: 'active', tierRevision: '7',
    validFrom: '2026-09-01T00:00:00.000000Z', validTo: null,
  },
  flags: [{ key: 'analytics', enabled: true }],
  limits: [{ key: 'active_products', unit: 'count', value: '5' }],
  usage: [{ key: 'active_products', unit: 'count', value: '2', measuredAt: '2026-09-20T12:00:00.000000Z' }],
  operations: [{
    key: 'analytics', outcome: 'eligible', permission: 'satisfied', feature: 'satisfied',
    entitlement: 'not_applicable', resourceLimit: 'satisfied', provider: 'not_applicable',
    pricing: 'not_applicable', funding: 'not_applicable', denialConditions: [],
  }],
  evaluatedAt: '2026-09-20T12:00:00.000000Z',
  nextBoundary: '2026-09-30T08:30:00.000000Z',
}

describe('CapabilityPolicyContext', () => {
  it('renders separate source-labelled read-only policy evidence without wallet values or controls', () => {
    render(<CapabilityPolicyContext
      clientId={CLIENT} capabilities={CAPABILITIES} isLoading={false}
      isFetching={false} error={null} onRetry={() => undefined}
    />)
    expect(screen.getByRole('heading', { name: 'Capability and policy source' })).toBeVisible()
    expect(screen.getByText('back_office.clients')).toBeVisible()
    expect(screen.getByText('customer_subscription')).toBeVisible()
    expect(screen.getByText('input-04-v1')).toBeVisible()
    expect(screen.getByText('brand')).toBeVisible()
    expect(screen.getByText('basic')).toBeVisible()
    expect(screen.getAllByText('analytics').some((item) => item.closest('li')?.textContent?.includes('enabled')))
      .toBe(true)
    expect(screen.getByText('active_products').closest('li')).toHaveTextContent('2 / 5 count')
    expect(screen.queryByText(/available balance|owned balance/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('fails closed on permission error and offers retry for transient validation failure', async () => {
    const retry = vi.fn()
    const { rerender } = render(<CapabilityPolicyContext
      clientId={CLIENT} isLoading={false} isFetching={false}
      error={{ status: 403 }} onRetry={retry}
    />)
    expect(screen.getByRole('alert')).toHaveTextContent('not permitted')
    expect(screen.queryByRole('button', { name: 'Retry policy context' })).not.toBeInTheDocument()

    rerender(<CapabilityPolicyContext
      clientId={CLIENT} isLoading={false} isFetching={false}
      error={new Error('offline')} onRetry={retry}
    />)
    await userEvent.click(screen.getByRole('button', { name: 'Retry policy context' }))
    expect(retry).toHaveBeenCalledTimes(1)

    rerender(<CapabilityPolicyContext
      clientId={CLIENT} isLoading={false} isFetching={false}
      error={{ status: 503 }} onRetry={retry}
    />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Usage and operation decisions are unavailable. Tier changes use separate fresh subscription and server preview checks.'
    )
  })

  it('never renders evidence belonging to a different Client', () => {
    render(<CapabilityPolicyContext
      clientId="ffffffff-1111-2222-8333-444444444444" capabilities={CAPABILITIES}
      isLoading={false} isFetching={false} error={null} onRetry={() => undefined}
    />)
    expect(screen.queryByText('customer_subscription')).not.toBeInTheDocument()
  })

  it.each([401, 403, 404])('hides cached private policy facts on %s', (status) => {
    render(<CapabilityPolicyContext
      clientId={CLIENT} capabilities={CAPABILITIES} isLoading={false}
      isFetching={false} error={{ status }} onRetry={() => undefined}
    />)
    expect(screen.queryByText('customer_subscription')).not.toBeInTheDocument()
    expect(screen.queryByText('input-04-v1')).not.toBeInTheDocument()
  })
})

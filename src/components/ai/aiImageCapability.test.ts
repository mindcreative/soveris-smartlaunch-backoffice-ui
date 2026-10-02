import { describe, expect, it } from 'vitest'
import type { ClientCapabilities } from '../../types/billing'
import { imageJobStatusLabel } from './AiImageJobTracker'
import { presentAiImageCapability } from './aiImageCapability'

function capabilities(): ClientCapabilities {
  return {
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    classificationSource: 'back_office.clients', classification: 'customer', classificationRevision: '1',
    policySource: 'customer_subscription', policyVersion: 'v1', subscription: null,
    flags: [{ key: 'ai_image_generation', enabled: true }], limits: [], usage: [],
    operations: [{ key: 'ai_image_generation', outcome: 'eligible', permission: 'satisfied', feature: 'satisfied', entitlement: 'satisfied', resourceLimit: 'satisfied', provider: 'satisfied', pricing: 'satisfied', funding: 'available_requires_quote', denialConditions: [] }],
    evaluatedAt: '2026-10-02T08:00:00Z', nextBoundary: null,
  }
}

describe('AI image presentation', () => {
  it('permits quote-backed review for an eligible server capability', () => {
    expect(presentAiImageCapability(capabilities(), true)).toMatchObject({
      capabilityEligible: true, reason: 'eligible',
    })
    expect(presentAiImageCapability(capabilities(), false).message).toContain('ai:create')
  })

  it.each([
    ['permission_denied', 'permission'], ['client_inactive', 'inactive'],
    ['feature_not_available', 'policy'], ['entitlement_not_available', 'entitlement'],
    ['limit_reached', 'limit'], ['provider_unavailable', 'processing'],
    ['pricing_unavailable', 'pricing'], ['wallet_missing', 'funding'],
    ['wallet_ineligible', 'eligible'], ['insufficient_credits', 'credits'],
    ['configuration_unavailable', 'configuration'], ['dependency_unavailable', 'right now'],
    ['transition_pending', 'transition'], ['stale_capability_evidence', 'stale'],
  ] as const)('gives %s distinct safe copy', (reason, phrase) => {
    const value = capabilities()
    value.operations[0] = { ...value.operations[0]!, outcome: 'denied', denialConditions: [reason] }
    expect(presentAiImageCapability(value, true).message.toLowerCase()).toContain(phrase)
  })

  it('provides text labels for all seven public states without broker vocabulary', () => {
    const labels = ['pending', 'processing', 'retrying', 'dlq', 'completed', 'failed', 'execution_unknown']
      .map((status) => imageJobStatusLabel({ status: status as never }))
    expect(labels).toEqual([
      'Waiting for processing', 'Processing', 'Automatic safe retry in progress',
      'Recovery is being finalized', 'Completed', 'Failed safely', 'Outcome needs reconciliation',
    ])
    expect(labels.join(' ').toLowerCase()).not.toContain('rabbit')
    expect(labels.join(' ').toLowerCase()).not.toContain('dead-letter')
  })
})

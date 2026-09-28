import { describe, expect, it } from 'vitest'
import type { ClientCapabilities, ClientCapabilityDenialCondition } from '../../types/billing'
import { admissionFundingMessage, presentAiContentCapability } from './aiContentCapability'

function capabilities(classification: 'customer' | 'soveris_internal' = 'customer'): ClientCapabilities {
  return {
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', classificationSource: 'back_office.clients',
    classification, classificationRevision: '1', policySource: classification === 'customer' ? 'customer_subscription' : 'internal',
    policyVersion: 'v1', subscription: null, flags: [], limits: [], usage: [], evaluatedAt: '2026-09-28T10:00:00Z', nextBoundary: null,
    operations: [{ key: 'ai_content_generation', outcome: 'eligible', permission: 'satisfied', feature: 'satisfied', entitlement: classification === 'customer' ? 'satisfied' : 'not_applicable', resourceLimit: 'satisfied', provider: 'satisfied', pricing: 'satisfied', funding: 'available_requires_quote', denialConditions: [] }],
  }
}

describe('AI content capability presentation', () => {
  it('requires both delivered permissions and never uses plan copy', () => {
    expect(presentAiContentCapability(capabilities(), false, true)).toMatchObject({ eligible: false, reason: 'missing_permission' })
    expect(presentAiContentCapability(capabilities(), true, false).message).toContain('ai:view')
  })

  it('treats available_requires_quote as preflight only', () => {
    expect(presentAiContentCapability(capabilities(), true, true)).toEqual({ eligible: true, reason: 'available_requires_quote', message: 'Final credits and current availability are checked when you submit.' })
  })

  it.each([
    ['permission_denied', 'permission'], ['client_inactive', 'inactive'],
    ['feature_not_available', 'policy'], ['entitlement_not_available', 'plan'],
    ['limit_reached', 'limit'], ['provider_unavailable', 'provider'],
    ['pricing_unavailable', 'pricing'], ['configuration_unavailable', 'configuration'],
    ['dependency_unavailable', 'service'], ['transition_pending', 'transition'],
    ['stale_capability_evidence', 'stale'],
  ] as const)('explains %s specifically', (reason, phrase) => {
    const value = capabilities()
    value.operations[0] = { ...value.operations[0]!, outcome: 'denied', denialConditions: [reason as ClientCapabilityDenialCondition] }
    expect(presentAiContentCapability(value, true, true).message.toLowerCase()).toContain(phrase)
  })

  it.each(['wallet_missing', 'wallet_ineligible', 'insufficient_credits'] as const)(
    'never gives internal Clients upgrade copy for %s', (reason) => {
      const value = capabilities('soveris_internal')
      value.operations[0] = { ...value.operations[0]!, outcome: 'denied', funding: reason === 'insufficient_credits' ? 'insufficient_credits' : reason, denialConditions: [reason] }
      const message = presentAiContentCapability(value, true, true).message
      expect(message).toContain('internal Client')
      expect(message.toLowerCase()).not.toContain('upgrade')
      expect(admissionFundingMessage('soveris_internal').toLowerCase()).not.toContain('upgrade')
    })

  it('fails closed when projection or operation is missing', () => {
    expect(presentAiContentCapability(undefined, true, true).eligible).toBe(false)
    const value = capabilities(); value.operations = []
    expect(presentAiContentCapability(value, true, true).reason).toBe('malformed_capability')
  })
})

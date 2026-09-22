import { describe, expect, it } from 'vitest'
import { parseLocalSubscriptionPreview, serializeLocalSubscriptionRequest } from './localSubscriptionApi'
import type { LocalSubscriptionMaterial } from './localSubscriptionApi'

const wall = '2026-10-25T03:30:00.000000'
const resolved = {
  status: 'resolved', validFrom: wall,
  firstCycleBoundary: '2026-11-25T03:30:00.000000', validTo: null,
  endCycleIndex: null, resolutionFingerprint: `v1.${'a'.repeat(64)}`,
}
const material: LocalSubscriptionMaterial = {
  planName: 'Pro', subscriptionTier: 'basic', cycleCreditAmount: '1250.0000',
  validFrom: wall, endCycleIndex: null, changeEffectivePolicy: 'immediate',
  prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
  entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: 60,
    concurrentAiOperations: 4 }, featureFlags: { contentGeneration: true, imageGeneration: false } },
}

describe('local subscription request', () => {
  it('retains plain local time and exact decimal bytes for replay', () => {
    const preview = parseLocalSubscriptionPreview(resolved)
    const id = '018f6d8c-7b52-7c73-8b5f-7fd3f4af9120'
    const body = serializeLocalSubscriptionRequest(material, preview, id)
    expect(body).toContain('"cycleCreditAmount":1250.0000')
    expect(body).toContain(`"validFrom":"${wall}"`)
    expect(body).not.toMatch(/selectedOffset|timeZoneId|timeZoneRevision/)
    expect(serializeLocalSubscriptionRequest(material, preview, id)).toBe(body)
  })
  it('rejects offset or zone fields in a preview response', () => {
    expect(() => parseLocalSubscriptionPreview({ ...resolved, offset: '+02:00' })).toThrow()
    expect(() => parseLocalSubscriptionPreview({ ...resolved, timeZoneId: 'UTC' })).toThrow()
  })
})

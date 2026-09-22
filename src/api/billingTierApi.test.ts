import { describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import {
  BillingSubscriptionContractError,
  parseBillingSubscriptionState,
  parseBillingSubscriptionTierChangeResponse,
  parseResourceAccessConsequences,
  parseResourceAccessPreview,
  postBillingSubscriptionTierChange,
  serializeBillingSubscriptionTierChangeRequest,
  serializeResourceAccessPreviewRequest,
} from './billingApi'
import type {
  BillingSubscriptionTierAction,
  BillingSubscriptionTierChangeRequest,
} from '../types/billing'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const OPERATION = '01991f20-1234-7abc-8abc-1234567890ab'
const PENDING = '01991f20-5678-7abc-8abc-1234567890ab'
const AT = '2026-09-20T12:00:00.000000Z'
const EFFECTIVE = '2026-09-30T08:30:00.000000Z'

function state(pending = true): string {
  return JSON.stringify({
    clientId: CLIENT, stateAsOf: AT,
    current: {
      subscriptionId: SUBSCRIPTION, creationOperationId: OPERATION,
      planTermsOperationId: OPERATION, clientId: CLIENT, planName: 'Pro',
      subscriptionTier: 'brand', tierRevision: 7, cycleCreditAmount: 100,
      entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 }, featureFlags: { contentGeneration: true, imageGeneration: true } },
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor: '2026-08-31T08:30:00.000000Z', status: 'active',
      validFrom: '2026-08-31T08:30:00.000000Z', validTo: null,
      createdAt: '2026-08-31T08:30:00.000000Z', updatedAt: AT,
    },
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: AT, nextCursor: null },
    ...(pending ? { pendingTierChange: {
      schemaVersion: 1, operationId: PENDING, subscriptionTier: 'basic',
      expectedTierRevision: 7, effectivePolicy: 'next_billing_cycle',
      effectiveCycleIndex: 2, effectiveCycleStart: '2026-09-30T08:30:00.000000Z',
      effectiveCycleEnd: '2026-10-31T08:30:00.000000Z', scheduledAt: AT,
      reason: 'Approved downgrade',
    } } : {}),
  })
}

function tierCase(
  action: BillingSubscriptionTierAction,
  outcome: 'changed' | 'no_change' | 'scheduled' | 'replaced' | 'cancelled'
): { request: BillingSubscriptionTierChangeRequest; response: Record<string, unknown> } {
  const pendingAction = action === 'replace' || action === 'cancel_pending'
  const target = outcome === 'no_change' ? 'brand'
    : action === 'replace' ? 'brand_premium' : action === 'cancel_pending' ? 'basic' : 'basic'
  const request: BillingSubscriptionTierChangeRequest = {
    operationId: OPERATION,
    expectedTierRevision: '7',
    subscriptionTier: target,
    ...(pendingAction
      ? { expectedPendingTierChangeOperationId: PENDING }
      : { effectivePolicy: action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle' }),
    reason: 'Approved tier action', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }
  const changed = outcome === 'changed'
  const carriesPending = action !== 'apply_immediate'
  const resultingTier = changed ? target : 'brand'
  const resultingRevision = changed ? 8 : 7
  const receipt: Record<string, unknown> = {
    schemaVersion: 1,
    operationId: OPERATION,
    clientId: CLIENT,
    subscriptionId: SUBSCRIPTION,
    outcome,
    effectivePolicy: action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle',
    requestedSubscriptionTier: target,
    previousSubscriptionTier: 'brand',
    resultingSubscriptionTier: resultingTier,
    expectedTierRevision: 7,
    previousTierRevision: 7,
    resultingTierRevision: resultingRevision,
    reason: request.reason,
    operationAsOf: AT,
    effectiveAt: outcome === 'scheduled' || outcome === 'replaced' ? EFFECTIVE : AT,
  }
  if (carriesPending) {
    receipt.action = action === 'cancel_pending' ? 'cancel' : action
    receipt.previousPendingTierChangeOperationId = action === 'replace' || action === 'cancel_pending'
      ? PENDING : null
    receipt.previousPendingSubscriptionTier = action === 'replace' || action === 'cancel_pending'
      ? 'basic' : null
    receipt.pendingTierChangeOperationId = outcome === 'scheduled' || outcome === 'replaced'
      ? OPERATION : null
    receipt.pendingSubscriptionTier = outcome === 'scheduled' || outcome === 'replaced'
      ? target : null
  }
  const pendingTierChange = outcome === 'scheduled' || outcome === 'replaced' ? {
    schemaVersion: 1,
    operationId: OPERATION,
    subscriptionTier: target,
    expectedTierRevision: 7,
    effectivePolicy: 'next_billing_cycle',
    effectiveCycleIndex: 2,
    effectiveCycleStart: EFFECTIVE,
    effectiveCycleEnd: '2026-10-31T08:30:00.000000Z',
    scheduledAt: AT,
    reason: request.reason,
  } : null
  return {
    request,
    response: {
      schemaVersion: 1,
      receipt,
      tierState: {
        subscriptionTier: resultingTier,
        tierRevision: resultingRevision,
        status: 'active',
        validFrom: '2026-08-31T08:30:00.000000Z',
        validTo: null,
        pendingTierChange,
        observedAt: AT,
      },
    },
  }
}

function consequence(kind: 'scheduled' | 'grace_started' | 'suspended' | 'restored' | 'cancelled') {
  return {
    consequenceId: '33333333-2222-4333-8444-555555555555',
    projectionRunId: '44444444-2222-4333-8444-555555555555',
    projectionRevision: 9,
    causeIdentity: `tier:${OPERATION}`,
    consequenceKind: kind,
    lossAt: kind === 'scheduled' || kind === 'grace_started' ? AT : null,
    accessUntil: kind === 'scheduled' || kind === 'grace_started' ? EFFECTIVE : null,
    earliestProofExpiry: null,
    retainedCount: 1,
    totalCount: 1,
    graceCount: 0,
    suspendedCount: 0,
    affectedResources: [],
    affectedResourcesTruncated: false,
    deadlineGroups: [], deadlineGroupsTruncated: false, unlistedGraceCount: 0,
    suspensionGroups: [], unlistedSuspendedCount: 0,
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

describe('tier administration strict adapters', () => {
  it('accepts absent/present pending-tier branches and rejects financial conflation', () => {
    expect(parseBillingSubscriptionState(state(false), CLIENT).pendingTierChange).toBeUndefined()
    expect(parseBillingSubscriptionState(state(), CLIENT).pendingTierChange).toMatchObject({
      operationId: PENDING, subscriptionTier: 'basic', expectedTierRevision: '7',
    })
    expect(() => parseBillingSubscriptionState(
      state().replace('"pendingTierChange":', '"pendingChange":'), CLIENT
    )).toThrow(BillingSubscriptionContractError)
  })

  it('serializes preview and commands with exact lossless integer material', () => {
    expect(serializeResourceAccessPreviewRequest({
      action: 'schedule', expectedStatus: 'active', expectedTierRevision: '7',
      subscriptionTier: 'basic', effectivePolicy: 'next_billing_cycle',
    })).toBe('{"action":"schedule","expectedStatus":"active","expectedTierRevision":7,"subscriptionTier":"basic","effectivePolicy":"next_billing_cycle"}')
    expect(serializeBillingSubscriptionTierChangeRequest('replace', {
      operationId: OPERATION, expectedTierRevision: '7',
      expectedPendingTierChangeOperationId: PENDING, subscriptionTier: 'brand_premium',
      reason: 'Replace approved schedule', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })).toBe('{"operationId":"01991f20-1234-7abc-8abc-1234567890ab","expectedTierRevision":7,"expectedPendingTierChangeOperationId":"01991f20-5678-7abc-8abc-1234567890ab","subscriptionTier":"brand_premium","reason":"Replace approved schedule","commandAuthorityHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
  })

  it.each([
    ['apply_immediate', 'immediate'],
    ['schedule', 'next_billing_cycle'],
    ['replace', 'next_billing_cycle'],
    ['cancel_pending', 'next_billing_cycle'],
  ] as const)('serializes the %s tier preview branch', (action, effectivePolicy) => {
    expect(JSON.parse(serializeResourceAccessPreviewRequest({
      action,
      expectedStatus: 'active',
      expectedTierRevision: '7',
      subscriptionTier: 'basic',
      effectivePolicy,
    }))).toEqual({
      action,
      expectedStatus: 'active',
      expectedTierRevision: 7,
      subscriptionTier: 'basic',
      effectivePolicy,
    })
  })

  it.each(['pause', 'reactivate', 'cancel', 'expire'] as const)(
    'serializes the %s lifecycle preview branch without tier material',
    (action) => {
      expect(JSON.parse(serializeResourceAccessPreviewRequest({
        action,
        expectedStatus: action === 'reactivate' ? 'paused' : 'active',
        expectedTierRevision: '7',
        subscriptionTier: null,
        effectivePolicy: null,
      }))).toMatchObject({ action, subscriptionTier: null, effectivePolicy: null })
    }
  )

  it.each([
    ['apply_immediate', 'changed'],
    ['apply_immediate', 'no_change'],
    ['schedule', 'no_change'],
    ['schedule', 'scheduled'],
    ['replace', 'replaced'],
    ['cancel_pending', 'cancelled'],
  ] as const)('accepts the %s/%s receipt branch', (action, outcome) => {
    const fixture = tierCase(action, outcome)
    const parsed = parseBillingSubscriptionTierChangeResponse(
      JSON.stringify(fixture.response), CLIENT, SUBSCRIPTION, action, fixture.request
    )
    expect(parsed.receipt.outcome).toBe(outcome)
  })

  it.each([
    ['apply_immediate', 'immediate', false],
    ['schedule', 'next_billing_cycle', false],
    ['replace', undefined, true],
    ['cancel_pending', undefined, true],
  ] as const)('serializes the exact %s command shape', (action, effectivePolicy, pendingAction) => {
    const request: BillingSubscriptionTierChangeRequest = {
      operationId: OPERATION,
      expectedTierRevision: '7',
      subscriptionTier: 'basic',
      ...(pendingAction
        ? { expectedPendingTierChangeOperationId: PENDING }
        : { effectivePolicy }),
      reason: 'Approved tier action', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }
    const parsed = JSON.parse(serializeBillingSubscriptionTierChangeRequest(action, request))
    expect(Object.keys(parsed)).toEqual(pendingAction
      ? ['operationId', 'expectedTierRevision', 'expectedPendingTierChangeOperationId', 'subscriptionTier', 'reason', 'commandAuthorityHash']
      : ['operationId', 'expectedTierRevision', 'subscriptionTier', 'effectivePolicy', 'reason', 'commandAuthorityHash'])
  })

  it('parses approved preview facts and rejects extra or inconsistent evidence', () => {
    const request = {
      action: 'schedule' as const, expectedStatus: 'active' as const,
      expectedTierRevision: '7', subscriptionTier: 'basic' as const,
      effectivePolicy: 'next_billing_cycle' as const,
    }
    const value = {
      clientId: CLIENT, subscriptionId: SUBSCRIPTION, action: 'schedule',
      currentSubscriptionTier: 'brand', targetSubscriptionTier: 'basic',
      effectivePolicy: 'next_billing_cycle', statusRevision: 4,
      classificationRevision: 5, tierRevision: 7,
      pendingTierChangeOperationId: PENDING,
      policyPublicationId: '22222222-2222-3333-8444-555555555555',
      policyActivationRevision: 9, policyVersion: 'input-04-v1', policyHash: 'abc', commandEffectiveAt: '2026-09-30T08:30:00.000000Z', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      evaluatedAt: AT, lossAt: '2026-09-30T08:30:00.000000Z',
      accessUntil: '2026-10-07T08:30:00.000000Z', retainedCount: 1,
      earliestProofExpiry: null,
      totalCount: 3, graceCount: 2, suspendedCount: 0,
      deadlineGroups: [{ lossAt: '2026-09-30T08:30:00.000000Z', accessUntil: '2026-10-07T08:30:00.000000Z', graceCount: 2, newlyAffectedCount: 2 }],
      deadlineGroupsTruncated: false, unlistedGraceCount: 0, unlistedNewlyAffectedCount: 0,
      affectedResourcesTruncated: false,
      preservationFacts: { contentPreserved: true, assetsPreserved: true, creditsUnchanged: true, acceptedAiWorkUnchanged: true },
      affectedResources: [{ resourceType: 'product', resourceId: '33333333-2222-3333-8444-555555555555', disposition: 'grace', accessUntil: '2026-10-07T08:30:00.000000Z', proofExpiresAt: null }],
    }
    expect(parseResourceAccessPreview(JSON.stringify(value), CLIENT, SUBSCRIPTION, request)).toMatchObject({
      policyVersion: 'input-04-v1', retainedCount: 1, totalCount: 3, graceCount: 2,
    })
    expect(() => parseResourceAccessPreview(
      JSON.stringify({ ...value, credits: 10 }), CLIENT, SUBSCRIPTION, request
    )).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessPreview(JSON.stringify({
      ...value, deadlineGroups: [{ ...value.deadlineGroups[0], graceCount: 1 }],
    }), CLIENT, SUBSCRIPTION, request)).toThrow(BillingSubscriptionContractError)

    const proofExpiresAt = '2026-10-03T08:30:00.000000Z'
    const proofPreview = { ...value, earliestProofExpiry: proofExpiresAt,
      affectedResources: [{ resourceType: 'domain_binding',
        resourceId: '33333333-2222-3333-8444-555555555555', disposition: 'grace',
        accessUntil: value.accessUntil, proofExpiresAt }] }
    expect(parseResourceAccessPreview(JSON.stringify(proofPreview), CLIENT, SUBSCRIPTION,
      request).earliestProofExpiry).toBe(proofExpiresAt)
    expect(() => parseResourceAccessPreview(JSON.stringify({ ...proofPreview,
      affectedResources: [{ ...proofPreview.affectedResources[0], proofExpiresAt: value.accessUntil }],
    }), CLIENT, SUBSCRIPTION, request)).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessPreview(JSON.stringify({ ...proofPreview,
      earliestProofExpiry: null,
    }), CLIENT, SUBSCRIPTION, request)).toThrow(BillingSubscriptionContractError)
  })

  it('binds a strict receipt to the exact command identity and route action', () => {
    const request = {
      operationId: OPERATION, expectedTierRevision: '7', subscriptionTier: 'basic' as const,
      effectivePolicy: 'next_billing_cycle' as const, reason: 'Approved downgrade', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }
    const response = {
      schemaVersion: 1,
      receipt: {
        schemaVersion: 1, operationId: OPERATION, clientId: CLIENT,
        subscriptionId: SUBSCRIPTION, outcome: 'scheduled',
        effectivePolicy: 'next_billing_cycle', requestedSubscriptionTier: 'basic',
        previousSubscriptionTier: 'brand', resultingSubscriptionTier: 'brand',
        expectedTierRevision: 7, previousTierRevision: 7, resultingTierRevision: 7,
        reason: 'Approved downgrade', operationAsOf: AT,
        effectiveAt: '2026-09-30T08:30:00.000000Z',
        action: 'schedule', previousPendingTierChangeOperationId: null,
        pendingTierChangeOperationId: OPERATION, pendingSubscriptionTier: 'basic',
        previousPendingSubscriptionTier: null,
      },
      tierState: {
        subscriptionTier: 'brand', tierRevision: 7, status: 'active',
        validFrom: '2026-08-31T08:30:00.000000Z', validTo: null,
        pendingTierChange: {
          schemaVersion: 1, operationId: OPERATION, subscriptionTier: 'basic',
          expectedTierRevision: 7, effectivePolicy: 'next_billing_cycle',
          effectiveCycleIndex: 2, effectiveCycleStart: '2026-09-30T08:30:00.000000Z',
          effectiveCycleEnd: '2026-10-31T08:30:00.000000Z', scheduledAt: AT,
          reason: 'Approved downgrade',
        }, observedAt: AT,
      },
    }
    expect(parseBillingSubscriptionTierChangeResponse(
      JSON.stringify(response), CLIENT, SUBSCRIPTION, 'schedule', request
    ).receipt.outcome).toBe('scheduled')
    expect(() => parseBillingSubscriptionTierChangeResponse(
      JSON.stringify({
        ...response,
        receipt: { ...response.receipt, effectivePolicy: 'immediate' },
      }), CLIENT, SUBSCRIPTION, 'schedule', request
    )).toThrow(BillingSubscriptionContractError)
  })

  it('rejects malformed preview and command material for every closed boundary', () => {
    expect(() => serializeResourceAccessPreviewRequest({
      action: 'pause', expectedStatus: 'active', expectedTierRevision: '7',
      subscriptionTier: 'basic', effectivePolicy: null,
    })).toThrow(BillingSubscriptionContractError)
    expect(() => serializeResourceAccessPreviewRequest({
      action: 'schedule', expectedStatus: 'active', expectedTierRevision: '7',
      subscriptionTier: 'basic', effectivePolicy: 'immediate',
    })).toThrow(BillingSubscriptionContractError)
    expect(() => serializeBillingSubscriptionTierChangeRequest('replace', {
      operationId: OPERATION, expectedTierRevision: '7', subscriptionTier: 'basic',
      effectivePolicy: 'next_billing_cycle', reason: 'Wrong shape',
      commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })).toThrow(BillingSubscriptionContractError)
  })

  it.each(['scheduled', 'grace_started', 'suspended', 'restored', 'cancelled'] as const)(
    'parses the persisted %s consequence branch',
    (kind) => {
      expect(parseResourceAccessConsequences(JSON.stringify([consequence(kind)]))[0]?.consequenceKind)
        .toBe(kind)
    }
  )

  it('parses the normalized persisted writer payload including eligible resources', () => {
    const parsed = parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('scheduled'),
      affectedResources: [{
        resourceType: 'product', resourceId: '11111111-2222-3333-8444-555555555555',
        state: 'eligible', accessUntil: null,
        proofExpiresAt: null,
      }],
    }]))
    expect(parsed[0]?.affectedResources[0]).toEqual({
      resourceType: 'product', resourceId: '11111111-2222-3333-8444-555555555555',
      state: 'eligible', accessUntil: null, proofExpiresAt: null,
    })
    expect(() => parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('scheduled'),
      affectedResources: [{
        resourceType: 'product', resourceId: '11111111-2222-3333-8444-555555555555',
        state: 'eligible', AccessUntil: null,
        proofExpiresAt: null,
      }],
    }]))).toThrow(BillingSubscriptionContractError)
  })

  it('parses a fired persisted reminder with its authoritative deadline count', () => {
    const parsed = parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('scheduled'),
      graceCount: 1, totalCount: 2,
      deadlineGroups: [{ accessUntil: EFFECTIVE, graceCount: 1 }],
      reminders: [{ reminderKind: 'reminder_24h', dueAt: AT,
        recordedAt: AT, graceCount: 1, earliestProofExpiry: null }],
    }]))
    expect(parsed[0]?.reminders[0]).toMatchObject({
      reminderKind: 'reminder_24h', graceCount: 1,
    })
  })

  it('keeps policy grace and earlier proof expiry separate across history and reminder parsing', () => {
    const proofExpiresAt = '2026-09-25T08:30:00.000000Z'
    const item = {
      ...consequence('grace_started'), totalCount: 2, retainedCount: 1, graceCount: 1,
      earliestProofExpiry: proofExpiresAt,
      deadlineGroups: [{ accessUntil: EFFECTIVE, graceCount: 1 }],
      affectedResources: [{ resourceType: 'domain_binding',
        resourceId: '11111111-2222-3333-8444-555555555555', state: 'grace',
        accessUntil: EFFECTIVE, proofExpiresAt }],
      reminders: [{ reminderKind: 'reminder_72h', dueAt: AT, recordedAt: AT,
        graceCount: 1, earliestProofExpiry: proofExpiresAt }],
    }
    const parsed = parseResourceAccessConsequences(JSON.stringify([item]))
    expect(parsed[0]).toMatchObject({ accessUntil: EFFECTIVE,
      earliestProofExpiry: proofExpiresAt })
    expect(parsed[0]?.reminders[0]?.earliestProofExpiry).toBe(proofExpiresAt)
    expect(() => parseResourceAccessConsequences(JSON.stringify([{
      ...item, affectedResources: [{ ...item.affectedResources[0], proofExpiresAt: EFFECTIVE }],
    }]))).toThrow(BillingSubscriptionContractError)
  })

  it('keeps newly suspended cohort counts separate from aggregate suspended state', () => {
    const parsed = parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('suspended'),
      totalCount: 2, retainedCount: 0, suspendedCount: 2,
      suspensionGroups: [{ accessUntil: EFFECTIVE, suspendedCount: 1, reason: 'finite_limit' }],
    }]))
    expect(parsed[0]?.suspendedCount).toBe(2)
    expect(parsed[0]?.suspensionGroups).toEqual([{
      accessUntil: EFFECTIVE, suspendedCount: 1, reason: 'finite_limit',
    }])
  })

  it('parses authoritative restoration facts while preserving legacy rows', () => {
    const current = parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('restored'), restoredCount: 1, restoredAt: AT,
    }]))
    expect(current[0]?.restoredCount).toBe(1)
    expect(current[0]?.restoredAt).toBe(AT)
    expect(parseResourceAccessConsequences(JSON.stringify([consequence('restored')]))[0]
      ?.restoredCount).toBeNull()
    expect(() => parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('restored'), restoredCount: 1, restoredAt: null,
    }]))).toThrow(BillingSubscriptionContractError)
  })

  it('rejects unknown, duplicate, extra, oversized, and count-inconsistent consequences', () => {
    expect(() => parseResourceAccessConsequences(JSON.stringify([
      { ...consequence('scheduled'), consequenceKind: 'grace_reminder' },
    ]))).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessConsequences(
      JSON.stringify([consequence('scheduled')]).replace('"causeIdentity":', '"causeIdentity":"duplicate","causeIdentity":')
    )).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('scheduled'),
      preservationFacts: { ...consequence('scheduled').preservationFacts, privateFact: true },
    }]))).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessConsequences(JSON.stringify([{
      ...consequence('scheduled'), totalCount: 2,
    }]))).toThrow(BillingSubscriptionContractError)
    expect(() => parseResourceAccessConsequences(JSON.stringify(
      Array.from({ length: 51 }, () => consequence('restored'))
    ))).toThrow(BillingSubscriptionContractError)
  })

  it('posts the selected route with the retained bytes, signal, and auth replay callback', async () => {
    const fixture = tierCase('replace', 'replaced')
    const retainedBody = serializeBillingSubscriptionTierChangeRequest('replace', fixture.request)
    const onAuthReplay = vi.fn()
    const signal = new AbortController().signal
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      status: 200, data: JSON.stringify(fixture.response),
    })

    await postBillingSubscriptionTierChange(
      CLIENT, SUBSCRIPTION, 'replace', fixture.request, signal, retainedBody, onAuthReplay
    )

    expect(post).toHaveBeenCalledWith(
      `/api/billing/clients/${CLIENT}/subscriptions/${SUBSCRIPTION}/tier-changes/pending/replace`,
      retainedBody,
      { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' }, onAuthReplay }
    )
    await expect(postBillingSubscriptionTierChange(
      CLIENT, SUBSCRIPTION, 'replace', fixture.request, signal, `${retainedBody} `
    )).rejects.toBeInstanceOf(BillingSubscriptionContractError)
  })
})

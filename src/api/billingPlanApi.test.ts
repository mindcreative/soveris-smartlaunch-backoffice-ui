import { describe, expect, it } from 'vitest'
import {
  BillingPlanContractError,
  parseBillingPlanPreview,
  parseBillingPlanReceipt,
  serializeBillingPlanCommandRequest,
  serializeBillingPlanPreviewRequest,
} from './billingPlanApi'
import type {
  BillingSubscriptionPlanChangeCommandRequest,
  BillingSubscriptionPlanChangePreviewRequest,
} from '../types/billing'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const OPERATION = '01991f20-1234-7abc-8abc-1234567890ab'
const TOKEN = `v1.${'a'.repeat(64)}`
const LOCAL = '2026-09-22T12:00:00.123456'
const entitlements = { schemaVersion: 1 as const,
  rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
  featureFlags: { contentGeneration: true, imageGeneration: false } }
const request = { action: 'apply_immediate' as const, planName: 'Pro',
  cycleCreditAmount: '1250.0000', entitlements, prorationPolicy: 'prorate' as const,
  unusedCreditPolicy: 'rollover' as const }

function terms(policy: 'immediate' | 'next_billing_cycle', amount = '1250.0000') {
  return `{"planName":"Pro","cycleCreditAmount":${amount},"entitlements":{"schemaVersion":1,"rateLimits":{"requestsPerMinute":60,"concurrentAiOperations":4},"featureFlags":{"contentGeneration":true,"imageGeneration":false}},"changeEffectivePolicy":"${policy}","prorationPolicy":"prorate","unusedCreditPolicy":"rollover"}`
}

describe('billing plan contracts', () => {
  it('serializes exact decimal bytes and keeps preview token separate from UUIDv7', () => {
    const previewBody = serializeBillingPlanPreviewRequest(request)
    expect(previewBody).toContain('"cycleCreditAmount":1250.0000')
    expect(previewBody).not.toContain('planChangeOperationId')
    const command = { ...request, planChangeOperationId: OPERATION,
      previewToken: TOKEN, reason: 'Approved financial change' }
    const first = serializeBillingPlanCommandRequest(command)
    expect(first).toContain('"cycleCreditAmount":1250.0000')
    expect(first).toContain(`"planChangeOperationId":"${OPERATION}"`)
    expect(first).toContain(`"previewToken":"${TOKEN}"`)
    expect(serializeBillingPlanCommandRequest(command)).toBe(first)
  })

  it('enforces action-specific closed request fields and trimmed scalar-safe reason', () => {
    expect(serializeBillingPlanPreviewRequest({ action: 'cancel' })).toBe('{"action":"cancel"}')
    expect(() => serializeBillingPlanPreviewRequest({ action: 'cancel', planName: 'x' } as never))
      .toThrow(BillingPlanContractError)
    expect(() => serializeBillingPlanCommandRequest({ action: 'cancel',
      planChangeOperationId: OPERATION, previewToken: TOKEN, reason: ' trailing ' }))
      .toThrow(BillingPlanContractError)
    expect(() => serializeBillingPlanPreviewRequest({ ...request,
      subscriptionTier: 'brand' } as never)).toThrow(BillingPlanContractError)
  })

  it('parses a lossless immediate preview with plain local timestamps', () => {
    const body = `{"schemaVersion":1,"action":"apply_immediate","previewToken":"${TOKEN}","previewedAt":"${LOCAL}","currentTerms":${terms('immediate', '1000.0000')},"targetTerms":${terms('immediate')},"pendingChangeBefore":null,"pendingResult":"preserved","effectiveCycle":{"cycleIndex":8,"cycleStart":"${LOCAL}","cycleEnd":"2026-10-22T12:00:00.123456"},"creditEffect":{"timing":"immediate","currentCycleCreditAmount":1000.0000,"targetCycleCreditAmount":1250.0000,"calculation":{"policyVersion":"calendar-month-remaining-v1","fundingBasis":"current_cycle_grant","cycleIndex":8,"cycleStart":"${LOCAL}","cycleEnd":"2026-10-22T12:00:00.123456","currentCycleGrantOperationId":"${OPERATION}","totalCycleMicroseconds":2592000000000,"remainingCycleMicroseconds":1296000000000,"delta":125.0000,"appliedDelta":125.0000,"outstandingDelta":0.0000},"account":{"creditAccountId":"22222222-2222-4333-8444-555555555555","walletVersionBefore":7,"walletVersionAfter":8,"balanceBefore":100.0000,"reservedBalanceBefore":20.0000,"availableBalanceBefore":80.0000,"balanceAfter":225.0000,"reservedBalanceAfter":20.0000,"availableBalanceAfter":205.0000}},"pendingImmediateDebitAfter":null}`
    const preview = parseBillingPlanPreview(body, request)
    expect(preview.creditEffect.calculation?.remainingCycleMicroseconds).toBe('1296000000000')
    expect(preview.creditEffect.account?.balanceAfter).toBe('225.0000')
    expect(preview.previewedAt).toBe(LOCAL)
    expect(() => parseBillingPlanPreview(body.replace(LOCAL, `${LOCAL}Z`), request)).toThrow()
    expect(() => parseBillingPlanPreview(body.replace('"pendingImmediateDebitAfter":null',
      '"pendingImmediateDebitAfter":null,"extra":true'), request)).toThrow()
  })

  it('validates scheduled receipt route, action, operation and pending identity', () => {
    const command: BillingSubscriptionPlanChangeCommandRequest = {
      action: 'schedule', planName: 'Pro', cycleCreditAmount: '1250.0000', entitlements,
      prorationPolicy: 'prorate', unusedCreditPolicy: 'rollover',
      planChangeOperationId: OPERATION, previewToken: TOKEN, reason: 'Approved financial change',
    }
    const body = `{"schemaVersion":2,"planChangeOperationId":"${OPERATION}","clientId":"${CLIENT}","subscriptionId":"${SUBSCRIPTION}","action":"schedule","previousPendingChangeOperationId":null,"pendingChangeOperationId":"${OPERATION}","planName":"Pro","cycleCreditAmount":1250.0000,"entitlements":{"schemaVersion":1,"rateLimits":{"requestsPerMinute":60,"concurrentAiOperations":4},"featureFlags":{"contentGeneration":true,"imageGeneration":false}},"changeEffectivePolicy":"next_billing_cycle","prorationPolicy":"prorate","unusedCreditPolicy":"rollover","effectiveCycleIndex":9,"effectiveCycleStart":"${LOCAL}","effectiveCycleEnd":"2026-10-22T12:00:00.123456","subscriptionTier":"brand","tierRevision":7,"operationAsOf":"${LOCAL}"}`
    const receipt = parseBillingPlanReceipt(body, CLIENT, SUBSCRIPTION, command)
    expect(receipt.action).toBe('schedule')
    if (receipt.action !== 'schedule') throw new Error('expected a scheduled receipt')
    expect(receipt.pendingChangeOperationId).toBe(OPERATION)
    expect(() => parseBillingPlanReceipt(body.replace(CLIENT,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), CLIENT, SUBSCRIPTION, command)).toThrow()
  })

  it('rejects preview action mismatch', () => {
    const cancel: BillingSubscriptionPlanChangePreviewRequest = { action: 'cancel' }
    expect(() => parseBillingPlanPreview('{}', cancel)).toThrow(BillingPlanContractError)
  })
})

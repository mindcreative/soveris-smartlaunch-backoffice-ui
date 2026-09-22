import { LosslessNumber, isLosslessNumber, parse, stringify } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { parseLocalInstant, type LocalInstantValue } from '../timezone/LocalInstant'
import type { BillingEntitlementsV1, BillingSubscriptionTier } from '../types/billing'

export interface LocalSubscriptionPreviewInput {
  validFrom: string
  endCycleIndex: number | null
}

export interface ResolvedLocalSubscriptionPreview {
  status: 'resolved'
  validFrom: LocalInstantValue
  firstCycleBoundary: LocalInstantValue
  validTo: LocalInstantValue | null
  endCycleIndex: number | null
  resolutionFingerprint: string
}

export type LocalSubscriptionPreview = ResolvedLocalSubscriptionPreview

export interface LocalSubscriptionMaterial extends LocalSubscriptionPreviewInput {
  planName: string
  subscriptionTier: BillingSubscriptionTier
  cycleCreditAmount: string
  changeEffectivePolicy: 'immediate'
  prorationPolicy: 'replace'
  unusedCreditPolicy: 'rollover'
  entitlements: BillingEntitlementsV1
}

export interface LocalSubscriptionReceipt {
  created: boolean
  subscription: {
    subscriptionId: string
    creationOperationId: string
    planName: string
    validFrom: LocalInstantValue
    validTo: LocalInstantValue | null
    billingCycleAnchor: LocalInstantValue
  }
  initialGrant: { grantId: string; ledgerEntryId: string; cycleStart: LocalInstantValue; cycleEnd: LocalInstantValue }
  account: { creditAccountId: string; asOf: LocalInstantValue }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local subscription response')
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, names: string[]): void {
  if (Object.keys(value).sort().join(',') !== names.sort().join(','))
    throw new Error('Invalid local subscription response')
}

export function parseLocalSubscriptionPreview(value: unknown): LocalSubscriptionPreview {
  const data = record(value)
  exact(data, ['status', 'validFrom', 'firstCycleBoundary', 'validTo', 'endCycleIndex', 'resolutionFingerprint'])
  if (data.status !== 'resolved' || typeof data.resolutionFingerprint !== 'string' ||
      !/^v1\.[0-9a-f]{64}$/.test(data.resolutionFingerprint) ||
      (data.endCycleIndex !== null && (!Number.isSafeInteger(data.endCycleIndex) || Number(data.endCycleIndex) < 1)))
    throw new Error('Invalid local subscription response')
  return {
    status: 'resolved', validFrom: parseLocalInstant(data.validFrom),
    firstCycleBoundary: parseLocalInstant(data.firstCycleBoundary),
    validTo: data.validTo === null ? null : parseLocalInstant(data.validTo),
    endCycleIndex: data.endCycleIndex as number | null,
    resolutionFingerprint: data.resolutionFingerprint,
  }
}

export async function previewLocalSubscription(clientId: string, input: LocalSubscriptionPreviewInput,
  signal?: AbortSignal): Promise<LocalSubscriptionPreview> {
  const id = canonicalizeGuid(clientId)
  if (!id) throw new Error('Invalid Client ID')
  const response = await apiClient.postApiRoot<unknown>(
    `/api/backoffice/clients/${id}/billing/subscriptions/local-time-preview`, input,
    { signal, timeout: 10000 }
  )
  return parseLocalSubscriptionPreview(response.data)
}

export function serializeLocalSubscriptionRequest(material: LocalSubscriptionMaterial,
  preview: ResolvedLocalSubscriptionPreview, creationOperationId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creationOperationId) ||
      !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(material.cycleCreditAmount) ||
      !material.validFrom || material.validFrom !== preview.validFrom ||
      material.endCycleIndex !== preview.endCycleIndex)
    throw new Error('Invalid local subscription request')
  const body = stringify({
    creationOperationId, planName: material.planName, subscriptionTier: material.subscriptionTier,
    cycleCreditAmount: new LosslessNumber(material.cycleCreditAmount),
    validFrom: material.validFrom,
    endCycleIndex: material.endCycleIndex,
    resolutionFingerprint: preview.resolutionFingerprint,
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    entitlements: material.entitlements,
  })
  if (typeof body !== 'string' || new TextEncoder().encode(body).length > 16384)
    throw new Error('Invalid local subscription request')
  return body
}

export function parseLocalSubscriptionReceipt(text: string, expectedClientId: string,
  operationId: string): LocalSubscriptionReceipt {
  const data = record(parse(text))
  exact(data, ['created', 'subscription', 'initialGrant', 'account'])
  if (typeof data.created !== 'boolean')
    throw new Error('Invalid local subscription receipt')
  const subscription = record(data.subscription)
  const grant = record(data.initialGrant)
  const account = record(data.account)
  exact(subscription, ['subscriptionId', 'creationOperationId', 'planTermsOperationId',
    'clientId', 'planName', 'subscriptionTier', 'tierRevision', 'cycleCreditAmount',
    'entitlements', 'changeEffectivePolicy', 'prorationPolicy', 'unusedCreditPolicy',
    'billingCycleAnchor', 'status', 'validFrom', 'validTo'])
  exact(grant, ['grantId', 'grantOperationId', 'ledgerEntryId', 'planTermsOperationId',
    'planNameSnapshot', 'entitlementsSnapshot', 'subscriptionTierSnapshot',
    'tierRevisionSnapshot', 'grantType', 'cycleStart', 'cycleEnd', 'creditAmount'])
  exact(account, ['creditAccountId', 'clientId', 'ownedBalance',
    'activelyReservedAmount', 'availableBalance', 'status', 'asOf'])
  const guid = (value: unknown) => typeof value === 'string' ? canonicalizeGuid(value) : null
  if (guid(subscription.clientId) !== expectedClientId || guid(account.clientId) !== expectedClientId ||
      guid(subscription.creationOperationId) !== operationId ||
      guid(subscription.planTermsOperationId) !== operationId ||
      !guid(subscription.subscriptionId) || !guid(grant.grantId) ||
      !guid(grant.grantOperationId) ||
      !guid(grant.ledgerEntryId) || !guid(account.creditAccountId) ||
      typeof subscription.planName !== 'string' ||
      subscription.status !== 'active' || grant.grantType !== 'billing_cycle' ||
      subscription.changeEffectivePolicy !== 'immediate' ||
      subscription.prorationPolicy !== 'replace' ||
      subscription.unusedCreditPolicy !== 'rollover' ||
      grant.planNameSnapshot !== subscription.planName ||
      grant.subscriptionTierSnapshot !== subscription.subscriptionTier ||
      guid(grant.planTermsOperationId) !== operationId ||
      !isLosslessNumber(subscription.cycleCreditAmount) ||
      !isLosslessNumber(grant.creditAmount) ||
      !isLosslessNumber(account.ownedBalance) ||
      !isLosslessNumber(account.activelyReservedAmount) ||
      !isLosslessNumber(account.availableBalance))
    throw new Error('Invalid local subscription receipt')
  return {
    created: data.created,
    subscription: {
      subscriptionId: subscription.subscriptionId as string,
      creationOperationId: operationId, planName: subscription.planName,
      validFrom: parseLocalInstant(subscription.validFrom),
      validTo: subscription.validTo === null ? null : parseLocalInstant(subscription.validTo),
      billingCycleAnchor: parseLocalInstant(subscription.billingCycleAnchor),
    },
    initialGrant: {
      grantId: grant.grantId as string, ledgerEntryId: grant.ledgerEntryId as string,
      cycleStart: parseLocalInstant(grant.cycleStart),
      cycleEnd: parseLocalInstant(grant.cycleEnd),
    },
    account: {
      creditAccountId: account.creditAccountId as string,
      asOf: parseLocalInstant(account.asOf),
    },
  }
}

export async function createLocalSubscription(clientId: string, body: string, operationId: string,
  signal?: AbortSignal): Promise<LocalSubscriptionReceipt> {
  const id = canonicalizeGuid(clientId)
  if (!id) throw new Error('Invalid Client ID')
  const response = await apiClient.postApiRoot<string>(
    `/api/backoffice/clients/${id}/billing/subscriptions`, body,
    { signal, timeout: 15000, responseType: 'text', headers: { 'Content-Type': 'application/json' } }
  )
  if (response.status !== 200 && response.status !== 201) throw new Error('Invalid local subscription receipt')
  const receipt = parseLocalSubscriptionReceipt(response.data, id, operationId)
  if ((response.status === 201) !== receipt.created) throw new Error('Invalid local subscription receipt')
  const material = record(parse(body))
  const result = record(parse(response.data))
  const subscription = record(result.subscription)
  if (subscription.planName !== material.planName ||
      subscription.subscriptionTier !== material.subscriptionTier ||
      !isLosslessNumber(subscription.cycleCreditAmount) ||
      !isLosslessNumber(material.cycleCreditAmount) ||
      subscription.cycleCreditAmount.toString() !== material.cycleCreditAmount.toString())
    throw new Error('Local subscription receipt does not match the retained operation')
  return receipt
}

import { useAuthStore } from '../stores/authStore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import {
  BillingSubscriptionContractError,
  ClientCapabilitiesContractError,
  getBillingAccountSnapshot,
  getBillingLedgerExportStatus,
  getBillingLedgerPage,
  postBillingSubscriptionLifecycle,
  getBillingSubscriptionState,
  getClientCapabilities,
  parseBillingAccountSnapshot,
  parseBillingLedgerExportAccepted,
  parseBillingLedgerExportStatus,
  parseBillingLedgerPage,
  parseBillingSubscriptionCreationReceipt,
  parseBillingSubscriptionLifecycleReceipt,
  parseBillingSubscriptionState,
  parseClientCapabilities,
  redeemBillingLedgerExport,
  requestBillingLedgerExport,
  serializeCreateBillingSubscriptionRequest,
  serializeBillingSubscriptionLifecycleRequest,
} from './billingApi'
import type {
  BillingLedgerExportAttempt,
  BillingLedgerExportFilters,
  CreateBillingSubscriptionRequest,
} from '../types/billing'

beforeEach(() => useAuthStore.setState({ user: {
  id: 'actor', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  email: 'actor@example.test', displayName: 'Actor', role: 'Admin',
  accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
} }))

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'

function snapshotJson(overrides: Record<string, string | number> = {}) {
  return JSON.stringify({
    creditAccountId: ACCOUNT_ID,
    clientId: CLIENT_ID,
    ownedBalance: '__OWNED__',
    activelyReservedAmount: '__RESERVED__',
    availableBalance: '__AVAILABLE__',
    activeReservationCount: 0,
    status: 'active',
    asOf: '2026-08-24T07:00:00.000000',
    walletVersion: '__WALLET_VERSION__',
    ...overrides,
  })
    .replace('"__OWNED__"', '99999999999999.9999')
    .replace('"__RESERVED__"', '0.0001')
    .replace('"__AVAILABLE__"', '99999999999999.9998')
    .replace('"__WALLET_VERSION__"', '9223372036854775807')
}

describe('parseBillingAccountSnapshot', () => {
  it('preserves high-magnitude decimal lexemes exactly as strings', () => {
    const result = parseBillingAccountSnapshot(snapshotJson(), CLIENT_ID)

    expect(result.ownedBalance).toBe('99999999999999.9999')
    expect(result.activelyReservedAmount).toBe('0.0001')
    expect(result.availableBalance).toBe('99999999999999.9998')
    expect(result.activeReservationCount).toBe(0)
    expect(result.asOf).toBe('2026-08-24T07:00:00.000000')
    expect(result.walletVersion).toBe('9223372036854775807')
  })

  it('preserves zero decimal scale', () => {
    const result = parseBillingAccountSnapshot(
      snapshotJson({
        ownedBalance: '__ZERO__',
        activelyReservedAmount: '__ZERO__',
        availableBalance: '__ZERO__',
      }).replace(/"__ZERO__"/g, '0.0000'),
      CLIENT_ID
    )

    expect(result.ownedBalance).toBe('0.0000')
    expect(result.activelyReservedAmount).toBe('0.0000')
    expect(result.availableBalance).toBe('0.0000')
  })

  it('fails closed when the response belongs to another Client', () => {
    expect(() =>
      parseBillingAccountSnapshot(
        snapshotJson({ clientId: 'ffffffff-1111-2222-3333-444444444444' }),
        CLIENT_ID
      )
    ).toThrow('response Client does not match the requested Client')
  })

  it.each([
    snapshotJson({ status: 'deleted' }),
    snapshotJson({ activeReservationCount: -1 }),
    snapshotJson({ asOf: 'not-a-date' }),
    snapshotJson({ asOf: '2026-08-24T09:00:00+02:00' }),
    snapshotJson({ extra: 'not-allowed' }),
    snapshotJson({ walletVersion: -1 }),
    snapshotJson({ walletVersion: '__TOO_LARGE__' }).replace('"__TOO_LARGE__"', '9223372036854775808'),
  ])('rejects malformed or non-contract payloads', (payload) => {
    expect(() => parseBillingAccountSnapshot(payload, CLIENT_ID)).toThrow()
  })

  it('normalizes invalid JSON into a safe contract error', () => {
    expect(() => parseBillingAccountSnapshot('{invalid', CLIENT_ID)).toThrow(
      'Invalid Billing snapshot: response is not valid JSON'
    )
  })
})

const CAPABILITY_KEYS = [
  'manual_content_editing', 'ordinary_image_upload', 'ai_content_generation',
  'ai_image_generation', 'ai_source_ingestion', 'client_domain_binding',
  'product_domain_binding', 'analytics', 'ab_testing',
] as const

const CAPABILITY_LIMITS = [
  ['active_products', 'count', 2],
  ['hostnames', 'count', 2],
  ['storage_bytes', 'bytes', 10485760],
  ['requests_per_minute', 'requests_per_minute', 6],
  ['concurrent_ai_operations', 'count', 1],
  ['retention_days', 'days', 30],
] as const

function capabilitiesJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    clientId: CLIENT_ID,
    classificationSource: 'back_office.clients',
    classification: 'customer',
    classificationRevision: '__REVISION__',
    policySource: 'customer_subscription',
    policyVersion: 'fixture-9.3-v1',
    subscription: {
      storedTier: 'brand', effectiveTier: 'brand', status: 'active',
      tierRevision: '__TIER_REVISION__', validFrom: '2026-09-01T00:00:00.000000',
      validTo: '2026-10-01T00:00:00.000000',
    },
    flags: CAPABILITY_KEYS.map((key) => ({ key, enabled: key !== 'ai_source_ingestion' })),
    limits: CAPABILITY_LIMITS.map(([key, unit, value]) => ({ key, unit, value })),
    usage: CAPABILITY_LIMITS.map(([key, unit]) => ({
      key, unit, value: 0, measuredAt: '2026-09-10T12:00:00.000000',
    })),
    operations: CAPABILITY_KEYS.map((key) => ({
      key,
      outcome: key === 'ai_source_ingestion' ? 'denied' : 'eligible',
      permission: 'satisfied',
      feature: key === 'ai_source_ingestion' ? 'denied' : 'satisfied',
      entitlement: key.startsWith('ai_')
        ? (key === 'ai_source_ingestion' ? 'denied' : 'satisfied')
        : 'not_applicable',
      resourceLimit: 'satisfied',
      provider: key.startsWith('ai_') ? 'satisfied' : 'not_applicable',
      pricing: key.startsWith('ai_') ? 'satisfied' : 'not_applicable',
      funding: key.startsWith('ai_') ? 'available_requires_quote' : 'not_applicable',
      denialConditions: key === 'ai_source_ingestion'
        ? ['feature_not_available', 'entitlement_not_available'] : [],
    })),
    evaluatedAt: '2026-09-10T12:00:00.000000',
    nextBoundary: '2026-10-01T00:00:00.000000',
    ...overrides,
  }).replace('"__REVISION__"', '9223372036854775807')
    .replace('"__TIER_REVISION__"', '9007199254740993')
}

describe('Client capabilities adapter', () => {
  it('preserves every Int64 lexeme as an exact decimal string', () => {
    const result = parseClientCapabilities(capabilitiesJson(), CLIENT_ID)
    expect(result.classificationRevision).toBe('9223372036854775807')
    expect(result.subscription?.tierRevision).toBe('9007199254740993')
    expect(result.limits[0]?.value).toBe('2')
    expect(result.usage[0]?.value).toBe('0')
  })

  it('accepts only consistent internal and absent-customer subscription nullability', () => {
    const internal = parseClientCapabilities(capabilitiesJson({
      classification: 'soveris_internal', policySource: 'internal',
      subscription: null,
      operations: JSON.parse(capabilitiesJson()).operations.map((operation: Record<string, unknown>) => ({
        ...operation,
        entitlement: String(operation.key).startsWith('ai_') ? 'not_applicable' : operation.entitlement,
        denialConditions: operation.key === 'ai_source_ingestion' ? ['feature_not_available'] : [],
      })),
    }), CLIENT_ID)
    expect(internal.subscription).toBeNull()

    const freemium = parseClientCapabilities(capabilitiesJson({
      policySource: 'customer_freemium', subscription: null,
      operations: JSON.parse(capabilitiesJson()).operations.map((operation: Record<string, unknown>) => ({
        ...operation,
        outcome: String(operation.key).startsWith('ai_') ? 'denied' : operation.outcome,
        entitlement: String(operation.key).startsWith('ai_') ? 'denied' : operation.entitlement,
        denialConditions: String(operation.key).startsWith('ai_')
          ? [
              ...(operation.key === 'ai_source_ingestion' ? ['feature_not_available'] : []),
              'entitlement_not_available',
            ]
          : [],
      })),
    }), CLIENT_ID)
    expect(freemium.policySource).toBe('customer_freemium')
  })

  it.each(['transition_pending', 'stale_capability_evidence'] as const)(
    'accepts the closed supplemental denial condition %s',
    (condition) => {
      const base = JSON.parse(capabilitiesJson()
        .replace('9223372036854775807', '5')
        .replace('9007199254740993', '7')) as Record<string, unknown>
      base.operations = (base.operations as Array<Record<string, unknown>>).map((operation) =>
        operation.key === 'analytics'
          ? { ...operation, outcome: 'denied', denialConditions: [condition] }
          : operation)
      const parsed = parseClientCapabilities(JSON.stringify(base), CLIENT_ID)
      expect(parsed.operations.find((operation) => operation.key === 'analytics')?.denialConditions)
        .toEqual([condition])
    }
  )

  it.each([
    capabilitiesJson({ extra: true }),
    capabilitiesJson({ classificationSource: 'jwt' }),
    capabilitiesJson({ classification: 'Customer' }),
    capabilitiesJson({ policySource: 'customer_freemium' }),
    capabilitiesJson({
      operations: JSON.parse(capabilitiesJson()).operations.map((operation: Record<string, unknown>) =>
        operation.key === 'ai_content_generation'
          ? { ...operation, funding: 'sufficient_for_quote' }
          : operation),
    }),
    capabilitiesJson().replace('"classificationRevision":9223372036854775807', '"classificationRevision":-1'),
    capabilitiesJson().replace('"value":10485760', '"value":9223372036854775808'),
    capabilitiesJson().replace('"unit":"bytes"', '"unit":"count"'),
    capabilitiesJson().replace('"manual_content_editing"', '"unknown_feature"'),
    capabilitiesJson().replace('"manual_content_editing"', '"ai_content_generation"'),
    capabilitiesJson().replace('"clientId"', '"client_id"'),
    capabilitiesJson().replace('"clientId":', '"clientId":"duplicate","clientId":'),
  ])('rejects malformed, extra, unknown, duplicate, or inconsistent evidence', (payload) => {
    expect(() => parseClientCapabilities(payload, CLIENT_ID)).toThrow(ClientCapabilitiesContractError)
  })

  it('uses an API-root text response and canonical Client route', async () => {
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: capabilitiesJson(), status: 200,
    })
    const signal = new AbortController().signal

    await getClientCapabilities(CLIENT_ID.toUpperCase(), signal)

    expect(getApiRoot).toHaveBeenCalledWith(
      `/api/backoffice/clients/${CLIENT_ID}/capabilities`,
      { responseType: 'text', signal }
    )
  })
})

const SUBSCRIPTION_ID = '22222222-2222-3333-8444-555555555555'
const CREATION_OPERATION_ID = '01991f20-1234-7abc-8abc-1234567890ab'
const GRANT_ID = '33333333-2222-3333-8444-555555555555'
const GRANT_OPERATION_ID = '44444444-2222-3333-8444-555555555555'
const LEDGER_ENTRY_ID = '55555555-2222-3333-8444-555555555555'
const LIFECYCLE_OPERATION_ID = '01991f20-5678-7abc-8abc-1234567890ab'

const ENTITLEMENTS = {
  schemaVersion: 1 as const,
  rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
  featureFlags: { contentGeneration: true, imageGeneration: true },
}

const CREATION_REQUEST: CreateBillingSubscriptionRequest = {
  creationOperationId: CREATION_OPERATION_ID,
  planName: 'Pro',
  subscriptionTier: 'brand_premium',
  cycleCreditAmount: '99999999999999.9999',
  validFrom: '2026-09-01T00:00:00.000Z',
  validTo: null,
  changeEffectivePolicy: 'immediate',
  prorationPolicy: 'replace',
  unusedCreditPolicy: 'rollover',
  entitlements: ENTITLEMENTS,
}

function subscriptionItem(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    creationOperationId: CREATION_OPERATION_ID,
    planTermsOperationId: CREATION_OPERATION_ID,
    clientId: CLIENT_ID,
    planName: 'Pro',
    subscriptionTier: 'brand_premium',
    tierRevision: '__TIER_REVISION__',
    cycleCreditAmount: '__AMOUNT__',
    entitlements: ENTITLEMENTS,
    changeEffectivePolicy: 'immediate',
    prorationPolicy: 'replace',
    unusedCreditPolicy: 'rollover',
    billingCycleAnchor: '2026-09-01T00:00:00.000000',
    status: 'active',
    validFrom: '2026-09-01T00:00:00.000000',
    validTo: null,
    createdAt: '2026-09-01T00:00:00.000000',
    updatedAt: '2026-09-01T00:00:00.000000',
    ...overrides,
  }
}

function grantItem(overrides: Record<string, unknown> = {}) {
  return {
    grantId: GRANT_ID,
    grantOperationId: GRANT_OPERATION_ID,
    subscriptionId: SUBSCRIPTION_ID,
    planTermsOperationId: CREATION_OPERATION_ID,
    planNameSnapshot: 'Pro',
    subscriptionTierSnapshot: 'brand_premium',
    tierRevisionSnapshot: '__TIER_REVISION__',
    entitlementsSnapshot: ENTITLEMENTS,
    grantType: 'billing_cycle',
    cycleStart: '2026-09-01T00:00:00.000000',
    cycleEnd: '2026-10-01T00:00:00.000000',
    creditAmount: '__AMOUNT__',
    ledgerEntryId: LEDGER_ENTRY_ID,
    createdAt: '2026-09-01T00:00:00.000000',
    ...overrides,
  }
}

function subscriptionStateJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    clientId: CLIENT_ID,
    stateAsOf: '2026-09-06T12:00:00.000000',
    current: subscriptionItem({
      pendingImmediateDebit: { status: 'unsupported' },
      immediateChangeContext: { status: 'unsupported' },
    }),
    pendingChange: { status: 'unsupported' },
    subscriptionHistory: [],
    grantHistory: {
      items: [grantItem()], historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: 'opaque cursor',
    },
    pendingImmediateDebit: { status: 'unsupported' },
    immediateChangeContext: { status: 'unsupported' },
    ...overrides,
  }).replace(/"__AMOUNT__"/g, '99999999999999.9999')
    .replace(/"__TIER_REVISION__"/g, '9223372036854775807')
}

function creationReceiptJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    created: true,
    subscription: {
      subscriptionId: SUBSCRIPTION_ID,
      creationOperationId: CREATION_OPERATION_ID,
      planTermsOperationId: CREATION_OPERATION_ID,
      clientId: CLIENT_ID,
      planName: 'Pro',
      subscriptionTier: 'brand_premium', tierRevision: 0,
      cycleCreditAmount: '__AMOUNT__',
      entitlements: ENTITLEMENTS,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor: '2026-09-01T00:00:00+00:00', status: 'active',
      validFrom: '2026-09-01T00:00:00+00:00', validTo: null,
    },
    initialGrant: {
      grantId: GRANT_ID, grantOperationId: GRANT_OPERATION_ID, ledgerEntryId: LEDGER_ENTRY_ID,
      planTermsOperationId: CREATION_OPERATION_ID, planNameSnapshot: 'Pro',
      subscriptionTierSnapshot: 'brand_premium', tierRevisionSnapshot: 0,
      entitlementsSnapshot: ENTITLEMENTS, grantType: 'billing_cycle',
      cycleStart: '2026-09-01T00:00:00+00:00', cycleEnd: '2026-10-01T00:00:00+00:00',
      creditAmount: '__AMOUNT__',
    },
    account: {
      creditAccountId: ACCOUNT_ID, clientId: CLIENT_ID, ownedBalance: '__AMOUNT__',
      activelyReservedAmount: 0.0000, availableBalance: '__AMOUNT__', status: 'active',
      asOf: '2026-09-06T12:00:00+00:00',
    },
    ...overrides,
  }).replace(/"__AMOUNT__"/g, '99999999999999.9999')
}

describe('Billing subscription state adapter', () => {
  it('parses exact decimals, current/grant identities, and completed later-story markers', () => {
    const result = parseBillingSubscriptionState(subscriptionStateJson(), CLIENT_ID)
    expect(result.current?.cycleCreditAmount).toBe('99999999999999.9999')
    expect(result.current?.subscriptionTier).toBe('brand_premium')
    expect(result.current?.tierRevision).toBe('9223372036854775807')
    expect(result.grantHistory.items[0]?.creditAmount).toBe('99999999999999.9999')
    expect(result.grantHistory.items[0]?.tierRevisionSnapshot).toBe('9223372036854775807')
    expect(result.pendingChange).toEqual({ status: 'unsupported' })
    expect(result.current?.pendingImmediateDebit).toEqual({ status: 'unsupported' })
    expect(result.grantHistory.nextCursor).toBe('opaque cursor')
  })

  it('parses current and historical grant tier evidence independently', () => {
    const result = parseBillingSubscriptionState(subscriptionStateJson({
      current: subscriptionItem({ subscriptionTier: 'brand', tierRevision: 7 }),
      grantHistory: {
        items: [grantItem({ subscriptionTierSnapshot: 'basic', tierRevisionSnapshot: 2 })],
        historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null,
      },
    }), CLIENT_ID)
    expect(result.current?.subscriptionTier).toBe('brand')
    expect(result.current?.tierRevision).toBe('7')
    expect(result.grantHistory.items[0]?.subscriptionTierSnapshot).toBe('basic')
    expect(result.grantHistory.items[0]?.tierRevisionSnapshot).toBe('2')
  })

  it.each([
    ['"subscriptionTier":"brand_premium"', '"subscriptionTier":"Brand Premium"'],
    ['"subscriptionTier":"brand_premium"', '"subscriptionTier":"BRAND_PREMIUM"'],
    ['"subscriptionTier":"brand_premium"', '"subscriptionTier":null'],
    ['"subscriptionTier":"brand_premium"', '"subscriptionTier":3'],
    ['"tierRevision":9223372036854775807', '"tierRevision":-1'],
    ['"tierRevision":9223372036854775807', '"tierRevision":"0"'],
    ['"tierRevision":9223372036854775807', '"tierRevision":9223372036854775808'],
  ])('rejects invalid tier evidence', (before, after) => {
    expect(() => parseBillingSubscriptionState(
      subscriptionStateJson().replace(before, after), CLIENT_ID
    )).toThrow(BillingSubscriptionContractError)
  })

  it('accepts authorized absence and rejects unknown, duplicate, and cross-Client evidence', () => {
    const empty = subscriptionStateJson({
      current: null, pendingChange: null, subscriptionHistory: [],
      grantHistory: { items: [], historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null },
      pendingImmediateDebit: undefined, immediateChangeContext: undefined,
    })
    expect(parseBillingSubscriptionState(empty, CLIENT_ID).current).toBeNull()
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({ extra: 'private' }), CLIENT_ID)).toThrow('closed contract')
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      clientId: 'ffffffff-1111-2222-3333-444444444444',
    }), CLIENT_ID)).toThrow('state Client')
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      grantHistory: {
        items: [grantItem(), grantItem()], historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null,
      },
    }), CLIENT_ID)).toThrow('duplicate grant')
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      grantHistory: {
        items: [grantItem(), grantItem({
          grantId: '66666666-6666-4666-8666-666666666666',
          ledgerEntryId: '77777777-7777-4777-8777-777777777777',
        })],
        historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null,
      },
    }), CLIENT_ID)).toThrow('duplicate grant identity')
  })

  it('rejects invalid status partitions and identities while preserving server time order', () => {
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      current: subscriptionItem({ status: 'cancelled' }),
    }), CLIENT_ID)).toThrow()
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      subscriptionHistory: [subscriptionItem({ status: 'active' })],
    }), CLIENT_ID)).toThrow()
    expect(() => parseBillingSubscriptionState(subscriptionStateJson({
      grantHistory: {
        items: [grantItem({ subscriptionId: '99999999-2222-4333-8444-555555555555' })],
        historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null,
      },
    }), CLIENT_ID)).toThrow()
    expect(parseBillingSubscriptionState(subscriptionStateJson({
      grantHistory: {
        items: [
          grantItem({ cycleStart: '2026-08-01T00:00:00.000000', cycleEnd: '2026-09-01T00:00:00.000000' }),
          grantItem({
            grantId: '66666666-6666-4666-8666-666666666666',
            grantOperationId: '77777777-7777-4777-8777-777777777777',
            ledgerEntryId: '88888888-7777-4777-8777-777777777777',
            cycleStart: '2026-09-01T00:00:00.000000', cycleEnd: '2026-10-01T00:00:00.000000',
          }),
        ], historyAsOf: '2026-09-06T12:00:00.000000', nextCursor: null,
      },
    }), CLIENT_ID).grantHistory.items).toHaveLength(2)
  })

  it('uses initial pageSize or exactly one encoded continuation cursor', async () => {
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: subscriptionStateJson(), status: 200,
    })
    const signal = new AbortController().signal
    await getBillingSubscriptionState(CLIENT_ID, { pageSize: 20 }, signal)
    await getBillingSubscriptionState(CLIENT_ID, { cursor: 'opaque +/ cursor' })
    expect(getApiRoot.mock.calls[0]).toEqual([
      `/api/backoffice/clients/${CLIENT_ID}/billing/subscriptions?pageSize=20`,
      { responseType: 'text', signal },
    ])
    expect(getApiRoot.mock.calls[1]?.[0]).toBe(
      `/api/backoffice/clients/${CLIENT_ID}/billing/subscriptions?cursor=opaque+%2B%2F+cursor`
    )
  })
})

describe('Billing subscription creation adapter', () => {
  it.each(['freemium', 'basic', 'brand', 'brand_premium'] as const)(
    'serializes and validates the exact %s tier',
    (subscriptionTier) => {
      const request = { ...CREATION_REQUEST, subscriptionTier }
      const receipt = creationReceiptJson()
        .split('brand_premium').join(subscriptionTier)
      expect(serializeCreateBillingSubscriptionRequest(request)).toContain(
        `"subscriptionTier":"${subscriptionTier}"`
      )
      expect(parseBillingSubscriptionCreationReceipt(
        receipt, CLIENT_ID, request
      ).subscription.subscriptionTier).toBe(subscriptionTier)
    }
  )

  it('serializes the high-magnitude amount as an exact JSON number and no extra identities', () => {
    const body = serializeCreateBillingSubscriptionRequest(CREATION_REQUEST)
    expect(body).toContain('"cycleCreditAmount":99999999999999.9999')
    expect(JSON.parse(body)).toEqual({
      ...CREATION_REQUEST,
      cycleCreditAmount: 100000000000000,
    })
    expect(body).not.toContain('clientId')
    expect(body).not.toContain('grantOperationId')
    expect(body).not.toContain('correlation')
  })

  it('rejects invalid runtime policies, entitlement values, and over-precision instants', () => {
    expect(() => serializeCreateBillingSubscriptionRequest({
      ...CREATION_REQUEST,
      prorationPolicy: 'none',
    } as unknown as CreateBillingSubscriptionRequest)).toThrow('policies')
    expect(() => serializeCreateBillingSubscriptionRequest({
      ...CREATION_REQUEST,
      entitlements: { ...ENTITLEMENTS, schemaVersion: 2 },
    } as unknown as CreateBillingSubscriptionRequest)).toThrow('entitlements')
    expect(() => serializeCreateBillingSubscriptionRequest({
      ...CREATION_REQUEST,
      validFrom: '2026-09-01T00:00:00.1234567Z',
    })).toThrow('UTC instant')
  })

  it.each([undefined, null, 'Brand Premium', 'BRAND_PREMIUM', 'brand-premium', 3])(
    'rejects a non-canonical runtime tier %s',
    (subscriptionTier) => {
      expect(() => serializeCreateBillingSubscriptionRequest({
        ...CREATION_REQUEST,
        subscriptionTier,
      } as unknown as CreateBillingSubscriptionRequest)).toThrow('subscriptionTier')
    }
  )

  it.each([
    { tierRevision: 0 },
    { subscription_tier: 'brand_premium' },
  ])('rejects extra or aliased creation material %o', (extra) => {
    expect(() => serializeCreateBillingSubscriptionRequest({
      ...CREATION_REQUEST,
      ...extra,
    })).toThrow('closed contract')
  })

  it('rejects tier fields nested in entitlements v1', () => {
    expect(() => serializeCreateBillingSubscriptionRequest({
      ...CREATION_REQUEST,
      entitlements: { ...ENTITLEMENTS, subscriptionTier: 'brand_premium' },
    } as unknown as CreateBillingSubscriptionRequest)).toThrow('closed contract')
  })

  it('validates the immutable receipt and accepts equivalent UTC rendering', () => {
    const result = parseBillingSubscriptionCreationReceipt(
      creationReceiptJson(), CLIENT_ID, CREATION_REQUEST
    )
    expect(result.subscription.creationOperationId).toBe(CREATION_OPERATION_ID)
    expect(result.subscription.subscriptionTier).toBe('brand_premium')
    expect(result.subscription.tierRevision).toBe('0')
    expect(result.initialGrant.ledgerEntryId).toBe(LEDGER_ENTRY_ID)
    expect(result.initialGrant.subscriptionTierSnapshot).toBe('brand_premium')
    expect(result.initialGrant.tierRevisionSnapshot).toBe('0')
    expect(result.account.ownedBalance).toBe('99999999999999.9999')

    const boundedRequest = {
      ...CREATION_REQUEST,
      validTo: '2026-10-01T00:00:00.000000',
    }
    const boundedReceipt = creationReceiptJson()
      .replace('"validTo":null', '"validTo":"2026-10-01T00:00:00.000000"')
    expect(parseBillingSubscriptionCreationReceipt(
      boundedReceipt, CLIENT_ID, boundedRequest
    ).subscription.validTo).toBe('2026-10-01T00:00:00.000000')
  })

  it('rejects mismatched material and closed receipt violations', () => {
    expect(() => parseBillingSubscriptionCreationReceipt(
      creationReceiptJson({ created: true, extra: 'private' }), CLIENT_ID, CREATION_REQUEST
    )).toThrow('closed contract')
    expect(() => parseBillingSubscriptionCreationReceipt(
      creationReceiptJson(), CLIENT_ID, {
        ...CREATION_REQUEST,
        creationOperationId: '01991f20-9999-7abc-8abc-1234567890ab',
      }
    )).toThrow('confirmed operation')
    expect(() => parseBillingSubscriptionCreationReceipt(
      creationReceiptJson().replace(
        '"subscriptionTier":"brand_premium"', '"subscriptionTier":"brand"'
      ), CLIENT_ID, CREATION_REQUEST
    )).toThrow('confirmed operation')
    expect(() => parseBillingSubscriptionCreationReceipt(
      creationReceiptJson().replace(
        '"subscriptionTierSnapshot":"brand_premium"',
        '"subscriptionTierSnapshot":"basic"'
      ), CLIENT_ID, CREATION_REQUEST
    )).toThrow('confirmed operation')
  })

  it('rejects a non-B1 receipt or an inconsistent immutable account projection', () => {
    const wrongAnchor = JSON.parse(creationReceiptJson()) as Record<string, unknown>
    ;(wrongAnchor.subscription as Record<string, unknown>).billingCycleAnchor = '2026-09-02T00:00:00.000000'
    expect(() => parseBillingSubscriptionCreationReceipt(
      JSON.stringify(wrongAnchor), CLIENT_ID, CREATION_REQUEST
    )).toThrow()

    const wrongCycle = JSON.parse(creationReceiptJson()) as Record<string, unknown>
    ;(wrongCycle.initialGrant as Record<string, unknown>).cycleEnd = '2026-10-02T00:00:00.000000'
    expect(() => parseBillingSubscriptionCreationReceipt(
      JSON.stringify(wrongCycle), CLIENT_ID, CREATION_REQUEST
    )).toThrow()

    const wrongBalance = JSON.parse(creationReceiptJson()) as Record<string, unknown>
    ;(wrongBalance.account as Record<string, unknown>).availableBalance = 1
    expect(() => parseBillingSubscriptionCreationReceipt(
      JSON.stringify(wrongBalance), CLIENT_ID, CREATION_REQUEST
    )).toThrow()
  })
})

describe('Billing subscription lifecycle adapter', () => {
  const request = {
    lifecycleOperationId: LIFECYCLE_OPERATION_ID,
    action: 'pause' as const,
    expectedStatus: 'active' as const,
    reason: 'Temporary administrative hold',
  }
  const receipt = {
    lifecycleOperationId: LIFECYCLE_OPERATION_ID,
    clientId: CLIENT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    action: 'pause',
    previousStatus: 'active',
    status: 'paused',
    reason: request.reason,
    effectiveAt: '2026-09-07T09:00:00.123456',
    operationAsOf: '2026-09-07T09:00:00.123456',
  }

  it('serializes only the four exact material fields and validates Unicode scalars', () => {
    const body = serializeBillingSubscriptionLifecycleRequest(request)
    expect(JSON.parse(body)).toEqual(request)
    expect(body).toBe(JSON.stringify(request))
    expect(body).not.toContain('clientId')
    expect(body).not.toContain('subscriptionId')

    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: '' })).toThrow('reason')
    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: ' leading' })).toThrow('reason')
    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: 'trailing\u00a0' })).toThrow('reason')
    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: 'control\u0000' })).toThrow('reason')
    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: '\ud800' })).toThrow('reason')
    expect(serializeBillingSubscriptionLifecycleRequest({ ...request, reason: '😀'.repeat(512) })).toBeTruthy()
    expect(() => serializeBillingSubscriptionLifecycleRequest({ ...request, reason: '😀'.repeat(513) })).toThrow('reason')
    expect(JSON.parse(serializeBillingSubscriptionLifecycleRequest({
      ...request, lifecycleOperationId: LIFECYCLE_OPERATION_ID.toUpperCase(),
    })).lifecycleOperationId).toBe(LIFECYCLE_OPERATION_ID)
  })

  it('rejects invalid identity, action/status pairs, and runtime extra fields', () => {
    expect(() => serializeBillingSubscriptionLifecycleRequest({
      ...request, lifecycleOperationId: '11111111-2222-3333-8444-555555555555',
    })).toThrow('UUIDv7')
    expect(() => serializeBillingSubscriptionLifecycleRequest({
      ...request, action: 'reactivate', expectedStatus: 'active',
    } as unknown as typeof request)).toThrow('action')
    expect(() => serializeBillingSubscriptionLifecycleRequest({
      ...request, action: 'pause', expectedStatus: 'paused',
    } as unknown as typeof request)).toThrow('action')
    expect(serializeBillingSubscriptionLifecycleRequest({
      ...request, action: 'reactivate', expectedStatus: 'paused',
    })).toContain('"action":"reactivate"')
    for (const expectedStatus of ['active', 'paused'] as const) {
      expect(serializeBillingSubscriptionLifecycleRequest({
        ...request, action: 'cancel', expectedStatus,
      })).toContain('"action":"cancel"')
      expect(serializeBillingSubscriptionLifecycleRequest({
        ...request, action: 'expire', expectedStatus,
      })).toContain('"action":"expire"')
    }
    expect(() => serializeBillingSubscriptionLifecycleRequest({
      ...request, clientId: CLIENT_ID,
    } as typeof request)).toThrow('fields')
  })

  it('validates the closed nine-field receipt and transition timestamps', () => {
    const parsed = parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify(receipt), CLIENT_ID, SUBSCRIPTION_ID, request
    )
    expect(parsed).toEqual(receipt)

    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, extra: 'private' }), CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('closed contract')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, clientId: 'ffffffff-1111-2222-8333-444444444444' }),
      CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('confirmed operation')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, status: 'cancelled' }), CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('transition')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, effectiveAt: '2026-09-07T09:00:00.123455' }),
      CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('timestamp')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify(receipt).replace('"action":"pause"', '"action":"pause","action":"pause"'),
      CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('duplicate')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      '{"lifecycleOperationId":', CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow()
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, reason: 'different' }), CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('confirmed operation')
    const mismatches = [
      ['subscriptionId', 'ffffffff-1111-2222-8333-444444444444'],
      ['lifecycleOperationId', '01991f20-5678-7abc-8abc-1234567890ac'],
      ['action', 'cancel'],
      ['previousStatus', 'paused'],
    ] as const
    for (const [field, value] of mismatches) {
      expect(() => parseBillingSubscriptionLifecycleReceipt(
        JSON.stringify({ ...receipt, [field]: value }), CLIENT_ID, SUBSCRIPTION_ID, request
      )).toThrow()
    }
    const { reason: _missingReason, ...missingField } = receipt
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify(missingField), CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('closed contract')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...receipt, effectiveAt: 'not-an-instant' }),
      CLIENT_ID, SUBSCRIPTION_ID, request
    )).toThrow('UTC instant')
  })

  it('accepts all valid lifecycle transitions without altering exact reason text', () => {
    const cases = [
      ['reactivate', 'paused', 'active'],
      ['cancel', 'active', 'cancelled'],
      ['cancel', 'paused', 'cancelled'],
      ['expire', 'active', 'expired'],
      ['expire', 'paused', 'expired'],
    ] as const
    for (const [action, previousStatus, status] of cases) {
      const exactReason = `Exact ${action} reason {"scope":"Client"}`
      const actionRequest = { ...request, action, expectedStatus: previousStatus, reason: exactReason }
      const actionReceipt = {
        ...receipt, action, previousStatus, status, reason: exactReason,
        ...(action === 'expire' ? {
          effectiveAt: '2026-09-01T00:00:00.000000',
          operationAsOf: '2026-09-07T09:00:00.123456',
        } : {}),
      }
      expect(parseBillingSubscriptionLifecycleReceipt(
        JSON.stringify(actionReceipt), CLIENT_ID, SUBSCRIPTION_ID, actionRequest,
        action === 'expire' ? '2026-09-01T00:00:00.000000' : null
      )).toEqual(actionReceipt)
    }
  })

  it('requires expire to use the confirmed validTo and posts the retained body once', async () => {
    const expireRequest = {
      ...request, action: 'expire' as const, expectedStatus: 'active' as const,
    }
    const expireReceipt = {
      ...receipt, action: 'expire', status: 'expired',
      effectiveAt: '2026-09-01T00:00:00.000000',
      operationAsOf: '2026-09-07T09:00:00.123456',
    }
    expect(parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify(expireReceipt), CLIENT_ID, SUBSCRIPTION_ID, expireRequest,
      '2026-09-01T00:00:00.000000'
    ).status).toBe('expired')
    expect(() => parseBillingSubscriptionLifecycleReceipt(
      JSON.stringify({ ...expireReceipt, effectiveAt: '2026-09-02T00:00:00.000000' }),
      CLIENT_ID, SUBSCRIPTION_ID, expireRequest, '2026-09-01T00:00:00.000000'
    )).toThrow('validTo')

    const body = serializeBillingSubscriptionLifecycleRequest(request)
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: JSON.stringify(receipt), status: 200,
    })
    await postBillingSubscriptionLifecycle(CLIENT_ID, SUBSCRIPTION_ID, request, undefined, body)
    expect(post).toHaveBeenCalledWith(
      `/api/backoffice/clients/${CLIENT_ID}/billing/subscriptions/${SUBSCRIPTION_ID}/lifecycle`,
      body,
      { responseType: 'text', signal: undefined, headers: { 'Content-Type': 'application/json' } }
    )
  })
})

describe('getBillingAccountSnapshot', () => {
  it('uses the canonical API-root route and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: snapshotJson(),
      status: 200,
    })

    await getBillingAccountSnapshot(CLIENT_ID, signal)

    expect(getApiRoot).toHaveBeenCalledWith(
      `/api/backoffice/clients/${CLIENT_ID}/billing/account`,
      expect.objectContaining({ responseType: 'text', signal })
    )
  })
})

const LEDGER_ID = '77777777-7777-7777-7777-777777777777'
const OPERATION_ID = '88888888-8888-8888-8888-888888888888'

function ledgerJson(overrides: Record<string, unknown> = {}, pageOverrides: Record<string, unknown> = {}) {
  const item = {
    ledgerId: LEDGER_ID,
    creditAccountId: ACCOUNT_ID,
    jobId: null,
    reservationId: null,
    adjustmentId: null,
    operationId: OPERATION_ID,
    transactionType: 'subscription_grant',
    amount: '__AMOUNT__',
    balanceAfter: '__BALANCE__',
    ruleId: null,
    ruleVersion: null,
    actorUserId: null,
    reason: null,
    createdAt: '2026-08-24T07:00:00.000000',
    ...overrides,
  }
  return JSON.stringify({
    items: [item],
    asOf: '2026-08-24T08:00:00.000000',
    nextCursor: 'opaque-private-token',
    ...pageOverrides,
  })
    .replace('"__AMOUNT__"', '99999999999999.9999')
    .replace('"__BALANCE__"', '99999999999999.9999')
}

describe('parseBillingLedgerPage', () => {
  it('preserves exact decimal number lexemes and nullable fields', () => {
    const result = parseBillingLedgerPage(ledgerJson())

    expect(result.items[0]?.amount).toBe('99999999999999.9999')
    expect(result.items[0]?.balanceAfter).toBe('99999999999999.9999')
    expect(result.items[0]?.actorUserId).toBeNull()
    expect(result.nextCursor).toBe('opaque-private-token')
  })

  it.each([
    ['subscription_grant', '1.0000'],
    ['reservation', '-1.0000'],
    ['consumption', '-1.0000'],
    ['promotion', '1.0000'],
    ['reservation_expired', '1.0000'],
    ['reservation_committed', '1.0000'],
    ['reservation_released', '1.0000'],
    ['manual_adjustment', '1.0000'],
    ['manual_adjustment', '-1.0000'],
    ['reversal', '1.0000'],
    ['reversal', '-1.0000'],
  ])('accepts the required %s sign', (transactionType, amount) => {
    const payload = ledgerJson({ transactionType, amount: '__SIGNED__' })
      .replace('"__SIGNED__"', amount)
    expect(parseBillingLedgerPage(payload).items[0]?.amount).toBe(amount)
  })

  it.each(['0', '0.0000', '-0.0000'])('rejects lexical zero amount %s', (amount) => {
    const payload = ledgerJson({ amount: '__ZERO__' }).replace('"__ZERO__"', amount)
    expect(() => parseBillingLedgerPage(payload)).toThrow('Invalid Billing ledger')
  })

  it.each([
    ['subscription_grant', '-1.0000'],
    ['reservation', '1.0000'],
    ['consumption', '1.0000'],
    ['promotion', '-1.0000'],
    ['reservation_expired', '-1.0000'],
    ['reservation_committed', '-1.0000'],
    ['reservation_released', '-1.0000'],
  ])('rejects the wrong %s sign', (transactionType, amount) => {
    const payload = ledgerJson({ transactionType, amount: '__SIGNED__' })
      .replace('"__SIGNED__"', amount)
    expect(() => parseBillingLedgerPage(payload)).toThrow('amount sign')
  })

  it.each(['manual_adjustment', 'reversal'])('rejects zero as the invalid %s sign case', (transactionType) => {
    const payload = ledgerJson({ transactionType, amount: '__ZERO__' })
      .replace('"__ZERO__"', '0.0000')
    expect(() => parseBillingLedgerPage(payload)).toThrow('amount must be nonzero')
  })

  it('accepts zero balanceAfter and a maximum-range negative adjustment without coercion', () => {
    const payload = ledgerJson({
      transactionType: 'manual_adjustment', amount: '__SIGNED__', balanceAfter: '__ZERO__',
    })
      .replace('"__SIGNED__"', '-99999999999999.9999')
      .replace('"__ZERO__"', '0.0000')

    const result = parseBillingLedgerPage(payload)
    expect(result.items[0]?.amount).toBe('-99999999999999.9999')
    expect(result.items[0]?.balanceAfter).toBe('0.0000')
  })

  it.each([
    ledgerJson({}, { extra: 'nope' }),
    ledgerJson({ jobId: undefined }),
    ledgerJson({ reason: 12 }),
    ledgerJson({ createdAt: '2026-08-24T09:00:00+02:00' }),
    ledgerJson({}, { asOf: '2026-08-24T10:00:00+02:00' }),
    ledgerJson({}, { nextCursor: '' }),
  ])('rejects closed-shape, nullable, UTC, and cursor contract violations', (payload) => {
    expect(() => parseBillingLedgerPage(payload)).toThrow('Invalid Billing ledger')
  })

  it('rejects duplicate rows and defers UTC ordering to the backend', () => {
    const base = JSON.parse(ledgerJson({ amount: 1, balanceAfter: 1 })) as {
      items: Array<Record<string, unknown>>
      asOf: string
      nextCursor: string | null
    }
    const item = base.items[0]!
    expect(() => parseBillingLedgerPage(JSON.stringify({
      ...base, items: [item, { ...item }],
    }))).toThrow('duplicate ledger row')
    expect(parseBillingLedgerPage(JSON.stringify({
      ...base, items: [{ ...item, createdAt: '2026-08-24T09:00:00.000000' }],
    })).items).toHaveLength(1)
  })

  it('rejects wrong signs, negative balance, extra fields, and filtered-account mismatch', () => {
    expect(() => parseBillingLedgerPage(
      ledgerJson({ transactionType: 'reservation', amount: '__SIGNED__' }).replace('"__SIGNED__"', '1.0000')
    )).toThrow()
    expect(() => parseBillingLedgerPage(
      ledgerJson({ balanceAfter: '__NEGATIVE__' }).replace('"__NEGATIVE__"', '-1.0000')
    )).toThrow()
    expect(() => parseBillingLedgerPage(ledgerJson({ extra: 'nope' }))).toThrow()
    expect(() => parseBillingLedgerPage(
      ledgerJson({ creditAccountId: 'ffffffff-1111-2222-3333-444444444444' }),
      ACCOUNT_ID
    )).toThrow('filtered Credit account')
  })
})

describe('getBillingLedgerPage', () => {
  it('serializes only normalized initial filters and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: ledgerJson(), status: 200,
    })

    await getBillingLedgerPage(CLIENT_ID, {
      filters: {
        creditAccountId: ACCOUNT_ID,
        transactionType: 'subscription_grant',
        pageSize: 20,
      },
    }, signal)

    const [url, config] = getApiRoot.mock.calls[0] ?? []
    expect(url).toBe(`/api/backoffice/clients/${CLIENT_ID}/billing/ledger?creditAccountId=${ACCOUNT_ID}&transactionType=subscription_grant&pageSize=20`)
    expect(config).toEqual(expect.objectContaining({ responseType: 'text', signal }))
  })

  it('sends a continuation as exactly one opaque cursor parameter', async () => {
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: ledgerJson(), status: 200,
    })

    await getBillingLedgerPage(CLIENT_ID, { cursor: 'opaque +/ token' })

    expect(getApiRoot.mock.calls[0]?.[0]).toBe(
      `/api/backoffice/clients/${CLIENT_ID}/billing/ledger?cursor=opaque+%2B%2F+token`
    )
  })
})

const EXPORT_ID = '0198d2b0-1234-7abc-8abc-1234567890ab'
const EXPORT_FILTERS: BillingLedgerExportFilters = {
  creditAccountId: ACCOUNT_ID,
  from: '2026-08-24T06:00:00.000000',
  to: '2026-08-24T09:00:00.000000',
  transactionType: 'promotion',
  actorUserId: null,
  jobId: null,
  reservationId: null,
}
const EXPORT_ATTEMPT: BillingLedgerExportAttempt = {
  exportId: EXPORT_ID,
  clientId: CLIENT_ID,
  filters: EXPORT_FILTERS,
  requestedAt: '2026-08-24T10:00:00.000000',
  asOf: '2026-08-24T10:00:00.000000',
}

function acceptedJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...EXPORT_ATTEMPT, status: 'pending', ...overrides })
}

function statusJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...EXPORT_ATTEMPT,
    status: 'completed',
    rowCount: '__ROWS__',
    byteSize: '__BYTES__',
    artifactExpiresAt: '2099-08-24T11:00:00.000000',
    failureCode: null,
    reference: 'opaque-bearer-reference',
    referenceExpiresAt: '2099-08-24T10:05:00.000000',
    ...overrides,
  }).replace('"__ROWS__"', '9007199254740993').replace('"__BYTES__"', '9223372036854775807')
}

describe('Billing ledger export adapter', () => {
  it('posts the exact API-root body, omits page size, uses empty filters, and forwards cancellation', async () => {
    const postApiRoot = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: acceptedJson(), status: 202,
    })
    const signal = new AbortController().signal

    await requestBillingLedgerExport(CLIENT_ID.toUpperCase(), {
      creditAccountId: ACCOUNT_ID,
      from: EXPORT_FILTERS.from ?? undefined,
      to: EXPORT_FILTERS.to ?? undefined,
      transactionType: 'promotion',
      pageSize: 100,
    }, signal)

    expect(postApiRoot).toHaveBeenCalledWith('/api/backoffice/billing/ledger/exports', {
      clientId: CLIENT_ID,
      filters: {
        creditAccountId: ACCOUNT_ID,
        from: EXPORT_FILTERS.from,
        to: EXPORT_FILTERS.to,
        transactionType: 'promotion', actorUserId: null, jobId: null, reservationId: null,
      },
    }, { responseType: 'text', signal })

    postApiRoot.mockResolvedValueOnce({
      data: acceptedJson({ filters: Object.fromEntries(Object.keys(EXPORT_FILTERS).map((key) => [key, null])) }),
      status: 202,
    })
    await requestBillingLedgerExport(CLIENT_ID, {})
    expect(postApiRoot.mock.calls[1]?.[1]).toEqual({ clientId: CLIENT_ID, filters: { creditAccountId: null, from: null, to: null, transactionType: null, actorUserId: null, jobId: null, reservationId: null } })
  })

  it('enforces accepted closed shape, UUIDv7, matching scope, pending state, and one timestamp', () => {
    expect(parseBillingLedgerExportAccepted(acceptedJson(), CLIENT_ID, EXPORT_FILTERS).exportId).toBe(EXPORT_ID)
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ exportId: '11111111-2222-3333-4444-555555555555' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('export identifier')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ status: 'processing' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('lifecycle')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ extra: 'private' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('closed contract')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ clientId: 'ffffffff-1111-2222-3333-444444444444' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('scope')
  })

  it('preserves Int64 lexemes, validates lifecycle fields, and separates the ephemeral reference', () => {
    const result = parseBillingLedgerExportStatus(statusJson(), EXPORT_ATTEMPT)
    expect(result.metadata.rowCount).toBe('9007199254740993')
    expect(result.metadata.byteSize).toBe('9223372036854775807')
    expect(result.reference).toEqual({
      value: 'opaque-bearer-reference', expiresAt: '2099-08-24T10:05:00.000000',
    })
    expect(result.metadata).not.toHaveProperty('reference')

    expect(() => parseBillingLedgerExportStatus(statusJson({ rowCount: -1 }), EXPORT_ATTEMPT)).toThrow('Int64')
    expect(() => parseBillingLedgerExportStatus(statusJson({ status: 'pending' }), EXPORT_ATTEMPT)).toThrow('lifecycle')
    expect(() => parseBillingLedgerExportStatus(statusJson({ failureCode: 'raw_internal_code' }), EXPORT_ATTEMPT)).toThrow('classification')
    expect(() => parseBillingLedgerExportStatus(statusJson({ asOf: '2026-08-24T10:00:01.000000' }), EXPORT_ATTEMPT)).toThrow('scope')
    expect(() => parseBillingLedgerExportStatus(statusJson({ unknown: 'value' }), EXPORT_ATTEMPT)).toThrow('closed contract')
  })

  it('gets status with cancellation and redeems once with the closed reference body', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({ data: statusJson(), status: 200 })
    const postApiRoot = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: new Blob(['a,b\n1,2\n'], { type: 'text/csv; charset=utf-8' }),
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ledger-export-${EXPORT_ID}-local.csv"`,
      },
    })

    const status = await getBillingLedgerExportStatus(EXPORT_ATTEMPT, signal)
    await redeemBillingLedgerExport(EXPORT_ATTEMPT, status.reference!, signal)

    expect(getApiRoot).toHaveBeenCalledWith(`/api/backoffice/billing/ledger/exports/${EXPORT_ID}`, { responseType: 'text', signal })
    expect(postApiRoot).toHaveBeenCalledWith(`/api/backoffice/billing/ledger/exports/${EXPORT_ID}/redemptions`, {
      reference: 'opaque-bearer-reference',
    }, { responseType: 'blob', signal })
  })

  it('rejects a lookalike download media type before exposing a Blob', async () => {
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: new Blob(['not csv'], { type: 'text/csv-unsafe' }),
      status: 200,
      headers: { 'content-type': 'text/csv-unsafe' },
    })

    await expect(redeemBillingLedgerExport(EXPORT_ATTEMPT, {
      value: 'opaque-bearer-reference', expiresAt: '2099-08-24T10:05:00.000000',
    })).rejects.toThrow('download response is invalid')
  })
})

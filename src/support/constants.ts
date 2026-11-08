export const SUPPORT = {
  api: '/api/backoffice/support',
  permission: 'platform:support:operate',
  scopeVersion: 'support-read-v1',
  identityRead: 'product.identity.read',
  draftRead: 'product.draft.read',
  maximumBodyBytes: 8192,
  maximumResponseBytes: 1048576,
  maximumDraftBytes: 262144,
  maximumProducts: 20,
  maximumMinutes: 60,
  freshProofMilliseconds: 300000,
  maximumReasonScalars: 500,
  maximumReferenceCharacters: 128,
  maximumPageSize: 50,
  lookupPageSize: 20,
  ownerRefreshMilliseconds: 15000,
  deadlineMilliseconds: 15000,
  httpDatePrecisionMilliseconds: 1000,
  maximumRetrySeconds: 600,
  peerChannel: 'soveris-support-invalidation-v1',
  retiredEvent: 'support:retired',
  peerEvent: 'support:invalidate-peers',
} as const

export const SUPPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const SUPPORT_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const SUPPORT_HASH = /^[a-f0-9]{64}$/
export const SUPPORT_REVISION = /^(0|[1-9][0-9]{0,18})$/
export const SUPPORT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/
export const SUPPORT_CASE = /^[A-Za-z0-9._:/#-]{1,128}$/
export const SUPPORT_BUTTON_CLASS = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-solid px-4 py-2.5 text-sm font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50'
export const SUPPORT_INPUT_CLASS = 'block min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
export const SUPPORT_STATES = ['requested', 'approved', 'active', 'ended'] as const
export const SUPPORT_OPERATIONS = [SUPPORT.draftRead, SUPPORT.identityRead] as const
export const SUPPORT_FIELDS = {
  context: ['id', 'operatorId', 'operatorName', 'targetClientId', 'targetClientName', 'productIds', 'operations',
    'scopeVersion', 'scopeHash', 'revision', 'state', 'startsAt', 'expiresAt', 'products', 'originalWorkspaceName', 'supportCaseReference', 'createdAt'],
  metadata: ['labelReviewHash', 'requestLabels', 'currentLabels', 'labelsChanged', 'durationMinutes', 'reason', 'requestExpiresAt', 'approvedAt', 'activationDeadline', 'endedAt', 'terminalReason'],
  receipt: ['operationId', 'command', 'outcome'],
  rejectedOutcome: ['status', 'code', 'requestHash', 'retryAfter'],
  outcome: ['id', 'state', 'revision', 'createdAt', 'approvedAt', 'startsAt', 'expiresAt', 'endedAt'],
  identity: ['id', 'clientId', 'name', 'slug', 'status', 'revision', 'draftSchemaVersion', 'draftRevision'],
  draft: ['productId', 'draftSchemaVersion', 'draftRevision', 'draft'],
} as const

export const SUPPORT_COMMAND_KINDS = ['request', 'approve', 'revoke', 'activate', 'exit'] as const
export const SUPPORT_ERROR_CODES = ['selection_ambiguous', 'request_changed', 'command_conflict'] as const
export const SUPPORT_ERROR_FIELDS = ['status', 'code', 'correlationId', 'field'] as const

/** These finite server conflicts reject the current command before its effects. */
export const SUPPORT_PRE_EFFECT_CONFLICTS = ['selection_ambiguous', 'request_changed'] as const

export const SUPPORT_RATE_REJECTED = 'rate_limited_before_effect'
export const SUPPORT_RATE_ERROR_FIELDS = ['status', 'code', 'correlationId', 'operationId', 'requestHash'] as const

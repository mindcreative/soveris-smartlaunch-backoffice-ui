export const AI_IMAGE_TARGET_ROLES = ['hero', 'feature'] as const
export const AI_IMAGE_JOB_STATUSES = [
  'pending', 'processing', 'retrying', 'dlq', 'completed', 'failed', 'execution_unknown',
] as const

export type AiImageTargetRole = typeof AI_IMAGE_TARGET_ROLES[number]
export type AiImageJobStatus = typeof AI_IMAGE_JOB_STATUSES[number]

export interface AiImageGenerationRequest {
  idempotencyKey: string
  prompt: string
  targetRole: AiImageTargetRole
  quoteId: string
}

export interface AiImageAdmissionQuote {
  quoteId: string
  operation: 'image_generation'
  targetRole: AiImageTargetRole
  quotedCredits: string
  ruleVersion: string
  issuedAt: string
  expiresAt: string
}

export interface AiImageAdmissionReceipt {
  jobId: string
  reservationId: string
  eventId: string
  quotedCredits: string
  status: string
  correlationId: string
  replay: boolean
}

export interface AiImageQuote {
  credits: string
  ruleVersion: string
}

export interface AiImageReservation {
  reservationId: string
  state: 'active' | 'committed' | 'released'
  estimatedCredits: string
  actualCredits: string | null
  createdAt: string
  expiresAt: string
  committedAt: string | null
  releasedAt: string | null
}

export interface AiImageResult {
  resultId: string
  mediaType: 'image/webp'
  width: number
  height: number
  byteSize: number
  observedAt: string
  createdAt: string
  expiresAt: string
}

export interface AiImageResultAccess {
  reference: string
  expiresAt: string
}

export interface AiImageGuidance {
  code: 'pending' | 'processing' | 'retrying' | 'dlq' | 'completed' | 'failed' | 'contact_support' | 'result_expired'
  poll: boolean
}

export interface AiImageJob {
  jobId: string
  clientId: string
  requestType: 'image_generation'
  targetRole: AiImageTargetRole
  status: AiImageJobStatus
  attemptCount: number
  createdAt: string
  updatedAt: string
  processingStartedAt: string | null
  lastAttemptCompletedAt: string | null
  completedAt: string | null
  quote: AiImageQuote
  reservation: AiImageReservation
  result: AiImageResult | null
  resultAccess: AiImageResultAccess | null
  guidance: AiImageGuidance
}

export type AiImageProblemKind =
  | 'authentication_required' | 'forbidden' | 'not_found' | 'result_expired'
  | 'validation' | 'insufficient_credits' | 'idempotency_conflict'
  | 'quote_expired' | 'quote_stale' | 'quote_not_available'
  | 'rate_limited' | 'admission_unknown' | 'dependency_unavailable'
  | 'configuration_unavailable' | 'transition_pending' | 'network' | 'unknown'

export interface AiImageProblem {
  kind: AiImageProblemKind
  message: string
  retryAfterSeconds: number | null
}

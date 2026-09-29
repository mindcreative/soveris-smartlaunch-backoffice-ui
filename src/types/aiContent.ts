export const AI_CONTENT_OPERATIONS = [
  'generate_content', 'generate_seo', 'generate_headline',
  'generate_image_prompt', 'rewrite_content',
] as const

export type AiContentOperation = typeof AI_CONTENT_OPERATIONS[number]

export const AI_CONTENT_TYPES = [
  'hero', 'features', 'faq', 'cta', 'description', 'meta_title',
  'meta_description', 'headline', 'image_prompt',
] as const

export type AiContentType = typeof AI_CONTENT_TYPES[number]
export type AiContentTone =
  | 'professional' | 'casual' | 'persuasive' | 'informative'
  | 'friendly' | 'technical'

export interface AiContentGenerationRequest {
  idempotencyKey: string
  operation: AiContentOperation
  contentType: AiContentType
  productSlug: string | null
  productName: string | null
  existingContent: string | null
  targetAudience: string | null
  tone: AiContentTone | null
  variations: number
  instructions: string | null
  content: string | null
}

interface AiAdmissionBase {
  jobId: string
  reservationId: string
  attemptId: string
  correlationId: string
  replay: boolean
}

export interface AiCompletedAdmission extends AiAdmissionBase {
  kind: 'completed'
  status: 'completed'
  variations: string[]
  providerName: string
  modelName: string
  usage: { inputTokens: number; outputTokens: number }
  committedCredits: string
}

export interface AiAcceptedAdmission extends AiAdmissionBase {
  kind: 'accepted'
  status: 'reserved' | 'processing' | 'failed' | 'execution_unknown'
  quotedCredits: string
}

export type AiContentAdmission = AiCompletedAdmission | AiAcceptedAdmission

export interface AiJobAttempt {
  attemptId: string
  attemptNumber: number
  outcomeStatus: 'processing' | 'succeeded' | 'failed' | 'execution_unknown'
  executionPhase: 'pre_dispatch' | 'dispatched' | 'resolved'
  providerName: string | null
  failureCategory: 'timeout' | 'provider_error' | 'validation_error' | 'internal_error' | 'cancelled' | null
  retryDisposition: 'retryable' | 'non_retryable' | 'unknown' | null
  startedAt: string
  completedAt: string | null
}

export interface AiJobReservation {
  reservationId: string
  state: 'active' | 'committed' | 'released' | 'expired'
  estimatedCredits: string
  actualCredits: string | null
  createdAt: string
  expiresAt: string
  committedAt: string | null
  releasedAt: string | null
}

export interface AiJobResult {
  resultId: string
  variations: string[]
  providerName: string
  modelName: string
  observedAt: string
  createdAt: string
}

export interface AiJobUsage {
  usageId: string
  attemptId: string
  inputTokens: number | null
  outputTokens: number | null
  imagesGenerated: 0
  costInCredits: string
  observedAt: string
  createdAt: string
}

export interface AiJobProviderCost {
  costId: string
  attemptId: string
  costStatus: 'unresolved' | 'estimated' | 'reconciled'
  estimatedPrice: string | null
  estimatedCostSource: string | null
  actualPrice: string | null
  actualCostSource: string | null
  currencyCode: string | null
  capturedAt: string
  reconciledAt: string | null
}

export type AiJobStatus = 'reserved' | 'pending' | 'processing' | 'completed' | 'failed' | 'execution_unknown' | 'cancelled'
export type AiJobGuidance =
  | { code: 'pending'; poll: true; action: 'wait' }
  | { code: 'complete'; poll: false; action: 'view_result' }
  | { code: 'failed' | 'outcome_unknown' | 'cancelled'; poll: false; action: 'contact_support' }

export interface AiJobStatusDto {
  jobId: string
  clientId: string
  requestType: 'content_generation'
  status: AiJobStatus
  correlationId: string
  submittedByUserId: string | null
  createdAt: string
  updatedAt: string
  processingStartedAt: string | null
  completedAt: string | null
  result: AiJobResult | null
  attempt: AiJobAttempt
  reservation: AiJobReservation
  usage: AiJobUsage | null
  providerCost: AiJobProviderCost | null
  guidance: AiJobGuidance
}

export type AiGenerationTarget =
  | 'hero' | 'features' | 'faq' | 'cta' | 'description' | 'headline'
  | 'meta_title' | 'meta_description' | 'rewrite' | 'image_prompt'

export interface AiGenerationMaterial {
  target: AiGenerationTarget
  currentValue: string
  targetPointer: string | null
  targetValue: string
  draftRevision: number
  productSlug: string
  productName: string
  targetAudience: string
  tone: AiContentTone | null
  variations: number
  instructions: string
}

export interface AiRetainedAttempt {
  actorId: string
  clientId: string
  productId: string
  idempotencyKey: string
  request: AiContentGenerationRequest
  serializedBody: string
  material: AiGenerationMaterial
  startedAt: number
}

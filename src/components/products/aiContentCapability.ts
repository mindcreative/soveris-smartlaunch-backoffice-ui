import type {
  ClientCapabilities,
  ClientCapabilityDenialCondition,
  ClientClassification,
} from '../../types/billing'

export interface AiContentCapabilityPresentation {
  eligible: boolean
  reason: ClientCapabilityDenialCondition | 'missing_permission' | 'malformed_capability' | 'available_requires_quote'
  message: string
}

function fundingMessage(classification: ClientClassification): string {
  return classification === 'soveris_internal'
    ? 'AI funding is not configured or available for this internal Client; contact a Billing administrator.'
    : 'AI credits are not available for this Client. Add funding or contact a Billing administrator.'
}

export function presentAiContentCapability(
  capabilities: ClientCapabilities | null | undefined,
  hasCreate: boolean,
  hasView: boolean
): AiContentCapabilityPresentation {
  if (!hasCreate || !hasView) return {
    eligible: false,
    reason: 'missing_permission',
    message: 'AI generation requires both ai:create and ai:view permission.',
  }
  const operation = capabilities?.operations.filter(({ key }) => key === 'ai_content_generation') ?? []
  if (!capabilities || operation.length !== 1) return {
    eligible: false,
    reason: 'malformed_capability',
    message: 'AI generation eligibility could not be verified. Refresh or contact an administrator.',
  }
  const evidence = operation[0]!
  if (evidence.outcome === 'eligible' && evidence.funding === 'available_requires_quote' && evidence.denialConditions.length === 0) return {
    eligible: true,
    reason: 'available_requires_quote',
    message: 'Final credits and current availability are checked when you submit.',
  }
  const reason = evidence.denialConditions[0]
  if (!reason) return { eligible: false, reason: 'malformed_capability', message: 'AI generation eligibility is inconsistent. Refresh or contact an administrator.' }
  const nextBoundary = capabilities.nextBoundary ? ` Try again after ${capabilities.nextBoundary}.` : ''
  const message: Record<ClientCapabilityDenialCondition, string> = {
    permission_denied: 'AI generation permission is not available for this Client.',
    client_inactive: 'AI generation is unavailable because this Client is inactive.',
    feature_not_available: capabilities.classification === 'soveris_internal'
      ? 'Internal AI policy is not enabled or configured for this Client.'
      : 'AI generation is unavailable under the current Client policy.',
    entitlement_not_available: capabilities.classification === 'soveris_internal'
      ? 'Internal capability evidence is invalid. Contact an administrator.'
      : 'AI generation is not included in the current plan or entitlement.',
    limit_reached: `The current AI request or concurrency limit has been reached.${nextBoundary}`,
    provider_unavailable: 'The AI provider is temporarily unavailable. Try again later.',
    pricing_unavailable: 'AI pricing is unavailable. Contact an administrator or try again later.',
    wallet_missing: fundingMessage(capabilities.classification),
    wallet_ineligible: fundingMessage(capabilities.classification),
    insufficient_credits: fundingMessage(capabilities.classification),
    configuration_unavailable: 'AI generation configuration is unavailable. Contact an administrator.',
    dependency_unavailable: 'A required AI service is temporarily unavailable. Try again later.',
    transition_pending: 'A Client policy transition is still pending. Try again when it completes.',
    stale_capability_evidence: 'AI eligibility evidence is stale. Refresh before generating.',
  }
  return { eligible: false, reason, message: message[reason] }
}

export function admissionFundingMessage(classification: ClientClassification): string {
  return fundingMessage(classification)
}

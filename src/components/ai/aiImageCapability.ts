import type { ClientCapabilities, ClientCapabilityDenialCondition } from '../../types/billing'

export interface AiImageCapabilityPresentation {
  capabilityEligible: boolean
  reason: ClientCapabilityDenialCondition | 'missing_permission' | 'malformed_capability' | 'eligible'
  message: string
}

export function presentAiImageCapability(
  capabilities: ClientCapabilities | null | undefined,
  hasCreate: boolean,
): AiImageCapabilityPresentation {
  if (!hasCreate) return {
    capabilityEligible: false,
    reason: 'missing_permission',
    message: 'Image submission requires current ai:create permission.',
  }
  const operations = capabilities?.operations?.filter(({ key }) => key === 'ai_image_generation') ?? []
  const flag = capabilities?.flags?.filter(({ key }) => key === 'ai_image_generation') ?? []
  if (!capabilities || operations.length !== 1 || flag.length !== 1) return {
    capabilityEligible: false,
    reason: 'malformed_capability',
    message: 'Image generation eligibility could not be verified. Refresh or contact an administrator.',
  }
  const operation = operations[0]!
  if (!flag[0]!.enabled || operation.outcome !== 'eligible') {
    const reason = operation.denialConditions[0] ?? 'configuration_unavailable'
    const nextBoundary = capabilities.nextBoundary ? ` Try again after ${capabilities.nextBoundary}.` : ''
    const messages: Record<ClientCapabilityDenialCondition, string> = {
      permission_denied: 'Image generation permission is unavailable for this Client.',
      client_inactive: 'Image generation is unavailable because this Client is inactive.',
      feature_not_available: 'Image generation is not enabled by the current Client policy.',
      entitlement_not_available: 'Image generation is not included in the current entitlement.',
      limit_reached: `The current image generation limit has been reached.${nextBoundary}`,
      provider_unavailable: 'Image generation processing is temporarily unavailable.',
      pricing_unavailable: 'Image credit pricing is unavailable. Contact an administrator.',
      wallet_missing: 'Image generation funding is not configured for this Client.',
      wallet_ineligible: 'This Client is not eligible to reserve image generation credits.',
      insufficient_credits: 'The selected Client lacks available abstract credits.',
      configuration_unavailable: 'Image generation configuration is unavailable for this Client.',
      dependency_unavailable: 'Image generation eligibility cannot be checked right now.',
      transition_pending: 'A Client policy transition is still pending.',
      stale_capability_evidence: 'Image generation eligibility is stale. Refresh before continuing.',
    }
    return { capabilityEligible: false, reason, message: messages[reason] }
  }
  return {
    capabilityEligible: true,
    reason: 'eligible',
    message: 'Image generation is currently eligible. A fresh server quote is required before each submission.',
  }
}

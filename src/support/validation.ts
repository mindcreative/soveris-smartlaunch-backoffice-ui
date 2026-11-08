import { canonicalizeGuid } from '../lib/guid'
import { createUuidV7 } from '../lib/uuidV7'
import { SUPPORT, SUPPORT_CASE, SUPPORT_OPERATIONS } from './constants'
import { SupportAccessError } from './errors'
import type { SupportRead, SupportRequest } from './models'
import { supportId } from './parsing'

export function buildSupportRequest(target: string, products: string, operations: SupportRead[], minutes: string, reason: string, reference: string): SupportRequest {
  const targetId = canonicalizeGuid(target.trim())
  const productIds = products.trim().split(/[\s,]+/).map(value => canonicalizeGuid(value))
  const duration = Number(minutes)
  const trimmedReason = reason.trim()

  if (!targetId || productIds.length < 1 || productIds.length > SUPPORT.maximumProducts || productIds.some(value => !value) ||
    new Set(productIds).size !== productIds.length || operations.length < 1 || operations.some(value => !SUPPORT_OPERATIONS.includes(value)) ||
    new Set(operations).size !== operations.length || !Number.isInteger(duration) || duration < 1 || duration > SUPPORT.maximumMinutes ||
    !trimmedReason || Array.from(trimmedReason).length > SUPPORT.maximumReasonScalars || /\p{Cc}|[\uD800-\uDFFF]/u.test(trimmedReason) ||
    !SUPPORT_CASE.test(reference)) {
    throw new SupportAccessError(400)
  }

  return { operationId: createUuidV7(), targetClientId: supportId(targetId), productIds: productIds.map(value => supportId(value)).sort(),
    operations: [...operations].sort(), durationMinutes: duration, reason: trimmedReason, supportCaseReference: reference }
}

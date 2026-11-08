import { SUPPORT } from './constants'
import type { SupportNotice } from './models'

export class SupportScopeChangedError extends Error {
  readonly code = 'SUPPORT_SCOPE_CHANGED'
  constructor() {
    super('Support context changed. Verify current access before continuing.')
    this.name = 'SupportScopeChangedError'
  }
}

export class SupportAccessError extends Error {
  readonly code = 'SUPPORT_ACCESS_WITHHELD'
  readonly notice: SupportNotice
  constructor(readonly status: number, retrySeconds = 0, readonly safeCode?: string, readonly field?: 'customer' | 'products', readonly rejectedOperationId?: string) {
    const message = status === 409 && safeCode === 'selection_ambiguous' && field ? `${field === 'customer' ? 'Customer' : 'Product'} identity is ambiguous. Ask the case owner to resolve it; no request or approval was created.`
      : status === 409 && safeCode === 'request_changed' ? 'The request or review changed. This command was rejected before effect. Reload and review the current request before confirming again.'
      : status === 401 ? 'Your original session is no longer current. Sign in again.'
      : status === 403 ? 'This action is not currently permitted. Check current access and request status.'
      : status === 404 ? 'This support request or selected product is unavailable.'
      : status === 409 ? 'The request changed or the command was already consumed. Reload its current state.'
      : status === 429 && rejectedOperationId ? 'This exact command was rejected before effect. Wait, then deliberately submit a new command when ready.'
      : status === 429 ? 'Support request limit reached. Wait before trying again.'
      : status === 400 || status === 413 ? 'Check the request fields and size before trying again.'
      : 'Support access is unavailable. The outcome is not confirmed. Reload current state before another action.'
    super(message)
    this.name = 'SupportAccessError'
    this.notice = { status, message, code: safeCode, field, retryAt: Date.now() + Math.min(SUPPORT.maximumRetrySeconds, Math.max(0, retrySeconds)) * 1000 }
  }
}

export function supportFailure(error: unknown): SupportAccessError {
  if (error instanceof SupportAccessError) {
    return error
  }

  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    && [400, 401, 403, 404, 409, 413, 429, 503].includes(error.status) ? error.status : 503
  return new SupportAccessError(status, status === 503 ? 5 : status === 429 ? 60 : 0)
}

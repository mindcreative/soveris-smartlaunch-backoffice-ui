import { normalizeAccountError } from './accountLifecycleError'
import { ACCOUNT_LIMITS, ACCOUNT_PROOF_PATTERN } from './constants/accountLifecycle'
import { ACCOUNT_ADMISSION } from './constants/turnstile'
import type { PendingAccountResponse, RegisterAccountRequest } from './models/accountLifecycle'
import type { AccountAdmissionContext } from './models/turnstile'

function invalid(): never {
  throw normalizeAccountError({ code: 'account_flow_uncertain' })
}

async function post(path: string, body: unknown, signal?: AbortSignal, csrf?: string): Promise<Record<string, unknown>> {
  const encoded = JSON.stringify(body)

  if (new TextEncoder().encode(encoded).byteLength > ACCOUNT_ADMISSION.maximumBytes) {
    return invalid()
  }

  const deadline = AbortSignal.timeout(ACCOUNT_ADMISSION.deadlineMilliseconds)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  try {
    const response = await fetch(path, {
      method: 'POST', body: encoded, signal: combined, credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer', headers: {
        'Content-Type': 'application/json', ...(csrf ? { [ACCOUNT_ADMISSION.csrfHeader]: csrf } : {}),
      },
    })
    const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()

    if (contentType !== 'application/json') {
      return invalid()
    }

    const reader = response.body?.getReader()

    if (!reader) {
      return invalid()
    }

    const decoder = new TextDecoder('utf-8', { fatal: true })
    let text = ''
    let size = 0

    try {
      while (true) {
        const block = await reader.read()

        if (block.done) {
          break
        }

        size += block.value.byteLength

        if (size > ACCOUNT_ADMISSION.maximumBytes) {
          await reader.cancel()

          return invalid()
        }

        text += decoder.decode(block.value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }

    text += decoder.decode()
    const result: unknown = JSON.parse(text)

    if (!response.ok) {
      throw normalizeAccountError(result, response.status, response.headers.get('Retry-After'))
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return invalid()
    }

    return result as Record<string, unknown>
  } catch (error) {
    const safe = error && typeof error === 'object' && 'code' in error ? error : null

    throw normalizeAccountError(safe, safe && 'status' in safe && typeof safe.status === 'number' ? safe.status : undefined,
      safe && 'retryAfterSeconds' in safe ? safe.retryAfterSeconds : undefined)
  }
}

function exactFields(result: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(result).length === fields.length && fields.every(field => Object.prototype.hasOwnProperty.call(result, field))
}

function safeChallengeOrigin(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const child = new URL(value)
    const account = new URL(window.location.origin)
    const explicitLoopback = account.hostname === '127.0.0.1' && child.hostname === 'localhost' &&
      account.protocol === 'http:' && child.protocol === 'http:' && child.port === '5190'
    const https = account.protocol === 'https:' && child.protocol === 'https:'

    return value === child.origin && !child.username && !child.password && child.hostname !== account.hostname && (https || explicitLoopback)
  } catch {
    return false
  }
}

export const accountAdmissionApi = {
  async context(signal?: AbortSignal): Promise<AccountAdmissionContext> {
    const result = await post(ACCOUNT_ADMISSION.contextPath, { purpose: 'signup' }, signal)
    const validSecrets = ['contextId', 'nonce', 'csrf'].every(field => typeof result[field] === 'string' && ACCOUNT_PROOF_PATTERN.test(result[field]))
    const validExpiry = typeof result.expiresIn === 'number' && Number.isSafeInteger(result.expiresIn) &&
      result.expiresIn > 0 && result.expiresIn <= ACCOUNT_ADMISSION.maximumSeconds
    const validSiteKey = typeof result.siteKey === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(result.siteKey)

    if (!exactFields(result, ['contextId', 'nonce', 'csrf', 'expiresIn', 'challengeOrigin', 'siteKey']) ||
      !validSecrets || !validExpiry || !validSiteKey || !safeChallengeOrigin(result.challengeOrigin)) {
      return invalid()
    }

    return result as unknown as AccountAdmissionContext
  },
  async register(request: RegisterAccountRequest, signal?: AbortSignal, csrf?: string): Promise<PendingAccountResponse> {
    const result = await post(ACCOUNT_ADMISSION.registerPath, request, signal, csrf)

    if (!exactFields(result, ['status', 'pendingToken', 'expiresIn']) || result.status !== 'check_email' ||
      typeof result.pendingToken !== 'string' || !ACCOUNT_PROOF_PATTERN.test(result.pendingToken) ||
      typeof result.expiresIn !== 'number' || !Number.isSafeInteger(result.expiresIn) || result.expiresIn <= 0 || result.expiresIn > ACCOUNT_LIMITS.pendingSeconds) {
      return invalid()
    }

    return { status: 'check_email', pendingToken: result.pendingToken, expiresIn: result.expiresIn }
  },
}

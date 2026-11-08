import { parseMfaChallenge } from '../account/mfaParsing'
import { SUPPORT, SUPPORT_ERROR_CODES, SUPPORT_ERROR_FIELDS, SUPPORT_RATE_REJECTED, SUPPORT_RATE_ERROR_FIELDS } from './constants'
import { supportRequestHash } from './commandIdentity'
import { observeSupportClock } from './clock'
import { SupportAccessError, SupportScopeChangedError } from './errors'
import type { SupportCommand, SupportMetadata, SupportRequest, SupportTransportBoundary } from './models'
import { parseSupportReceipt, parseSupportCustomer, parseSupportProduct, parseSupportLookup, parseSupportContext, parseSupportDraft, parseSupportIdentity, parseSupportJson, parseSupportMetadata, parseSupportOutcome, parseSupportPage, supportId } from './parsing'

async function boundedText(response: Response): Promise<string> {
  const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()

  if (type !== 'application/json') {
    await response.body?.cancel()
    throw new SupportAccessError(503, 5)
  }

  const reader = response.body?.getReader()

  if (!reader) {
    throw new SupportAccessError(503, 5)
  }

  let bytes = 0
  let text = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })

  try {
    while (true) {
      const block = await reader.read()

      if (block.done) {
        break
      }

      bytes += block.value.byteLength

      if (bytes > SUPPORT.maximumResponseBytes) {
        await reader.cancel()
        throw new SupportAccessError(503, 5)
      }

      text += decoder.decode(block.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

/** Closed support transport. A mutation is sent once; no refresh or replay path exists. */
export function createSupportApi(boundary: SupportTransportBoundary) {
  async function request<T>(path: string, body: unknown | undefined, decode: (raw: string, response: Response, started: number) => T, signal?: AbortSignal, observe?: (value: T, response: Response) => T): Promise<T> {
    const original = boundary.capture()
    const started = performance.now()
    const deadline = AbortSignal.timeout(SUPPORT.deadlineMilliseconds)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

    try {
      const encoded = body === undefined ? undefined : JSON.stringify(body)

      if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > SUPPORT.maximumBodyBytes) {
        throw new SupportAccessError(413)
      }

      if (signal?.aborted || !original.isCurrent()) {
        throw new SupportScopeChangedError()
      }

      const response = await fetch(SUPPORT.api + path, { method: body === undefined ? 'GET' : 'POST', body: encoded, signal: combined,
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { Authorization: 'Bearer ' + original.accessToken, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) } })

      if (signal?.aborted || !original.isCurrent()) {
        await response.body?.cancel()
        throw new SupportScopeChangedError()
      }

      if (response.status !== 200) {
        let rejectedOperationId: string | undefined
        let safeCode: string | undefined
        let field: 'customer' | 'products' | undefined

        if (response.status === 409) {
          try {
            const value = JSON.parse(await boundedText(response)) as Record<string, unknown>
            const keys = Object.keys(value)
            const valid = keys.length === (value.code === 'selection_ambiguous' ? 4 : 3)
              && keys.every(key => SUPPORT_ERROR_FIELDS.includes(key as typeof SUPPORT_ERROR_FIELDS[number])) && value.status === 409
              && typeof value.correlationId === 'string' && supportId(value.correlationId, true) === value.correlationId

            if (valid && SUPPORT_ERROR_CODES.includes(value.code as typeof SUPPORT_ERROR_CODES[number])) {
              safeCode = value.code as string
              field = value.field === 'customer' || value.field === 'products' ? value.field : undefined

              if (safeCode === 'selection_ambiguous' && !field) {
                safeCode = undefined
              }
            }
          } catch {
            // An untrusted error body cannot add diagnostics or identifiers to the UI.
          }
        } else if (response.status === 429 && encoded !== undefined) {
          try {
            const value = JSON.parse(await boundedText(response)) as Record<string, unknown>
            const sent = JSON.parse(encoded) as Record<string, unknown>
            const valid = Object.keys(value).length === SUPPORT_RATE_ERROR_FIELDS.length
              && SUPPORT_RATE_ERROR_FIELDS.every(key => Object.prototype.hasOwnProperty.call(value, key))
              && value.status === 429 && value.code === SUPPORT_RATE_REJECTED
              && supportId(value.correlationId, true) === value.correlationId
              && supportId(value.operationId, true) === sent.operationId
              && value.requestHash === await supportRequestHash(path, encoded)

            if (valid) {
              safeCode = SUPPORT_RATE_REJECTED
              rejectedOperationId = value.operationId as string
            }
          } catch {
            // Generic or mismatched429 cannot establish that this command had no effect.
          }
        } else {
          await response.body?.cancel()
        }

        const rawRetry = response.headers.get('Retry-After') ?? ''
        const retry = /^\d{1,4}$/.test(rawRetry) ? Math.min(Number(rawRetry), SUPPORT.maximumRetrySeconds) : response.status === 503 ? 5 : response.status === 429 ? 60 : 0
        throw new SupportAccessError([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 503, retry, safeCode, field, rejectedOperationId)
      }

      const raw = await boundedText(response)
      const result = decode(raw, response, started)

      if (signal?.aborted || !original.isCurrent()) {
        throw new SupportScopeChangedError()
      }

      return observe ? observe(result, response) : result
    } catch (error) {
      if (signal?.aborted || error instanceof SupportScopeChangedError || !original.isCurrent()) {
        throw new SupportScopeChangedError()
      }

      const safe = error instanceof SupportAccessError ? error : new SupportAccessError(503, 5)
      boundary.retire(safe.notice)
      throw safe
    }
  }

  function observeMetadata(value: SupportMetadata, response: Response): SupportMetadata {
    const serverMilliseconds = Date.parse(response.headers.get('Date') ?? '')
    return { ...value, clock: Number.isFinite(serverMilliseconds) ? { serverMilliseconds, monotonicMilliseconds: performance.now() } : undefined }
  }

  const route = (grant: string, owner = false) => (owner ? '/approvals/' : '/requests/') + supportId(grant, true)
  const json = <T>(decode: (value: unknown) => T) => (raw: string) => decode(parseSupportJson(raw))
  function lookupQuery(cursor?: string): string {
    const parameters = new URLSearchParams({ limit: String(SUPPORT.lookupPageSize) })

    if (cursor) {
      parameters.set('cursor', cursor)
    }

    return '?' + parameters.toString()
  }

  return {
    receipt: (operation: string, signal?: AbortSignal) => request('/operations/' + supportId(operation, true), undefined, json(value => {
      const receipt = parseSupportReceipt(value)

      if (receipt.operationId !== operation) {
        throw new SupportAccessError(503)
      }

      return receipt
    }), signal),
    customers: (cursor?: string, signal?: AbortSignal) => request('/lookups/customers' + lookupQuery(cursor), undefined,
      json(value => parseSupportLookup(value, parseSupportCustomer)), signal),
    products: (customer: string, cursor?: string, signal?: AbortSignal) => request('/lookups/customers/' + supportId(customer) + '/products' + lookupQuery(cursor), undefined,
      json(value => parseSupportLookup(value, parseSupportProduct)), signal),
    list: (owner: boolean, before?: string, signal?: AbortSignal) => request((owner ? '/approvals' : '/requests') +
      (before ? '?before=' + supportId(before, true) : ''), undefined, json(parseSupportPage), signal),
    detail: (grant: string, owner: boolean, signal?: AbortSignal) => request(route(grant, owner), undefined, json(parseSupportMetadata), signal, observeMetadata),
    create: (input: SupportRequest, signal?: AbortSignal) => request('/requests', input, json(parseSupportOutcome), signal),
    approve: (grant: string, command: SupportCommand, signal?: AbortSignal) => request(route(grant, true) + '/approve', command, json(parseSupportOutcome), signal),
    revoke: (grant: string, command: SupportCommand, signal?: AbortSignal) => request(route(grant, true) + '/revoke', command, json(parseSupportOutcome), signal),
    challenge: (grant: string, signal?: AbortSignal) => {
      const started = Date.now()
      return request(route(grant) + '/challenge', {}, raw => parseMfaChallenge(JSON.parse(raw), ['support_activation'], started), signal)
    },
    activate: (grant: string, command: SupportCommand, signal?: AbortSignal) => request(route(grant) + '/activate', command, json(parseSupportOutcome), signal),
    exit: (grant: string, command: SupportCommand, signal?: AbortSignal) => request(route(grant) + '/exit', command, json(parseSupportOutcome), signal),
    context: (grant: string, signal?: AbortSignal) => request(route(grant) + '/context', undefined,
      (raw, response, started) => parseSupportContext(parseSupportJson(raw), observeSupportClock(response, started)), signal),
    identity: (grant: string, product: string, signal?: AbortSignal) => request(route(grant) + '/products/' + supportId(product), undefined, parseSupportIdentity, signal),
    draft: (grant: string, product: string, signal?: AbortSignal) => request(route(grant) + '/products/' + supportId(product) + '/draft', undefined, parseSupportDraft, signal),
  }
}

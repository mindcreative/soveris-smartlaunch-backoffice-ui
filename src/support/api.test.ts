import { supportRequestHash } from './commandIdentity'
import { afterEach, expect, it, vi } from 'vitest'
import { createSupportApi } from './api'
import type { SupportNotice } from './models'

const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
const reply = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } })
afterEach(() => vi.unstubAllGlobals())

it('uses bounded same-origin bearer transport without refresh/replay or private browser caching', async () => {
  const fetch = vi.fn().mockResolvedValue(reply('{"productId":"' + product + '","draftSchemaVersion":1,"draftRevision":1,"draft":null}'))
  vi.stubGlobal('fetch', fetch)
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire: vi.fn() })
  expect((await api.draft(grant, product)).draftJson).toBe('null')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/backoffice/support/requests/' + grant + '/products/' + product + '/draft')
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { Authorization: 'Bearer owned-token' } })
})

it.each([401, 403, 404, 503])('retires current support scope once on %s and never returns private server error text', async status => {
  const fetch = vi.fn().mockResolvedValue(reply('{"detail":"secret-error-canary"}', status, { 'Retry-After': '99999999' }))
  vi.stubGlobal('fetch', fetch)
  const notices: SupportNotice[] = []
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire: value => notices.push(value) })
  const error = await api.draft(grant, product).catch(error => error)
  expect(error.status).toBe(status)
  expect(JSON.stringify(error)).not.toContain('secret-error-canary')
  expect(notices).toHaveLength(1)
  expect(notices[0]!.retryAt).toBeLessThanOrEqual(Date.now() + 600000)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('discards a late response without retiring the replacement grant', async () => {
  let current = true
  const retire = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    current = false
    return reply('{"productId":"' + product + '","draftSchemaVersion":1,"draftRevision":1,"draft":{"private":"late"}}')
  }))
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => current }), retire })
  await expect(api.draft(grant, product)).rejects.toMatchObject({ code: 'SUPPORT_SCOPE_CHANGED' })
  expect(retire).not.toHaveBeenCalled()
})

it('rejects oversized streamed output before parsing and fails closed on unknown projection fields', async () => {
  for (const body of [' '.repeat(1048577), '{"productId":"' + product + '","draftSchemaVersion":1,"draftRevision":1,"draft":null,"live":"private"}']) {
    const retire = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)))
    const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire })
    await expect(api.draft(grant, product)).rejects.toMatchObject({ status: 503 })
    expect(retire).toHaveBeenCalledTimes(1)
  }
})

it('accepts only the dedicated server-issued activation challenge and preserves generic MFA purpose separation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify({ challenge: { id: grant, secret: 'A'.repeat(43), purpose: 'support_activation',
    expiresAt: new Date(Date.now() + 299000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'B'.repeat(42) + 'A' }))))
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire: vi.fn() })
  expect((await api.challenge(grant)).challenge.purpose).toBe('support_activation')
})

it('AV3 replacing a pending lookup cancels only that request and leaves the next lookup usable', async () => {
  const retire = vi.fn()
  const controller = new AbortController()
  const fetch = vi.fn().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })).mockResolvedValueOnce(reply('{"items":[],"nextCursor":null}'))
  vi.stubGlobal('fetch', fetch)
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire })
  const old = api.customers(undefined, controller.signal)
  controller.abort()
  await expect(old).rejects.toMatchObject({ code: 'SUPPORT_SCOPE_CHANGED' })
  await expect(api.customers()).resolves.toEqual({ items: [], nextCursor: null })
  expect(retire).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('AV3 a request deadline still retires support when the caller did not cancel', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Deadline', 'TimeoutError')))
  const retire = vi.fn()
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire })
  await expect(api.customers()).rejects.toMatchObject({ status: 503 })
  expect(retire).toHaveBeenCalledTimes(1)
})

it.each([-600000, 600000])('V5 parses context against authenticated server time despite browser skew %s', async offset => {
  const server = Date.parse('2026-11-06T12:00:00Z')
  const context = { id: grant, operatorId: product, operatorName: 'Operator', targetClientId: grant, targetClientName: 'Customer',
    products: [{ id: product, name: 'Product', slug: 'product' }], originalWorkspaceName: 'Workspace', supportCaseReference: 'case:clock',
    createdAt: '2026-11-06T11:00:00Z', productIds: [product], operations: ['product.draft.read'], scopeVersion: 'support-read-v1',
    scopeHash: 'a'.repeat(64), revision: '3', state: 'active', startsAt: '2026-11-06T12:00:00Z', expiresAt: '2026-11-06T12:01:00Z' }
  const wall = vi.spyOn(Date, 'now').mockReturnValue(server + offset)
  const retire = vi.fn()
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire })

  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify(context), 200, { Date: new Date(server).toUTCString() })))
    const accepted = await api.context(grant)
    expect(accepted.clock.serverMilliseconds).toBeGreaterThanOrEqual(server + 1000)
    expect(accepted.clock.serverMilliseconds).toBeLessThan(server + 60000)
    expect(retire).not.toHaveBeenCalled()

    // Neither missing clock evidence nor an expired server context may install authority.
    const unavailableClocks: Record<string, string>[] = [{}, { Date: new Date(server + 60000).toUTCString() }]

    for (const headers of unavailableClocks) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify(context), 200, headers)))
      await expect(api.context(grant)).rejects.toMatchObject({ status: 503 })
    }

    expect(retire).toHaveBeenCalledTimes(2)
  } finally {
    wall.mockRestore()
  }
})

it('UX12 UX29 trusts only finite conflict envelopes before allowing a refreshed review', async () => {
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned-token', isCurrent: () => true }), retire: vi.fn() })
  const command = { operationId: product, expectedRevision: '1', scopeHash: 'a'.repeat(64), labelReviewHash: 'b'.repeat(64) }
  const envelopes = [
    { status: 409, correlationId: grant, code: 'request_changed' },
    { status: 409, correlationId: grant, code: 'command_conflict' },
    { status: 409, correlationId: grant, code: 'selection_ambiguous', field: 'customer' },
  ]

  for (const envelope of envelopes) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify(envelope), 409)))
    await expect(api.approve(grant, command)).rejects.toMatchObject({ status: 409, safeCode: envelope.code })
  }

  const malformed = [
    { ...envelopes[0], detail: 'private-error-canary' },
    { ...envelopes[0], status: 200 },
    { ...envelopes[0], correlationId: 'private-error-canary' },
    { ...envelopes[0], code: 'private-error-canary' },
    { ...envelopes[2], field: 'private-error-canary' },
  ]

  for (const envelope of malformed) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify(envelope), 409)))
    const failure = await api.approve(grant, command).catch(error => error)
    expect(failure.status).toBe(409)
    expect(failure.safeCode).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain('private-error-canary')
  }
})


it.each(['exact', 'different body', 'different operation', 'different route', 'extra field', 'generic'])('R1 verifies terminal429 identity: %s', async variant => {
  vi.stubGlobal('crypto', (await vi.importActual<{ webcrypto: Crypto }>('node:crypto')).webcrypto)
  const command = { operationId: product, expectedRevision: '2' }
  const requestHash = await supportRequestHash('/requests/' + grant + (variant === 'different route' ? '/activate' : '/exit'),
    JSON.stringify(variant === 'different body' ? { ...command, expectedRevision: '3' } : command))
  const envelope = variant === 'generic' ? { status: 429, correlationId: grant } : {
    status: 429, code: 'rate_limited_before_effect', correlationId: grant,
    operationId: variant === 'different operation' ? grant : product, requestHash,
    ...(variant === 'extra field' ? { detail: 'untrusted' } : {}),
  }
  const fetch = vi.fn().mockResolvedValue(reply(JSON.stringify(envelope), 429, { 'Retry-After': '30' }))
  vi.stubGlobal('fetch', fetch)
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned', isCurrent: () => true }), retire: vi.fn() })
  const error = await api.exit(grant, command).catch(error => error)
  expect(error.status).toBe(429)
  expect(error.rejectedOperationId).toBe(variant === 'exact' ? product : undefined)
  expect(error.safeCode).toBe(variant === 'exact' ? 'rate_limited_before_effect' : undefined)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['exact', 'string status', 'unbounded cooldown', 'extra field', 'wrong operation'])('R1 receipt transport accepts only a closed exact rejection: %s', async variant => {
  const outcome = {
    status: variant === 'string status' ? '429' : 429,
    code: 'rate_limited_before_effect', requestHash: 'a'.repeat(64),
    retryAfter: variant === 'unbounded cooldown' ? 601 : 30,
    ...(variant === 'extra field' ? { detail: 'untrusted' } : {}),
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(JSON.stringify({
    operationId: variant === 'wrong operation' ? product : grant, command: 'request', outcome,
  }))))
  const api = createSupportApi({ capture: () => ({ accessToken: 'owned', isCurrent: () => true }), retire: vi.fn() })

  if (variant === 'exact') {
    await expect(api.receipt(grant)).resolves.toMatchObject({ operationId: grant, outcome: { status: 429, retryAfter: 30 } })
  } else {
    await expect(api.receipt(grant)).rejects.toMatchObject({ status: 503 })
  }
})

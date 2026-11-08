import { expect, it } from 'vitest'
import { parseSupportContext as parseContext, parseSupportDraft, parseSupportMetadata } from './parsing'
import { createSupportAuthority } from './authority'
import { supportText } from './labels'
import { experienceRoute } from '../auth/experience'
import type { AuthUser } from '../types/auth'

const parseSupportContext = (input: unknown) => parseContext(input, { serverMilliseconds: Date.now(), monotonicMilliseconds: performance.now() })

const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
const other = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d6'
const actor = { id: other, clientId: '0149620b-af5c-47c9-8290-95edde45ef8f', sessionId: grant, securityRevision: '9007199254740993',
  role: 'ClientOwner', platformPermissions: ['platform:support:operate'], permissions: [] } as unknown as AuthUser
const context = () => ({ id: grant, operatorId: actor.id, operatorName: 'Real operator', targetClientId: product, targetClientName: 'Customer A',
  products: [{ id: product, name: 'Selected product', slug: 'selected' }], originalWorkspaceName: 'Operator workspace', supportCaseReference: 'case:123', createdAt: new Date().toISOString(), productIds: [product], operations: ['product.draft.read', 'product.identity.read'], scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64),
  revision: '3', state: 'active', startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() })

it('guards each support audience before mounting private queries and keeps legacy customer fences', () => {
  expect(experienceRoute('/platform/support', actor).allowed).toBe(true)
  expect(experienceRoute('/support/' + grant, actor)).toMatchObject({ audience: 'support', allowed: true, grant })
  expect(experienceRoute('/support/' + grant, { ...actor, platformPermissions: ['platform:clients:view'] }).allowed).toBe(false)
  expect(experienceRoute('/support/' + grant + '/download', actor).allowed).toBe(false)
  expect(experienceRoute('/support/not-a-grant', actor).allowed).toBe(false)
  expect(experienceRoute('/settings/support-access', actor).allowed).toBe(true)
  expect(experienceRoute('/settings/support-access', { ...actor, role: 'Editor' }).allowed).toBe(false)
  expect(experienceRoute('/products/' + product, actor).allowed).toBe(false)
})

it('parses only the active context allowlist and refuses content, reasons and malformed binding', () => {
  expect(parseSupportContext(context()).scopeHash).toBe('a'.repeat(64))
  for (const value of [{ ...context(), reason: 'private' }, { ...context(), scopeHash: 'A'.repeat(64) },
    { ...context(), productIds: [product, product] }, { ...context(), operations: ['product.live.read'] },
    { ...context(), revision: '0' }, { ...context(), state: 'ended' }, { ...context(), expiresAt: new Date(Date.now() - 1).toISOString() }]) {
    expect(() => parseSupportContext(value)).toThrow()
  }
})

it('separates restricted consent metadata from the content context', () => {
  const value = { ...context(), labelReviewHash: 'b'.repeat(64), requestLabels: null, currentLabels: null, labelsChanged: false, durationMinutes: 60, reason: 'Restricted reason', supportCaseReference: 'case:123',
    createdAt: new Date().toISOString(), requestExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    approvedAt: new Date().toISOString(), activationDeadline: new Date(Date.now() + 86400000).toISOString(), endedAt: null, terminalReason: null }
  expect(parseSupportMetadata(value).reason).toBe('Restricted reason')
  expect(() => parseSupportContext(value)).toThrow()
})

it('keeps draft references as exact text with lossless numbers and excludes live/asset fields', () => {
  const projection = parseSupportDraft('{"productId":"' + product + '","draftSchemaVersion":1,"draftRevision":9007199254740993,"draft":{"text":"<img src=https://untrusted.invalid/x>","value":9007199254740993}}')
  expect(projection.draftJson).toContain('9007199254740993')
  expect(projection.draftJson).toContain('<img src=https://untrusted.invalid/x>')
  expect(projection.draftRevision).toBe('9007199254740993')
  expect(() => parseSupportDraft(JSON.stringify({ productId: product, draftSchemaVersion: 1, draftRevision: 1, draft: null, live: 'private' }))).toThrow()
})

it('retires state and the epoch before cancelling, and rejects results from a previous grant or session scope', () => {
  const state = createSupportAuthority()
  state.bind(parseSupportContext(context()), actor)
  const original = state.capture()
  const controller = new AbortController()
  const release = state.own(controller)
  let stateAtAbort: unknown
  controller.signal.addEventListener('abort', () => { stateAtAbort = state.snapshot().context })
  state.retire()
  expect(stateAtAbort).toBeNull()
  expect(original.isCurrent()).toBe(false)
  state.bind(parseSupportContext({ ...context(), id: other }), actor)
  expect(state.retain({ kind: 'draft', productId: product, draftSchemaVersion: 1, draftRevision: '1', draftJson: '"late-private"' }, original.generation)).toBe(false)
  expect(state.snapshot().projection).toBeNull()
  expect(state.snapshot().scopeKey).toContain(actor.securityRevision)
  expect(state.snapshot().scopeKey).toContain(actor.sessionId)
  expect(state.snapshot().scopeKey).toContain(other)
  release()
})

it('binds only the real designated operator and a distinct customer target', () => {
  const state = createSupportAuthority()
  for (const invalid of [{ ...context(), operatorId: product }, { ...context(), targetClientId: actor.clientId }]) {
    expect(() => state.bind(parseSupportContext(invalid), actor)).toThrow()
    expect(state.snapshot().context).toBeNull()
  }
})

it('AV6 rejects product labels transplanted onto another scope while missing labels stay explicitly unavailable', () => {
  expect(() => parseSupportContext({ ...context(), products: [{ id: other, name: 'Foreign label', slug: 'foreign' }] })).toThrow()
  expect(parseSupportContext({ ...context(), products: [], operatorName: null, targetClientName: null }).products).toEqual([])
})

it('AV2 retiring an old error notice cannot restore private authority or dismiss a newer failure', () => {
  const state = createSupportAuthority()
  state.retire({ status: 503, message: 'Unavailable', retryAt: 0 })
  const old = state.capture()
  state.retire({ status: 403, message: 'New denial', retryAt: 0 })
  state.clearNotice(old.generation)
  expect(state.snapshot().notice?.status).toBe(403)
  state.clearNotice(state.snapshot().generation)
  expect(state.snapshot().notice).toBeNull()
  expect(state.snapshot().context).toBeNull()
  expect(state.snapshot().projection).toBeNull()
})


it('AV6 hides compact and hyphenated UUIDs only in presentation while retaining canonical content and full hashes', () => {
  const compact = product.replace(/-/g, '')
  const hash = 'a'.repeat(64)
  const canonical = JSON.stringify({ id: product, embedded: compact, hash })
  const displayed = supportText(canonical)
  expect(displayed).not.toContain(product)
  expect(displayed).not.toContain(compact)
  expect(displayed).toContain('[Identifier hidden]')
  expect(displayed).toContain(hash)
  expect(JSON.parse(canonical)).toEqual({ id: product, embedded: compact, hash })
})

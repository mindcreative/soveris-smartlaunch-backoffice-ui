import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { accountAdmissionApi } from './accountAdmissionApi'

const secret = 'A'.repeat(43)
const context = { contextId: secret, nonce: secret, csrf: secret, expiresIn: 300, challengeOrigin: 'http://localhost:5190', siteKey: 'fixture-site-key' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } }))
afterEach(() => vi.unstubAllGlobals())

it('uses exact anonymous same-origin transport and separates CSRF from the registration body', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(context)).mockResolvedValueOnce(reply({ status: 'check_email', pendingToken: secret, expiresIn: 86400 }, 202))
  vi.stubGlobal('fetch', fetch)
  await accountAdmissionApi.context()
  await accountAdmissionApi.register({ email: 'fixture@example.test', password: 'fixture phrase', admissionContext: secret, turnstileToken: 'opaque' }, undefined, secret)
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/backoffice/auth/admission/context', '/api/backoffice/auth/register'])
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json', 'X-Account-Admission-CSRF': secret } })
  expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
  expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('csrf')
})

it.each([['contextId', 'invalid'], ['expiresIn', 301], ['challengeOrigin', 'http://127.0.0.1:5190'], ['extra', 'private']])('rejects unsafe or open context responses: %s', async (field, value) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...context, [field]: value })))
  await expect(accountAdmissionApi.context()).rejects.toMatchObject({ code: 'account_flow_uncertain' })
})

it('rejects non-JSON and oversized streamed responses', async () => {
  for (const response of [new Response('{}'), new Response(' '.repeat(16385), { headers: { 'Content-Type': 'application/json' } })]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(accountAdmissionApi.context()).rejects.toMatchObject({ code: 'account_flow_uncertain' })
  }
})

it('never retries or discloses provider text after a denial', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ code: 'challenge_required', detail: 'secret-canary' }, 400))
  vi.stubGlobal('fetch', fetch)
  const result = await accountAdmissionApi.context().catch(error => error)
  expect(result.code).toBe('challenge_required')
  expect(JSON.stringify(result)).not.toContain('secret-canary')
  expect(fetch).toHaveBeenCalledTimes(1)
})

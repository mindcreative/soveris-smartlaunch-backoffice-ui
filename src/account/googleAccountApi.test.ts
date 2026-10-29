import { afterEach, expect, it, vi } from 'vitest'
import { googleAccountApi } from './googleAccountApi'

afterEach(() => vi.unstubAllGlobals())

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

it('uses the exact same-origin proxy with cookies and CSRF and omits the full bearer for initial completion', async () => {
  localStorage.setItem('backoffice_access_token', 'must-not-forward')
  const fetch = vi.fn().mockResolvedValueOnce(response({ csrf: 'A'.repeat(43), expiresIn: 300, enabled: true }))
    .mockResolvedValueOnce(response({ status: 'cancelled' }))
  vi.stubGlobal('fetch', fetch)
  const result = await googleAccountApi.complete()

  expect(result).toEqual({ status: 'cancelled' })
  expect(fetch.mock.calls[0][0]).toBe('/api/backoffice/auth/google/context')
  expect(fetch.mock.calls[1][0]).toBe('/api/backoffice/auth/google/complete')
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{}',
    headers: { 'Content-Type': 'application/json', 'X-Account-CSRF': 'A'.repeat(43) } })
  expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization')
})

it('fails closed on unknown outcomes and never retains raw provider errors', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ csrf: 'A'.repeat(43), expiresIn: 300, enabled: true }))
    .mockResolvedValueOnce(response({ status: 'unrecognized', private: 'canary' }))
  vi.stubGlobal('fetch', fetch)

  await expect(googleAccountApi.complete()).rejects.toMatchObject({ code: 'account_flow_uncertain' })
})

it('does not navigate to an arbitrary authorization destination returned by a compromised response', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ csrf: 'A'.repeat(43), expiresIn: 300, enabled: true }))
    .mockResolvedValueOnce(response({ authorizationUrl: 'https://attacker.test/?code=private', expiresIn: 300 }))
  vi.stubGlobal('fetch', fetch)

  await expect(googleAccountApi.start('signup')).rejects.toMatchObject({ code: 'account_flow_uncertain' })
})

it('forwards only the current session on separately authenticated linking and requires explicit confirmation', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ csrf: 'A'.repeat(43), expiresIn: 300, enabled: true }))
    .mockResolvedValueOnce(response({ status: 'login_required', loginRequired: true }))
  vi.stubGlobal('fetch', fetch)
  await googleAccountApi.link('B'.repeat(42) + 'A', 'current-session')

  expect(fetch.mock.calls[1][1]).toMatchObject({ headers: { Authorization: 'Bearer current-session' },
    body: JSON.stringify({ proof: 'B'.repeat(42) + 'A', confirm: true }) })
})

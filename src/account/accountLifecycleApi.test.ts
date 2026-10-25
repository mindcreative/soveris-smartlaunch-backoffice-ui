import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { apiClient } from '../api/apiClient'
import { bindAuthorityToken } from '../auth/authorityEpoch'
import { accountLifecycleApi } from './accountLifecycleApi'

const transport = (apiClient as unknown as { client: AxiosInstance }).client

beforeEach(() => {
  localStorage.setItem('backoffice_access_token', 'unrelated-full-session')
  bindAuthorityToken('unrelated-full-session')
})

describe('exact anonymous lifecycle transport', () => {
  const pendingToken = 'A'.repeat(43)
  const proof = 'Q'.repeat(42) + 'A'

  it('sends exact DTOs with neither a full bearer nor implicit continuation properties', async () => {
    const sent: { path: string | undefined; body: unknown }[] = []
    transport.defaults.adapter = async config => {
      expect(config.headers.has('Authorization')).toBe(false)
      sent.push({ path: config.url, body: JSON.parse(config.data) })
      const data = config.url === '/auth/register'
        ? { status: 'check_email', pendingToken, expiresIn: 86400 }
        : config.url === '/auth/registration/verify'
          ? { status: 'activation_complete', loginRequired: true }
          : config.url === '/auth/password/reset'
            ? { status: 'password_reset', loginRequired: true }
            : { status: config.url === '/auth/password/forgot' ? 'instructions_requested' : 'check_email' }

      return { data, status: 200, statusText: 'OK', headers: {}, config }
    }

    await accountLifecycleApi.register({ email: 'test@example.test', password: ' exact password ', returnIntent: 'create_first_product' })
    await accountLifecycleApi.resend({ pendingToken })
    await accountLifecycleApi.correctEmail({ pendingToken, email: 'next@example.test' })
    await accountLifecycleApi.verify({ proof, pendingToken })
    await accountLifecycleApi.verify({ proof, password: ' original ' })
    await accountLifecycleApi.forgot({ email: 'test@example.test' })
    await accountLifecycleApi.reset({ proof, newPassword: ' replacement password ' })

    expect(sent).toEqual([
      { path: '/auth/register', body: { email: 'test@example.test', password: ' exact password ', returnIntent: 'create_first_product' } },
      { path: '/auth/registration/resend', body: { pendingToken } },
      { path: '/auth/registration/correct-email', body: { pendingToken, email: 'next@example.test' } },
      { path: '/auth/registration/verify', body: { proof, pendingToken } },
      { path: '/auth/registration/verify', body: { proof, password: ' original ' } },
      { path: '/auth/password/forgot', body: { email: 'test@example.test' } },
      { path: '/auth/password/reset', body: { proof, newPassword: ' replacement password ' } },
    ])
  })

  it.each([400, 401, 403, 429, 503])('never refreshes, retries, clears or suspends a full session after lifecycle %i', async status => {
    const events = ['auth:cleared', 'auth:suspended', 'auth:forbidden'].map(name => {
      const listener = vi.fn()
      window.addEventListener(name, listener)

      return { name, listener }
    })
    let requests = 0
    transport.defaults.adapter = async config => {
      requests++
      throw { config, response: { status, data: { code: 'invalid_pending_authority' }, headers: {}, config } }
    }

    try {
      await expect(accountLifecycleApi.resend({ pendingToken })).rejects.toMatchObject({ status })
      expect(requests).toBe(1)
      expect(localStorage.getItem('backoffice_access_token')).toBe('unrelated-full-session')

      for (const { listener } of events) {
        expect(listener).not.toHaveBeenCalled()
      }
    } finally {
      for (const { name, listener } of events) {
        window.removeEventListener(name, listener)
      }
    }
  })

  it('retains only allowlisted code-only failure fields, including durable activation', async () => {
    const correlationId = '01990000-0000-7000-8000-000000000001'
    transport.defaults.adapter = async config => {
      throw { config, response: { status: 503, headers: { 'retry-after': '90' }, config,
        data: { code: 'account_flow_unavailable', loginRequired: true, correlationId, password: 'private-canary', detail: 'private-canary' } } }
    }

    await expect(accountLifecycleApi.verify({ proof, pendingToken })).rejects.toEqual({
      code: 'account_flow_unavailable', status: 503, message: 'Account services are temporarily unavailable. Try again later.',
      loginRequired: true, retryAfterSeconds: 90, correlationId,
    })
  })

  it('does not trust unknown codes, unbounded delays or a malicious correlation identifier', async () => {
    transport.defaults.adapter = async config => {
      throw { config, response: { status: 429, headers: { 'retry-after': '999999999999999' }, config,
        data: { code: 'private-canary', loginRequired: 'yes', correlationId: '<private-canary>' } } }
    }

    await expect(accountLifecycleApi.resend({ pendingToken })).rejects.toEqual({
      code: 'account_flow_limited', status: 429, message: 'Too many attempts. Wait before trying again.',
    })
  })

  it('drops transport configuration and credentials from cancellation and network errors without a response', async () => {
    transport.defaults.adapter = async config => {
      throw { code: 'ERR_CANCELED', message: 'private-canary', config, request: { password: 'private-canary' } }
    }

    const failure = await accountLifecycleApi.register({ email: 'test@example.test', password: 'private-canary' }).catch(error => error)

    expect(Object.keys(failure).sort()).toEqual(['code', 'message', 'status'])
    expect(failure.code).toBe('account_flow_uncertain')
    expect(JSON.stringify(failure).includes('private-canary')).toBe(false)
  })
})

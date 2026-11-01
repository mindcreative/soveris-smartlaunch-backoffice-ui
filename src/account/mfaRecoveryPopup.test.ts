import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { googleAccountApi } from './googleAccountApi'
import { MFA } from './constants/mfa'
import { listenForRecoveryParent, refreshGoogleRecoveryPrimary } from './mfaRecoveryPopup'
import type { MfaOperation } from './models/mfa'

const protocol = MFA.recoveryPopupProtocol
const controller = () => new AbortController()
let abort: AbortController
let popup: Window
let operation: MfaOperation
let primary: Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  abort = controller()
  popup = { closed: false, close: vi.fn(), postMessage: vi.fn(), location: { replace: vi.fn() } } as unknown as Window
  operation = { signal: abort.signal, isCurrent: () => !abort.signal.aborted, pageIsCurrent: () => true }
  primary = { status: 'mfa_required', challenge: { id: '01990000-0000-7000-8000-000000000009', secret: 'A'.repeat(43),
    purpose: 'login', expiresAt: new Date(Date.now() + 240_000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'Q'.repeat(43) }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  vi.spyOn(googleAccountApi, 'start').mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?fixture=owned', expiresIn: 300 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function send(data: unknown, source: Window = popup, origin = window.location.origin): void {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin }))
}

it('accepts primary proof only from the exact window, origin and random handshake', async () => {
  const result = refreshGoogleRecoveryPrimary(operation, new Date(Date.now() + 90_000).toISOString())
  await Promise.resolve()
  expect(popup.location.replace).toHaveBeenCalledOnce()
  send({ protocol, kind: 'ready' }, window)
  send({ protocol, kind: 'ready' }, popup, 'https://foreign.invalid')
  expect(popup.postMessage).not.toHaveBeenCalled()
  send({ protocol, kind: 'ready' })
  const binding = vi.mocked(popup.postMessage).mock.calls[0][0] as { nonce: string }
  expect(binding.nonce).toMatch(/^[a-f0-9]{64}$/)
  send({ protocol, kind: 'primary', nonce: 'wrong', result: primary })
  expect(popup.close).not.toHaveBeenCalled()
  send({ protocol, kind: 'primary', nonce: binding.nonce, result: primary })
  await expect(result).resolves.toEqual({ challenge: primary.challenge, csrfToken: primary.csrfToken })
  expect(popup.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('expires at the original recovery deadline and cancels a late provider response', async () => {
  const result = refreshGoogleRecoveryPrimary(operation, new Date(Date.now() + 1000).toISOString())
  const rejected = expect(result).rejects.toMatchObject({ code: 'invalid_mfa_flow' })
  await vi.advanceTimersByTimeAsync(1000)
  await rejected
  expect(popup.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('closes on cancellation without passing recovery continuation to the provider', async () => {
  const result = refreshGoogleRecoveryPrimary(operation, new Date(Date.now() + 60_000).toISOString())
  const rejected = expect(result).rejects.toMatchObject({ code: 'invalid_mfa_flow' })
  abort.abort()
  await rejected
  expect(googleAccountApi.start).toHaveBeenCalledWith('login', undefined, abort.signal)
  expect(popup.close).toHaveBeenCalledOnce()
})

it('retires the child sender and listener on teardown', () => {
  vi.stubGlobal('opener', popup)
  const bound = vi.fn()
  const stop = listenForRecoveryParent(bound)
  send({ protocol, kind: 'bind', nonce: 'a'.repeat(64) }, window)
  expect(bound).not.toHaveBeenCalled()
  send({ protocol, kind: 'bind', nonce: 'a'.repeat(64) })
  expect(bound).toHaveBeenCalledOnce()
  const sender = bound.mock.calls[0][0] as (result: unknown) => void
  stop()
  vi.mocked(popup.postMessage).mockClear()
  sender(primary)
  expect(popup.postMessage).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TurnstileChallenge } from './TurnstileChallenge'
import { CHALLENGE_MESSAGES } from './constants/turnstile'
import { ACCOUNT_ERROR_MESSAGES } from './constants/accountLifecycle'
import { accountAdmissionApi } from './accountAdmissionApi'
import { useTurnstileChallenge } from './useTurnstileChallenge'
import type { TurnstileState } from './models/turnstile'

it.each([
  { status: 429, code: 'account_rate_limited' as const, retryAfterSeconds: 600 },
  { status: 503, code: 'account_temporarily_unavailable' as const, retryAfterSeconds: 60 },
])('preserves a context $status cooldown until a deliberate fresh request', async denial => {
  vi.useFakeTimers()

  try {
    const startedAt = Date.now()
    const context = { contextId: 'fresh', nonce: 'nonce', csrf: 'csrf', expiresIn: 300, challengeOrigin: 'http://localhost:5190', siteKey: 'public' }
    const request = vi.spyOn(accountAdmissionApi, 'context').mockRejectedValueOnce({ ...denial, message: 'Untrusted detail' }).mockResolvedValue(context)
    const view = renderHook(() => useTurnstileChallenge())
    await act(async () => {})

    expect(view.result.current.error?.message).toBe(ACCOUNT_ERROR_MESSAGES[denial.code])
    expect(view.result.current.retryAt).toBe(startedAt + denial.retryAfterSeconds * 1000)
    expect(view.result.current.context).toBeNull()
    act(() => view.result.current.retry())
    expect(request).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(denial.retryAfterSeconds * 1000))
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => view.result.current.retry())
    expect(request).toHaveBeenCalledTimes(2)
    expect(view.result.current.context).toEqual(context)
    expect(view.result.current.error).toBeNull()
    view.unmount()
  } finally {
    vi.useRealTimers()
  }
})

it('focuses cooldown guidance and keeps countdown changes outside the live status', async () => {
  vi.useFakeTimers()

  try {
    vi.spyOn(accountAdmissionApi, 'context').mockRejectedValue({ code: 'account_rate_limited', status: 429, retryAfterSeconds: 60 })

    function Challenge() {
      return <TurnstileChallenge challenge={useTurnstileChallenge()} />
    }

    const view = render(<Challenge />)
    await act(async () => {})
    const guidance = screen.getByRole('status')
    const retry = screen.getByRole('button', { name: 'Retry security check' })
    expect(guidance).toHaveTextContent(ACCOUNT_ERROR_MESSAGES.account_rate_limited)
    expect(guidance).toHaveFocus()
    expect(retry).toBeDisabled()
    expect(screen.getByText('Retry available in 60 seconds.')).toHaveAttribute('aria-live', 'off')
    await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Retry available in 59 seconds.')).toHaveAttribute('aria-live', 'off')
    expect(guidance).toHaveTextContent(ACCOUNT_ERROR_MESSAGES.account_rate_limited)
    expect(guidance).not.toHaveTextContent('59')
    expect(accountAdmissionApi.context).toHaveBeenCalledTimes(1)
    view.unmount()
  } finally {
    vi.useRealTimers()
  }
})

it('accepts one closed message only from the current child window, origin and nonce', () => {
  const outcome = vi.fn()
  const context = { contextId: 'context', nonce: 'nonce', csrf: 'csrf', expiresIn: 300, challengeOrigin: 'http://localhost:5190', siteKey: 'public' }
  const challenge: TurnstileState = { error: null, retryAt: 0, context, status: 'checking', outcome, retry: vi.fn(), consume: vi.fn() }
  const view = render(<TurnstileChallenge challenge={challenge} />)
  const frame = screen.getByTitle('Complete the account security check') as HTMLIFrameElement
  const send = (origin: string, source: Window | null, message: unknown) => fireEvent(window, new MessageEvent('message', { origin, source, data: message }))
  const success = { type: CHALLENGE_MESSAGES.success, nonce: 'nonce', token: 'opaque-token' }
  send('http://attacker.test', frame.contentWindow, success)
  send(context.challengeOrigin, window, success)
  send(context.challengeOrigin, frame.contentWindow, { ...success, nonce: 'old' })
  send(context.challengeOrigin, frame.contentWindow, { ...success, extra: true })
  expect(outcome).not.toHaveBeenCalled()
  send(context.challengeOrigin, frame.contentWindow, success)
  send(context.challengeOrigin, frame.contentWindow, success)
  expect(outcome).toHaveBeenCalledExactlyOnceWith('success', 'opaque-token')
  view.unmount()
  send(context.challengeOrigin, null, success)
  expect(outcome).toHaveBeenCalledTimes(1)
})

it('exposes an explicit keyboard button for unavailable challenge without replaying credentials', () => {
  const retry = vi.fn()
  render(<TurnstileChallenge challenge={{ error: null, retryAt: 0, context: null, status: 'unavailable', outcome: vi.fn(), retry, consume: vi.fn() }} />)
  expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable')
  expect(screen.getByRole('button', { name: 'Retry security check' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Retry security check' }))
  expect(retry).toHaveBeenCalledTimes(1)
  expect(screen.queryByTitle('Complete the account security check')).not.toBeInTheDocument()
})

it('bounds a blocked child load and retires the timeout after a ready outcome', () => {
  vi.useFakeTimers()
  try {
    const outcome = vi.fn()
    const context = { contextId: 'context', nonce: 'nonce', csrf: 'csrf', expiresIn: 300, challengeOrigin: 'http://localhost:5190', siteKey: 'public' }
    const view = render(<TurnstileChallenge challenge={{ error: null, retryAt: 0, context, status: 'checking', outcome, retry: vi.fn(), consume: vi.fn() }} />)
    vi.advanceTimersByTime(15000)
    expect(outcome).toHaveBeenCalledExactlyOnceWith('timeout')
    view.unmount()
    outcome.mockClear()
    const readyView = render(<TurnstileChallenge challenge={{ error: null, retryAt: 0, context, status: 'checking', outcome, retry: vi.fn(), consume: vi.fn() }} />)
    const frame = screen.getByTitle('Complete the account security check') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { origin: context.challengeOrigin, source: frame.contentWindow,
      data: { type: CHALLENGE_MESSAGES.ready, nonce: context.nonce } }))
    vi.advanceTimersByTime(15000)
    expect(outcome).toHaveBeenCalledExactlyOnceWith('ready', undefined)
    readyView.unmount()
  } finally {
    vi.useRealTimers()
  }
})


it('preserves focus in an active credential field when a challenge fails asynchronously', () => {
  const base = { error: null, retryAt: 0, context: null, outcome: vi.fn(), retry: vi.fn(), consume: vi.fn() }
  const view = render(<><input aria-label="Owned credential field" /><TurnstileChallenge challenge={{ ...base, status: 'checking' }} /></>)
  screen.getByLabelText('Owned credential field').focus()
  view.rerender(<><input aria-label="Owned credential field" /><TurnstileChallenge challenge={{ ...base, status: 'unavailable' }} /></>)

  expect(screen.getByLabelText('Owned credential field')).toHaveFocus()
  expect(base.consume).not.toHaveBeenCalled()
  expect(base.retry).not.toHaveBeenCalled()
})

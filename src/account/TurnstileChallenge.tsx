import { useEffect, useId, useRef } from 'react'
import { ACCOUNT_BUTTON_CLASS } from './constants/accountLifecycle'
import { ACCOUNT_ADMISSION, CHALLENGE_MESSAGES } from './constants/turnstile'
import type { TurnstileChallengeProps } from './models/turnstile'
import { useAccountClock } from './useAccountAction'

export function TurnstileChallenge({ challenge }: TurnstileChallengeProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const guidance = useRef<HTMLParagraphElement>(null)
  const countdownId = useId()
  const now = useAccountClock()
  const outcome = useRef(challenge.outcome)
  outcome.current = challenge.outcome
  const context = challenge.context

  useEffect(() => {
    if (!context) {
      return
    }

    let terminal = false
    const readiness = setTimeout(() => {
      if (!terminal) {
        terminal = true
        outcome.current('timeout')
      }
    }, ACCOUNT_ADMISSION.childReadinessMilliseconds)
    const receive = (event: MessageEvent) => {
      const data: unknown = event.data

      if (terminal || event.origin !== context.challengeOrigin || event.source !== frame.current?.contentWindow ||
        !data || typeof data !== 'object' || Array.isArray(data)) {
        return
      }

      const message = data as Record<string, unknown>
      const success = message.type === CHALLENGE_MESSAGES.success
      const keys = success ? ['type', 'nonce', 'token'] : ['type', 'nonce']
      const knownType = Object.entries(CHALLENGE_MESSAGES).find(([type, value]) => type !== 'init' && value === message.type)?.[0]

      if (!knownType || message.nonce !== context.nonce || Object.keys(message).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(message, key)) ||
        success && (typeof message.token !== 'string' || message.token.length === 0 || message.token.length > ACCOUNT_ADMISSION.maximumTokenCharacters)) {
        return
      }

      terminal = knownType !== 'ready'
      clearTimeout(readiness)
      outcome.current(knownType as 'ready' | 'success' | 'expired' | 'error' | 'timeout', success ? message.token as string : undefined)
    }
    window.addEventListener('message', receive)

    return () => {
      terminal = true
      clearTimeout(readiness)
      window.removeEventListener('message', receive)
    }
  }, [context])

  const failed = challenge.status === 'expired' || challenge.status === 'unavailable'
  const needsRetry = failed || challenge.status === 'consumed'
  const waitingSeconds = Math.max(0, Math.ceil((challenge.retryAt - now) / 1000))

  useEffect(() => {
    // Recover focus after a removed/blocked frame without interrupting someone
    // who is already typing in a credential field or reading error guidance.
    const active = document.activeElement
    const usefulFocus = active instanceof HTMLElement && active.matches('input, textarea, select, button, a[href], [role="alert"]')

    if (failed && !usefulFocus) {
      if (Date.now() < challenge.retryAt) {
        guidance.current?.focus()
      } else {
        retryButton.current?.focus()
      }
    }
  }, [failed, challenge.retryAt])

  return <section aria-label="Security check" className="min-w-0 space-y-2">
    <p className="text-sm font-medium">Security check</p>
    <p ref={guidance} tabIndex={-1} role={challenge.status === 'consumed' ? undefined : 'status'} className="text-sm text-muted focus-visible:ring-2 focus-visible:ring-focus">{challenge.error?.message ?? (challenge.status === 'consumed' ? 'A fresh security check is required before another attempt.'
      : challenge.status === 'ready' ? 'Security check complete.'
      : challenge.status === 'expired' ? 'Please complete the security check again.'
        : challenge.status === 'unavailable' ? 'Account services are temporarily unavailable. Please try again shortly.' : 'Complete the security check below.')}</p>
    {context && <iframe ref={frame} title="Complete the account security check" data-account-challenge="true"
      src={context.challengeOrigin + '/'} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      className="h-52 w-full border-0" onLoad={() => frame.current?.contentWindow?.postMessage({
        type: CHALLENGE_MESSAGES.init, nonce: context.nonce, siteKey: context.siteKey,
      }, context.challengeOrigin)} />}
    {needsRetry && <>
      {waitingSeconds > 0 && <p id={countdownId} aria-live="off" className="text-sm text-muted">Retry available in {waitingSeconds} seconds.</p>}
      <button ref={retryButton} type="button" className={ACCOUNT_BUTTON_CLASS} onClick={challenge.retry}
        disabled={waitingSeconds > 0} aria-describedby={waitingSeconds > 0 ? countdownId : undefined}>Retry security check</button>
    </>}
  </section>
}

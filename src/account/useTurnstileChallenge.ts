import { useCallback, useEffect, useRef, useState } from 'react'
import { accountAdmissionApi } from './accountAdmissionApi'
import { normalizeAccountError } from './accountLifecycleError'
import type { ApiError } from '../api/apiClient'
import type { AccountAdmissionContext, ChallengeStatus, TurnstileState } from './models/turnstile'

export function useTurnstileChallenge(): TurnstileState {
  const [generation, setGeneration] = useState(0)
  const [context, setContext] = useState<AccountAdmissionContext | null>(null)
  const [status, setStatus] = useState<ChallengeStatus>('loading')
  const [error, setError] = useState<ApiError | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const token = useRef<string | null>(null)
  const expiresAt = useRef(0)
  const retryDeadline = useRef(0)

  useEffect(() => {
    const cancellation = new AbortController()
    let expiry: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    token.current = null
    setContext(null)
    setStatus('loading')
    setError(null)
    setRetryAt(0)
    retryDeadline.current = 0
    void accountAdmissionApi.context(cancellation.signal).then(result => {
      if (cancellation.signal.aborted) {
        return
      }

      expiresAt.current = startedAt + result.expiresIn * 1000
      setContext(result)
      setStatus('checking')
      expiry = setTimeout(() => {
        token.current = null
        setContext(null)
        setStatus('expired')
      }, Math.max(0, expiresAt.current - Date.now()))
    }).catch(failure => {
      if (!cancellation.signal.aborted) {
        const candidate = failure as ApiError | undefined
        const normalized = normalizeAccountError(candidate, candidate?.status, candidate?.retryAfterSeconds)
        const deadline = Date.now() + (normalized.retryAfterSeconds ?? 0) * 1000
        token.current = null
        expiresAt.current = 0
        retryDeadline.current = deadline
        setContext(null)
        setError(normalized)
        setRetryAt(deadline)
        setStatus('unavailable')
      }
    })

    return () => {
      cancellation.abort()
      clearTimeout(expiry)
      token.current = null
    }
  }, [generation])

  const retry = useCallback(() => {
    if (Date.now() < retryDeadline.current) {
      return
    }

    setGeneration(value => value + 1)
  }, [])

  return {
    context, status, error, retryAt, retry,
    outcome: (type, value) => {
      if (type === 'success' && value && context && expiresAt.current > Date.now()) {
        token.current = value
        setStatus('ready')
      } else if (type !== 'ready') {
        token.current = null
        setContext(null)
        setStatus(type === 'expired' ? 'expired' : 'unavailable')
      }
    },
    consume: () => {
      const value = token.current
      token.current = null
      setContext(null)

      if (!value || !context || expiresAt.current <= Date.now()) {
        setStatus('expired')

        throw normalizeAccountError({ code: 'challenge_required' })
      }

      setStatus('consumed')

      return { contextId: context.contextId, token: value, csrf: context.csrf }
    },
  }
}

import { useEffect, useRef, useState } from 'react'
import { accountFlow } from './accountFlow'
import { normalizeAccountError } from './accountLifecycleError'
import type { ApiError } from '../api/apiClient'
import type { AccountAction } from './models/accountPresentation'

export function useAccountAction(): AccountAction {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [retryAt, setRetryAt] = useState(0)

  useEffect(() => () => {
    accountFlow.cancel()
    busy.current = false
  }, [])

  return { pending, error, retryAt, run: async (action, onFailure) => {
    if (busy.current || Date.now() < retryAt) {
      return
    }

    busy.current = true
    setPending(true)
    setError(null)
    const operation = accountFlow.begin()

    try {
      await action(operation)
    } catch (failure) {
      if (!operation.isCurrent()) {
        return
      }

      const candidate = failure as ApiError | undefined
      const normalized = normalizeAccountError(candidate, candidate?.status, candidate?.retryAfterSeconds)
      setError(normalized)
      setRetryAt(normalized.retryAfterSeconds ? Date.now() + normalized.retryAfterSeconds * 1000 : 0)
      onFailure?.(normalized)
    } finally {
      busy.current = false

      if (operation.isCurrent()) {
        setPending(false)
      }
    }
  } }
}

export function useAccountClock(): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(interval)
  }, [])

  return now
}

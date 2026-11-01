import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { mfaFlow } from './mfaFlow'
import { useAccountClock } from './useAccountAction'
import { normalizeMfaError } from './mfaError'
import type { MfaActionState, MfaOperation } from './models/mfa'

export function useMfaSnapshot() {
  return useSyncExternalStore(mfaFlow.subscribe, mfaFlow.snapshot, mfaFlow.snapshot)
}

export function useMfaPrivateInput(): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState('')

  useEffect(() => {
    const clear = () => setValue('')
    const unsubscribe = mfaFlow.subscribe(clear)
    const events = ['auth:retired', 'auth:privileged-retired', 'pagehide']

    for (const event of events) {
      window.addEventListener(event, clear)
    }

    return () => {
      unsubscribe()

      for (const event of events) {
        window.removeEventListener(event, clear)
      }
    }
  }, [])

  return [value, setValue]
}

export function useMfaAction(): MfaActionState {
  const now = useAccountClock()
  const alive = useRef(true)
  const active = useRef<MfaOperation | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MfaActionState['error']>(null)
  const [retryAt, setRetryAt] = useState(0)

  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
      active.current = null
      mfaFlow.cancel()
    }
  }, [])

  return { pending, error, retryAt, run: async action => {
    if (active.current || now < retryAt) {
      return
    }

    const operation = mfaFlow.begin()
    active.current = operation
    setPending(true)
    setError(null)

    try {
      await action(operation)
    } catch (failure) {
      if (operation.isCurrent() && alive.current) {
        const candidate = failure as { status?: number; retryAfterSeconds?: number } | null
        const safe = normalizeMfaError(failure, candidate?.status, candidate?.retryAfterSeconds)
        setError(safe)
        setRetryAt(safe.retryAfterSeconds ? Date.now() + safe.retryAfterSeconds * 1000 : 0)

        if (safe.status === 503) {
          window.dispatchEvent(new CustomEvent('mfa:unavailable'))
        }
      }
    } finally {
      if (active.current === operation) {
        active.current = null

        if (alive.current) {
          setPending(false)
        }
      }
    }
  } }
}

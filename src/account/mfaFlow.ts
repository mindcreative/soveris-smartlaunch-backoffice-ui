import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { MFA, MFA_ROUTES } from './constants/mfa'
import type { MfaBoundChallenge, MfaEnrollment, MfaFlowDependencies, MfaFlowSnapshot, MfaOperation, MfaRecoveryContinuation } from './models/mfa'

function empty(): MfaFlowSnapshot {
  return { login: null, primary: null, stepUp: null, recovery: null, freshRecoveryPrimary: null, enrollment: null,
    codes: null, codesExpireAt: null, returnPath: null, linkAfterLogin: false }
}

export function createMfaFlow(dependencies: MfaFlowDependencies) {
  let state = empty()
  let generation = 0
  let navigation = 0
  let handoff: string | null = null
  let controller: AbortController | null = null
  const listeners = new Set<() => void>()
  const disclosures = new Set<string>()

  function replace(next: MfaFlowSnapshot): void {
    state = next

    for (const listener of listeners) {
      listener()
    }
  }

  function cancel(): void {
    generation++
    controller?.abort()
    controller = null
  }

  function retireDisclosures(): void {
    for (const url of disclosures) {
      URL.revokeObjectURL(url)
    }

    disclosures.clear()
  }

  function clear(): void {
    cancel()
    retireDisclosures()
    handoff = null
    replace(empty())
  }

  function expire(): void {
    const now = dependencies.now()
    const expired = (value: { expiresAt: string } | null) => value !== null && Date.parse(value.expiresAt) <= now
    const next = { ...state }
    let changed = false

    for (const key of ['login', 'primary', 'stepUp', 'freshRecoveryPrimary'] as const) {
      if (expired(next[key]?.challenge ?? null)) {
        next[key] = null
        changed = true
      }
    }

    if (expired(next.recovery)) {
      next.recovery = null
      next.freshRecoveryPrimary = null

      if (next.enrollment?.recovery) {
        next.enrollment = null
        retireDisclosures()
      }

      changed = true
    }

    if (expired(next.enrollment)) {
      next.enrollment = null
      retireDisclosures()
      changed = true
    }

    if (next.codesExpireAt !== null && next.codesExpireAt <= now) {
      next.codes = null
      next.codesExpireAt = null
      changed = true
    }

    if (changed) {
      cancel()
      replace(next)
    }
  }

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)

      return () => { listeners.delete(listener) }
    },
    clear,
    cancel,
    expire,
    begin: (): MfaOperation => {
      expire()
      cancel()
      controller = new AbortController()
      const operation = controller
      const capturedGeneration = generation
      const capturedNavigation = navigation
      const epoch = dependencies.epoch()
      const session = dependencies.session()

      return { signal: operation.signal, isCurrent: () => !operation.signal.aborted && capturedGeneration === generation
        && dependencies.epoch() === epoch && dependencies.session() === session,
      pageIsCurrent: () => navigation === capturedNavigation }
    },
    setLogin: (bound: MfaBoundChallenge) => replace({ ...state, login: bound }),
    setPrimary: (bound: MfaBoundChallenge) => replace({ ...state, primary: bound }),
    setStepUp: (bound: MfaBoundChallenge) => replace({ ...state, stepUp: bound }),
    clearStepUp: () => replace({ ...state, stepUp: null }),
    rejectChallenge: (id: string) => {
      const next = { ...state }

      for (const key of ['login', 'stepUp'] as const) {
        const bound = next[key]

        if (bound?.challenge.id === id) {
          next[key] = { ...bound, challenge: { ...bound.challenge, attemptsRemaining: Math.max(0, bound.challenge.attemptsRemaining - 1) } }
        }
      }

      replace(next)
    },
    setRecovery: (continuation: MfaRecoveryContinuation) => replace({ ...state, login: null, recovery: continuation }),
    setFreshRecoveryPrimary: (bound: MfaBoundChallenge) => replace({ ...state, freshRecoveryPrimary: bound }),
    setEnrollment: (enrollment: MfaEnrollment) => replace({ ...state, enrollment, primary: null, stepUp: null, freshRecoveryPrimary: null }),
    setCodes: (codes: readonly string[]) => {
      retireDisclosures()
      replace({ ...empty(), codes: [...codes], codesExpireAt: dependencies.now() + MFA.enrollmentMilliseconds })
    },
    setReturn: (path: unknown, googleLink = false) => replace({ ...state,
      returnPath: typeof path === 'string' && path.length <= 2048 && /^\/[a-zA-Z0-9/-]+$/.test(path) ? path : null,
      linkAfterLogin: googleLink }),
    offerHandoff: (path: string) => {
      if (!Object.values(MFA_ROUTES).some(route => route === path)) {
        clear()

        return
      }

      handoff = path
    },
    navigate: (path: string) => {
      navigation++
      cancel()

      if (handoff === path) {
        handoff = null
        expire()
      } else {
        clear()
      }
    },
    nextExpiry: () => {
      const times = [state.login?.challenge.expiresAt, state.primary?.challenge.expiresAt, state.stepUp?.challenge.expiresAt,
        state.recovery?.expiresAt, state.freshRecoveryPrimary?.challenge.expiresAt, state.enrollment?.expiresAt]
        .filter((value): value is string => typeof value === 'string').map(Date.parse)

      if (state.codesExpireAt !== null) {
        times.push(state.codesExpireAt)
      }

      return times.length > 0 ? Math.min(...times) : null
    },
    registerDisclosureUrl: (url: string) => disclosures.add(url),
    releaseDisclosureUrl: (url: string) => {
      disclosures.delete(url)
      URL.revokeObjectURL(url)
    },
  }
}

function storedSession(): string {
  try {
    return JSON.stringify([localStorage.getItem('backoffice_access_token'), localStorage.getItem('backoffice_refresh_token')])
  } catch {
    return 'unavailable'
  }
}

export const mfaFlow = createMfaFlow({ now: () => Date.now(), epoch: currentAuthorityEpoch, session: storedSession })
window.addEventListener('auth:retired', () => mfaFlow.clear())
window.addEventListener('pagehide', () => mfaFlow.clear())
window.addEventListener('storage', event => {
  if (event.key === null || ['backoffice_access_token', 'backoffice_refresh_token', 'backoffice-auth-persist'].includes(event.key)) {
    mfaFlow.clear()
  }
})

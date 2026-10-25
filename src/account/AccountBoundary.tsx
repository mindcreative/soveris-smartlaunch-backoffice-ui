import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { accountFlow } from './accountFlow'
import { AccountLayout } from './AccountLayout'
import { ACCOUNT_BUTTON_CLASS } from './constants/accountLifecycle'

export function AccountBoundary() {
  const initialized = useAuthStore(state => state.isInitialized)
  const loading = useAuthStore(state => state.isLoading)
  const signedIn = useAuthStore(state => state.isAuthenticated)
  const unavailable = useAuthStore(state => state.authorityUnavailable)
  const location = useLocation()
  const [generation, setGeneration] = useState(0)
  const leaving = useRef(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!initialized) {
      return
    }

    const retire = () => {
      accountFlow.clear()
      setGeneration(previous => previous + 1)
    }
    window.addEventListener('auth:retired', retire)

    return () => window.removeEventListener('auth:retired', retire)
  }, [initialized])

  useEffect(() => {
    accountFlow.cancel()

    return () => accountFlow.cancel()
  }, [location.pathname])

  useEffect(() => {
    const hide = () => {
      accountFlow.clear()
      flushSync(() => setGeneration(previous => previous + 1))
    }
    window.addEventListener('pagehide', hide)
    const proofEntry = () => {
      leaving.current = false
      setSigningOut(false)
      setGeneration(previous => previous + 1)
    }
    window.addEventListener('account:proof-entry', proofEntry)

    return () => {
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('account:proof-entry', proofEntry)
    }
  }, [])

  async function signOut(): Promise<void> {
    if (leaving.current) {
      return
    }

    leaving.current = true
    setSigningOut(true)
    const kind = location.pathname.toLowerCase().startsWith('/verify-email') ? 'verify' : 'reset'
    const continuation = accountFlow.releaseProof(kind)
    const pageOperation = accountFlow.begin()
    const signingOut = useAuthStore.getState().logout()
    const retiredEpoch = currentAuthorityEpoch()
    await signingOut

    if (!pageOperation.pageIsCurrent()) {
      return
    }

    // Only this deliberate page action may survive its own logout. A concurrent
    // replacement session or retirement invalidates even this narrow exception.
    if (continuation && continuation.expiresAt > Date.now() && retiredEpoch === currentAuthorityEpoch() && !useAuthStore.getState().accessToken) {
      accountFlow.setProof(continuation)
    }

    leaving.current = false
    setSigningOut(false)
  }

  if (!initialized) {
    return <AccountLayout title="Checking current session"><p role="status">Restoring access…</p></AccountLayout>
  }

  const acceptingThisActivation = loading && /^\/verify-email\/*$/i.test(location.pathname)

  if (signedIn || unavailable || (useAuthStore.getState().accessToken && !acceptingThisActivation)) {
    return <AccountLayout title="Continue with another account" description="A current or unverified session is present. Sign out explicitly before starting an account action.">
      <button className={ACCOUNT_BUTTON_CLASS} type="button" disabled={signingOut} onClick={() => void signOut()}>Sign out to continue</button>
    </AccountLayout>
  }

  return <Outlet key={`${location.pathname}:${generation}:${signingOut}`} />
}

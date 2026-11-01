import { useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { mfaFlow } from './mfaFlow'
import { useMfaSnapshot } from './useMfaAction'

// Owns memory lifetime and negative retirement. Only a current server projection can restore privileges.
export function MfaBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const previous = useRef({ key: location.key, pathname: location.pathname })
  const snapshot = useMfaSnapshot()
  const user = useAuthStore(state => state.user)
  const processedFresh = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (previous.current.key !== location.key || previous.current.pathname !== location.pathname) {
      previous.current = { key: location.key, pathname: location.pathname }
      mfaFlow.navigate(location.pathname)
    }
  }, [location.key, location.pathname])

  useLayoutEffect(() => {
    mfaFlow.expire()
    const expiry = mfaFlow.nextExpiry()

    if (expiry === null) {
      return
    }

    const timer = window.setTimeout(() => flushSync(() => mfaFlow.expire()), Math.max(1, expiry - Date.now()))

    return () => window.clearTimeout(timer)
  }, [snapshot])

  useLayoutEffect(() => {
    if (!user?.assuranceGeneration || !user.assuranceExpiresAt) {
      return
    }

    const general = Date.parse(user.assuranceExpiresAt)
    const fresh = user.freshAssuranceExpiresAt ? Date.parse(user.freshAssuranceExpiresAt) : general
    const key = user.assuranceGeneration + ':' + fresh
    const deadline = processedFresh.current === key ? general : Math.min(general, fresh)
    const retire = () => {
      processedFresh.current = key
      flushSync(() => useAuthStore.getState().retirePrivileged())
      window.dispatchEvent(new CustomEvent('mfa:invalidate-peers'))
      void useAuthStore.getState().revalidateAuthority().catch(() => useAuthStore.getState().suspendAuthority())
    }

    if (deadline <= Date.now()) {
      processedFresh.current = key
      useAuthStore.getState().retirePrivileged()
      void useAuthStore.getState().revalidateAuthority().catch(() => useAuthStore.getState().suspendAuthority())

      return
    }

    const timer = window.setTimeout(retire, deadline - Date.now())

    return () => window.clearTimeout(timer)
  }, [user?.assuranceGeneration, user?.assuranceExpiresAt, user?.freshAssuranceExpiresAt])

  useLayoutEffect(() => {
    const clear = () => flushSync(() => mfaFlow.clear())
    const unavailable = () => {
      flushSync(() => useAuthStore.getState().retirePrivileged())
      void useAuthStore.getState().revalidateAuthority().catch(() => useAuthStore.getState().suspendAuthority())
    }
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('soveris-mfa-invalidation-v1') : null
    const notifyPeers = () => channel?.postMessage({ kind: 'invalidate' })

    if (channel) {
      channel.onmessage = event => {
        const data = event.data

        if (data && typeof data === 'object' && Object.keys(data).length === 1 && data.kind === 'invalidate') {
          unavailable()
        }
      }
    }

    window.addEventListener('pagehide', clear)
    window.addEventListener('mfa:unavailable', unavailable)
    window.addEventListener('mfa:invalidate-peers', notifyPeers)

    return () => {
      window.removeEventListener('pagehide', clear)
      window.removeEventListener('mfa:unavailable', unavailable)
      window.removeEventListener('mfa:invalidate-peers', notifyPeers)
      channel?.close()
    }
  }, [])

  return children
}

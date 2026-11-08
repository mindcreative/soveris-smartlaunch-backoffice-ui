import { useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supportAuthority } from './authority'
import { SUPPORT } from './constants'
import { supportClockNow } from './clock'
import { notifySupportPeers, retireSupport } from './lifetime'
import { useSupportSnapshot } from './useSupportAction'

function supportPath(path: string): boolean {
  return /^\/(?:support(?:\/|$)|platform\/support(?:\/|$)|settings\/support-access(?:\/|$))/.test(path)
}

/** Owns only negative lifetime signals. No peer/browser event can install authority. */
export function SupportBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const previous = useRef({ key: '', path: '' })
  const snapshot = useSupportSnapshot()
  const assuranceExpiry = useAuthStore(state => state.user?.assuranceExpiresAt)
  useLayoutEffect(() => () => supportAuthority.retire(), [])

  useLayoutEffect(() => {
    if (previous.current.key !== location.key && (supportPath(previous.current.path) || supportPath(location.pathname))) {
      retireSupport()
    }

    previous.current = { key: location.key, path: location.pathname }
  }, [location.key, location.pathname])

  useLayoutEffect(() => {
    const clear = () => {
      if (supportPath(previous.current.path)) {
        flushSync(() => retireSupport({ status: 0, message: 'Support data cleared. Verify current access before continuing.', retryAt: 0 }))
      }
    }
    const clearLocal = () => supportAuthority.retire(supportAuthority.snapshot().notice ?? undefined)
    const visibility = () => {
      if (document.visibilityState !== 'visible') {
        clear()
      }
    }
    const storage = (event: StorageEvent) => {
      if (event.key === null || ['backoffice_access_token', 'backoffice_refresh_token', 'backoffice-auth-persist'].includes(event.key)) {
        clear()
      }
    }
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(SUPPORT.peerChannel) : null
    const notify = () => channel?.postMessage({ kind: 'retire' })

    if (channel) {
      channel.onmessage = event => {
        const value = event.data

        if (value && typeof value === 'object' && Object.keys(value).length === 1 && value.kind === 'retire') {
          clear()
        }
      }
    }

    window.addEventListener('auth:retired', clearLocal)
    window.addEventListener('auth:privileged-retired', clearLocal)
    window.addEventListener('pagehide', clear)
    window.addEventListener('pageshow', clear)
    window.addEventListener('popstate', clear)
    window.addEventListener('blur', clear)
    window.addEventListener('focus', clear)
    window.addEventListener('storage', storage)
    window.addEventListener(SUPPORT.peerEvent, notify)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('auth:retired', clearLocal)
      window.removeEventListener('auth:privileged-retired', clearLocal)
      window.removeEventListener('pagehide', clear)
      window.removeEventListener('pageshow', clear)
      window.removeEventListener('popstate', clear)
      window.removeEventListener('blur', clear)
      window.removeEventListener('focus', clear)
      window.removeEventListener('storage', storage)
      window.removeEventListener(SUPPORT.peerEvent, notify)
      document.removeEventListener('visibilitychange', visibility)
      channel?.close()
    }
  }, [])

  useLayoutEffect(() => {
    if (!snapshot.context) {
      return
    }

    const expiry = Math.min(Date.parse(snapshot.context.expiresAt), assuranceExpiry ? Date.parse(assuranceExpiry) : 0)
    const remaining = expiry - supportClockNow(snapshot.context.clock)
    const clear = () => {
      const expired = supportClockNow(snapshot.context!.clock) >= Date.parse(snapshot.context!.expiresAt)
      retireSupport({ status: expired ? 0 : 403, code: expired ? 'support_expired' : 'mfa_expired', message: expired
        ? 'Support access ended — Expired. Private content removed; your original login is unchanged.'
        : 'Verify your authenticator to continue, then verify support context.', retryAt: 0 })
      notifySupportPeers()
    }

    if (remaining <= 0) {
      clear()
      return
    }

    const timer = window.setTimeout(() => flushSync(clear), remaining)
    return () => window.clearTimeout(timer)
  }, [snapshot.context, assuranceExpiry])

  return children
}

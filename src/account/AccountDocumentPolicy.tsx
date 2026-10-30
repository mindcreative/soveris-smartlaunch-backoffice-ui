import { flushSync } from 'react-dom'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const SEALED_POLICY_ID = 'account-document-frame-policy'

function sealDocument(): void {
  if (document.getElementById(SEALED_POLICY_ID)) {
    return
  }

  const policy = document.createElement('meta')
  policy.id = SEALED_POLICY_ID
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "frame-src 'none'"
  document.head.append(policy)
}

export function AccountDocumentPolicy({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const initialSignup = useRef(window.location.pathname === '/signup' && !window.location.search && !window.location.hash)
  const sealed = useRef(!initialSignup.current || !!document.getElementById(SEALED_POLICY_ID))
  const [readyPath, setReadyPath] = useState<string | null>(null)
  const signup = /^\/signup\/*$/i.test(location.pathname)

  useLayoutEffect(() => {
    if (signup && (sealed.current || location.pathname !== '/signup')) {
      window.location.replace('/signup')

      return
    }

    if (!signup) {
      sealDocument()
      sealed.current = true
    }

    setReadyPath(location.pathname)
  }, [location.pathname, signup])

  useLayoutEffect(() => {
    const retire = () => {
      flushSync(() => setReadyPath(null))
      sealDocument()
      sealed.current = true
    }
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted && /^\/signup\/*$/i.test(window.location.pathname)) {
        window.location.reload()
      } else if (event.persisted) {
        sealDocument()
        setReadyPath(window.location.pathname)
      }
    }
    window.addEventListener('pagehide', retire)
    window.addEventListener('pageshow', restore)

    return () => {
      window.removeEventListener('pagehide', retire)
      window.removeEventListener('pageshow', restore)
    }
  }, [])

  // Unmount the old route before sealing. New proof/login content can render
  // only after the permanent restrictive policy has been installed.
  return readyPath === location.pathname && !(signup && sealed.current) ? children : null
}

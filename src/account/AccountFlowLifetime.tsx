import { useEffect, useRef } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { accountFlow } from './accountFlow'

export function AccountFlowLifetime() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)

  useEffect(() => {
    const from = previous.current
    previous.current = pathname

    if (from === pathname) {
      return
    }

    const pendingContinuation = Boolean(matchPath('/signup', from) && matchPath('/check-email', pathname))

    accountFlow.leavePage(pendingContinuation)
  }, [pathname])

  return null
}

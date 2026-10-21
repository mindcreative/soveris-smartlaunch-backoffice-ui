import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { experienceRoute } from '../../auth/experience'
import { ExperienceContext } from '../../auth/ExperienceContext'
import { bindExperienceScope } from '../../auth/experienceScope'
import { queryClient } from '../../queryClient'
import { Navigate } from 'react-router-dom'
import { Forbidden } from '../shared/ErrorDisplay'
import { LoadingSpinner } from '../shared/LoadingSpinner'

export function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isLoading, isInitialized, user } = useAuth()
  const unavailable = useAuthStore(s => s.authorityUnavailable)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const unavailableHeading = useRef<HTMLHeadingElement>(null)
  const route = experienceRoute(location.pathname, user)
  const identity = JSON.stringify([route.audience,route.target,user?.id,user?.clientId,user?.sessionId,user?.securityRevision,user?.permissions,user?.platformPermissions])
  const principal = JSON.stringify([user?.id,user?.clientId,user?.sessionId,user?.securityRevision,user?.permissions,user?.platformPermissions])
  const previousPrincipal = useRef<string | null>(null)
  const [bound, setBound] = useState<string | null>(null)
  useLayoutEffect(() => {
    // The auth store owns identity/session epochs. An audience/target change
    // within that identity needs its own retirement without interrupting restore.
    bindExperienceScope(identity,queryClient,previousPrincipal.current===principal && isAuthenticated && !isLoading)
    previousPrincipal.current=principal
    setBound(identity)
  }, [identity,principal,isAuthenticated,isLoading])
  useEffect(() => { if(unavailable) unavailableHeading.current?.focus() }, [unavailable])

  useEffect(() => {
    if (isInitialized && !isLoading && !isAuthenticated && !unavailable) {
      const from = `${location.pathname}${location.search}${location.hash}`
      navigate('/login', { replace: true, state: { from } })
    }
  }, [isAuthenticated, isInitialized, isLoading, location.hash, location.pathname, location.search, navigate,unavailable])

  useEffect(() => {
    if (!mobileNavigationOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavigationOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [mobileNavigationOpen])

  if (isLoading || !isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <LoadingSpinner size="lg" message="Restoring your session…" />
      </div>
    )
  }

  if(unavailable) return <main role="alert" className="p-6"><h1 ref={unavailableHeading} tabIndex={-1}>Current access unavailable</h1><p>Private data has been cleared. Retry to verify your session.</p><button onClick={() => { useAuthStore.setState({isInitialized:false});void useAuthStore.getState().initialize() }}>Verify access</button></main>
  if (!isAuthenticated) return null
  const denied = !route.allowed
  if (route.allowed && route.redirect) return <Navigate to={route.redirect + location.search + location.hash} replace />

  return (
    <ExperienceContext.Provider value={route.audience}><div className="min-h-screen min-w-0 bg-app">
      <Sidebar />

      {mobileNavigationOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="absolute inset-0 h-full w-full bg-overlay/40"
            onClick={() => {
              setMobileNavigationOpen(false)
              menuButtonRef.current?.focus()
            }}
          />
          <Sidebar
            mobile
            onClose={() => {
              setMobileNavigationOpen(false)
              menuButtonRef.current?.focus()
            }}
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </div>
      )}

      <div className="min-w-0 lg:pl-64">
        <TopBar
          menuButtonRef={menuButtonRef}
          onOpenMobileNavigation={() => setMobileNavigationOpen(true)}
        />
        <main id="main-content" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {denied ? <Forbidden message="Your current session does not permit this operation." /> : <>{bound === identity ? <Outlet key={identity} /> : <LoadingSpinner message="Verifying view context…" />}</>}
        </main>
      </div>
    </div></ExperienceContext.Provider>
  )
}

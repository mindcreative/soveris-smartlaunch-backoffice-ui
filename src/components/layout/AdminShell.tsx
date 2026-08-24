import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useAuth } from '../../hooks/useAuth'
import { LoadingSpinner } from '../shared/LoadingSpinner'

export function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isLoading, isInitialized } = useAuth()
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isInitialized && !isLoading && !isAuthenticated) {
      const from = `${location.pathname}${location.search}${location.hash}`
      navigate('/login', { replace: true, state: { from } })
    }
  }, [isAuthenticated, isInitialized, isLoading, location.hash, location.pathname, location.search, navigate])

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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" message="Restoring your session…" />
      </div>
    )
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen min-w-0 bg-gray-50">
      <Sidebar />

      {mobileNavigationOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="absolute inset-0 h-full w-full bg-gray-950/40"
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}

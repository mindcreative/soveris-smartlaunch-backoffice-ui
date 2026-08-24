import type { RefObject } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface TopBarProps {
  onOpenMobileNavigation: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
}

export function TopBar({ onOpenMobileNavigation, menuButtonRef }: TopBarProps) {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-16 min-w-0 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onOpenMobileNavigation}
            aria-label="Open navigation"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 lg:hidden"
          >
            <span aria-hidden="true" className="text-xl">☰</span>
          </button>
          <span className="truncate text-base font-semibold text-gray-900 sm:text-lg">
            Soveris Back-Office
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          {user && (
            <div className="hidden min-w-0 items-center gap-3 sm:flex">
              <div className="min-w-0 text-right">
                <p className="truncate text-sm font-medium text-gray-900">{user.displayName}</p>
                <p className="hidden truncate text-xs text-gray-500 md:block">{user.email}</p>
              </div>
              <div aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                user.role === 'Admin' ? 'bg-indigo-100 text-indigo-700' :
                user.role === 'Editor' ? 'bg-green-100 text-green-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {user.displayName.charAt(0)}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-11 rounded-md px-3 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}

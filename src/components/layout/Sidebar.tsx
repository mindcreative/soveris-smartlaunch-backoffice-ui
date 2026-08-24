import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'

const baseNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: 'home' },
  { name: 'Submissions', href: '/submissions', icon: 'inbox' },
  { name: 'Analytics', href: '/analytics', icon: 'chart' },
  { name: 'Content', href: '/content', icon: 'edit' },
  { name: 'Themes', href: '/themes', icon: 'palette' },
  { name: 'AI Tools', href: '/ai', icon: 'sparkle' },
  { name: 'Users', href: '/users', icon: 'users' },
  { name: 'Audit Logs', href: '/audit', icon: 'shield' },
]

const iconMap: Record<string, string> = {
  home: '🏠',
  inbox: '📬',
  chart: '📊',
  edit: '✏️',
  palette: '🎨',
  sparkle: '✨',
  users: '👥',
  shield: '🛡️',
  billing: '◎',
}

interface SidebarProps {
  mobile?: boolean
  onClose?: () => void
  onNavigate?: () => void
}

export function Sidebar({ mobile = false, onClose, onNavigate }: SidebarProps) {
  const location = useLocation()
  const { hasPermission, user } = useAuth()
  const defaultClientId = canonicalizeGuid(user?.clientId)
  const navigation = defaultClientId && hasPermission('billing:view')
    ? [
        ...baseNavigation.slice(0, 1),
        {
          name: 'Billing',
          href: `/billing/clients/${defaultClientId}/account`,
          icon: 'billing',
        },
        ...baseNavigation.slice(1),
      ]
    : baseNavigation

  const filteredNav = navigation.filter((item) => {
    switch (item.name) {
      case 'Users':
        return hasPermission('users:view')
      case 'Audit Logs':
        return hasPermission('audit:view')
      case 'AI Tools':
        return hasPermission('ai:view')
      default:
        return true
    }
  })

  return (
    <aside
      aria-label={mobile ? 'Mobile navigation' : 'Primary navigation'}
      className={mobile
        ? 'fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col bg-white shadow-xl lg:hidden'
        : 'hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col'}
    >
      <div className="flex flex-grow flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4 sm:px-6">
          <div className="flex min-w-0 items-center">
            <span className="text-lg font-semibold text-gray-900">Soveris</span>
            <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Back-Office
            </span>
          </div>
          {mobile && (
            <button
              type="button"
              autoFocus
              onClick={onClose}
              aria-label="Close navigation"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>

        <nav aria-label="Back-Office" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {filteredNav.map((item) => {
            const activePrefix = item.name === 'Billing' ? '/billing' : item.href
            const isActive = location.pathname.startsWith(activePrefix)
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span aria-hidden="true" className="mr-3 text-lg">{iconMap[item.icon]}</span>
                {item.name}
              </Link>
            )
          })}
        </nav>

        {user && (
          <div className="border-t border-gray-200 p-4">
            <p className="text-xs text-gray-500">Logged in as</p>
            <p className="truncate text-sm font-medium text-gray-900">
              {user.displayName || user.email || 'User'}
            </p>
            <p className="text-xs capitalize text-gray-500">{user.role}</p>
          </div>
        )}
      </div>
    </aside>
  )
}

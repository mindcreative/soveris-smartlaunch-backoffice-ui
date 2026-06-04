import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const navigation = [
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
}

export function Sidebar() {
  const location = useLocation()
  const { hasPermission, user } = useAuth()

  // Filter navigation based on permissions
  const filteredNav = navigation.filter(item => {
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
    <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="flex flex-col border-r border-gray-200 bg-white flex-grow">
        {/* Logo */}
        <div className="flex h-16 items-center px-6 border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-900">Soveris</h1>
          <span className="ml-2 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            Back-Office
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {filteredNav.map((item) => {
            const isActive = location.pathname.startsWith(item.href)
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="mr-3 text-lg">{iconMap[item.icon]}</span>
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* Client info at bottom */}
        {user && (
          <div className="border-t border-gray-200 p-4">
            <p className="text-xs text-gray-500">Client</p>
            <p className="text-sm font-medium text-gray-900 truncate">{user.clientId}</p>
          </div>
        )}
      </div>
    </div>
  )
}
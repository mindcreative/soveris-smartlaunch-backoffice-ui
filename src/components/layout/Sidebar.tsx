import { LayoutDashboard, Inbox, ChartNoAxesCombined, Package, Globe, Sparkles, Users, ClipboardClock, ReceiptText, X, type LucideIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'
import { permittedLanding, platformAvailable, platformViews, workspaceDestinations } from '../../auth/experience'
import { useExperience } from '../../auth/ExperienceContext'

const baseNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: 'home' },
  { name: 'Submissions', href: '/submissions', icon: 'inbox' },
  { name: 'Analytics', href: '/analytics', icon: 'chart' },
  { name: 'Products', href: '/products', icon: 'edit' },
  { name: 'Domains', href: '/domains', icon: 'domains' },
  { name: 'AI Tools', href: '/ai', icon: 'sparkle' },
  { name: 'Users', href: '/users', icon: 'users' },
  { name: 'Audit Logs', href: '/audit', icon: 'shield' },
]

const iconMap: Record<string, LucideIcon> = {
  home: LayoutDashboard, inbox: Inbox, chart: ChartNoAxesCombined, edit: Package,
  sparkle: Sparkles, users: Users, shield: ClipboardClock, billing: ReceiptText, domains: Globe,
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
  const audience = useExperience()
  const navigation = audience === 'platform'
    ? [
      ...(platformAvailable(user) ? [{ name: 'Platform operations', href: '/platform', icon: 'shield' }] : []),
      ...(hasPermission(platformViews.health) ? [{ name: 'System Health', href: '/platform/health', icon: 'home' }] : []),
      { name: 'My workspace', href: permittedLanding({ ...user!, platformPermissions: [] }), icon: 'home' },
    ]
    : [
      ...baseNavigation.filter(item => {
        const destination = workspaceDestinations.find(([path]) => item.href === `/${path}`)
        return !!destination && hasPermission(destination[2])
      }),
      ...(defaultClientId && hasPermission('billing:view') ? [{name:'Billing', href:`/billing/clients/${defaultClientId}/account`, icon:'billing'}] : []),
      ...(platformAvailable(user) ? [{name:'Platform operations', href:'/platform', icon:'shield'}] : []),
    ]
  const filteredNav = navigation

  return (
    <aside
      aria-label={mobile ? 'Mobile navigation' : 'Primary navigation'}
      className={mobile
        ? 'fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col bg-surface shadow-xl lg:hidden'
        : 'hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col'}
    >
      <div className="flex flex-grow flex-col border-r border-line bg-surface">
        <div className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-6">
          <Link to={audience === 'platform' && platformAvailable(user) ? '/platform' : permittedLanding(user)} onClick={onNavigate} aria-label={audience === 'platform' ? 'Soveris SmartLaunch platform operations' : permittedLanding(user) === '/dashboard' ? 'Soveris SmartLaunch Dashboard' : 'Soveris SmartLaunch workspace'} className="flex min-h-11 min-w-0 items-center rounded focus-visible:ring-2 focus-visible:ring-focus">
            <img src="/soveris-light.svg" alt="" className="brand-light h-auto w-28 shrink-0" />
            <img src="/soveris-dark.svg" alt="" className="brand-dark h-auto w-28 shrink-0" />
            <span className="ml-2 text-xs font-medium text-muted">
              SmartLaunch
            </span>
          </Link>
          {mobile && (
            <button
              type="button"
              autoFocus
              onClick={onClose}
              aria-label="Close navigation"
              title="Close navigation"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl text-foreground hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X aria-hidden="true" size={20} />
            </button>
          )}
        </div>

        <nav aria-label="SmartLaunch" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {filteredNav.map((item) => {
            const Icon = iconMap[item.icon]
            const activePrefix = item.name === 'Billing' ? '/billing' : item.href
            const isActive = item.href === '/platform' ? location.pathname === item.href : location.pathname.startsWith(activePrefix)
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-selected text-primary'
                    : 'text-foreground hover:bg-subtle hover:text-foreground'
                }`}
              >
                <Icon aria-hidden="true" size={20} className="mr-3 shrink-0" />
                {item.name}
              </Link>
            )
          })}
        </nav>

      </div>
    </aside>
  )
}

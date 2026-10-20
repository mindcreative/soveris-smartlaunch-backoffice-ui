/** Application name */
export const APP_NAME = 'Soveris Back-Office'

/** Application version */
export const APP_VERSION = '1.0.0'

/** Default page size for pagination */
export const DEFAULT_PAGE_SIZE = 10

/** Maximum page size for pagination */
export const MAX_PAGE_SIZE = 100

/** API response timeout in milliseconds */
export const API_TIMEOUT = 30000

/** Sidebar navigation items */
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'submissions', label: 'Submissions', path: '/submissions' },
  { key: 'analytics', label: 'Analytics', path: '/analytics' },
  { key: 'products', label: 'Products', path: '/products' },
  { key: 'images', label: 'Images', path: '/images' },
  { key: 'ai', label: 'AI Tools', path: '/ai' },
  { key: 'users', label: 'Users', path: '/users' },
  { key: 'audit', label: 'Audit Logs', path: '/audit' }
] as const

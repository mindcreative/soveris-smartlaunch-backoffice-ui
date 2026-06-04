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

/** Role names */
export const ROLES = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer'
} as const

/** Role permissions */
export const ROLE_PERMISSIONS = {
  Admin: ['*'],
  Editor: [
    'submissions:view',
    'submissions:delete',
    'submissions:export',
    'analytics:view',
    'content:view',
    'content:update'
  ],
  Viewer: [
    'submissions:view',
    'analytics:view',
    'content:view'
  ]
} as const

/** Sidebar navigation items */
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'submissions', label: 'Submissions', path: '/submissions' },
  { key: 'analytics', label: 'Analytics', path: '/analytics' },
  { key: 'content', label: 'Content', path: '/content' },
  { key: 'images', label: 'Images', path: '/images' },
  { key: 'themes', label: 'Themes', path: '/themes' },
  { key: 'ai', label: 'AI Tools', path: '/ai' },
  { key: 'users', label: 'Users', path: '/users' },
  { key: 'audit', label: 'Audit Logs', path: '/audit' }
] as const
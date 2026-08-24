import type { UserRole } from '../types/auth'

export const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
  Admin: [
    'dashboard:view',
    'users:view', 'users:create', 'users:edit', 'users:delete',
    'content:view', 'content:create', 'content:edit', 'content:delete',
    'submissions:view', 'submissions:edit', 'submissions:delete',
    'submissions:approve', 'submissions:reject',
    'analytics:view', 'audit:view',
    'ai:view', 'ai:use',
    'settings:view', 'settings:edit',
    'themes:view', 'themes:edit',
    'theme:view', 'theme:edit',
    'clients:view', 'clients:create', 'clients:edit', 'clients:delete',
    'billing:view',
  ],
  Editor: [
    'dashboard:view',
    'content:view', 'content:create', 'content:edit', 'content:delete',
    'submissions:view', 'submissions:edit',
    'submissions:approve', 'submissions:reject',
    'analytics:view',
    'ai:view', 'ai:use',
  ],
  Viewer: [
    'dashboard:view',
    'content:view',
    'submissions:view',
    'analytics:view',
    'audit:view',
    'ai:view',
    'settings:view',
    'themes:view',
  ],
}

export function hasRolePermission(role: UserRole | undefined, permission: string): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false
}

export function hasAnyRolePermission(
  role: UserRole | undefined,
  permissions: readonly string[]
): boolean {
  return permissions.some((permission) => hasRolePermission(role, permission))
}

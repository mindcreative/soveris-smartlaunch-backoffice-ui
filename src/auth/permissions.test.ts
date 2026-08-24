import { describe, expect, it } from 'vitest'
import { hasRolePermission, ROLE_PERMISSIONS } from './permissions'

describe('role permissions', () => {
  it('maps billing:view only to the actual Admin role', () => {
    expect(hasRolePermission('Admin', 'billing:view')).toBe(true)
    expect(hasRolePermission('Editor', 'billing:view')).toBe(false)
    expect(hasRolePermission('Viewer', 'billing:view')).toBe(false)
  })

  it('preserves permissions that existed in either former matrix', () => {
    expect(ROLE_PERMISSIONS.Admin).toEqual(
      expect.arrayContaining(['dashboard:view', 'themes:view', 'theme:view', 'clients:view'])
    )
    expect(ROLE_PERMISSIONS.Editor).toEqual(
      expect.arrayContaining(['submissions:approve', 'submissions:edit', 'ai:view'])
    )
    expect(ROLE_PERMISSIONS.Viewer).toEqual(
      expect.arrayContaining(['audit:view', 'settings:view', 'themes:view'])
    )
  })
})

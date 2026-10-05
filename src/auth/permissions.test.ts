import { describe, expect, it } from 'vitest'
import { hasRolePermission, ROLE_PERMISSIONS } from './permissions'

describe('role permissions', () => {
  it('maps delivered reconciliation permission only to Admin', () => {
    expect(hasRolePermission('Admin', 'billing:reconcile')).toBe(true)
    expect(hasRolePermission('Editor', 'billing:reconcile')).toBe(false)
    expect(hasRolePermission('Viewer', 'billing:reconcile')).toBe(false)
  })
  it('maps Billing view, subscription, and exact adjustment permissions only to Admin', () => {
    expect(hasRolePermission('Admin', 'billing:view')).toBe(true)
    expect(hasRolePermission('Admin', 'billing:subscription')).toBe(true)
    expect(hasRolePermission('Admin', 'billing:adjust')).toBe(true)
    expect(hasRolePermission('Editor', 'billing:view')).toBe(false)
    expect(hasRolePermission('Editor', 'billing:subscription')).toBe(false)
    expect(hasRolePermission('Editor', 'billing:adjust')).toBe(false)
    expect(hasRolePermission('Viewer', 'billing:view')).toBe(false)
    expect(hasRolePermission('Viewer', 'billing:subscription')).toBe(false)
    expect(hasRolePermission('Viewer', 'billing:adjust')).toBe(false)
    expect(hasRolePermission('Admin', 'billing:*')).toBe(false)
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

  it('uses the canonical product permission vocabulary for content and images', () => {
    expect(ROLE_PERMISSIONS.Admin).toEqual(expect.arrayContaining(['products:view', 'products:create', 'products:update']))
    expect(ROLE_PERMISSIONS.Editor).toEqual(expect.arrayContaining(['products:view', 'products:create', 'products:update']))
    expect(ROLE_PERMISSIONS.Viewer).toContain('products:view')
    expect(Object.values(ROLE_PERMISSIONS).flat()).not.toEqual(
      expect.arrayContaining(['content:view', 'content:edit', 'content:update'])
    )
  })

  it('authorizes AI creation and lookup with delivered tokens only', () => {
    for (const role of ['Admin', 'Editor'] as const) {
      expect(ROLE_PERMISSIONS[role]).toEqual(expect.arrayContaining(['ai:create', 'ai:view']))
    }
    expect(ROLE_PERMISSIONS.Viewer).not.toContain('ai:create')
    expect(ROLE_PERMISSIONS.Viewer).not.toContain('ai:view')
    expect(Object.values(ROLE_PERMISSIONS).flat()).not.toContain('ai:use')
  })
})

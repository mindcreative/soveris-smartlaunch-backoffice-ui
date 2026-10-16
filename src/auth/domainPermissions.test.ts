import { expect, it } from 'vitest'
import { hasRolePermission } from './permissions'
it('maps Domains view/actions separately and preserves Product selection authority', () => {
  for (const role of ['Admin', 'Editor', 'Viewer'] as const) expect(hasRolePermission(role, 'domains:view')).toBe(true)
  for (const action of ['create', 'verify', 'update']) {
    expect(hasRolePermission('Editor', `domains:${action}`)).toBe(true)
    expect(hasRolePermission('Viewer', `domains:${action}`)).toBe(false)
  }
  expect(hasRolePermission('Admin', 'domains:delete')).toBe(true)
  expect(hasRolePermission('Editor', 'domains:delete')).toBe(false)
})

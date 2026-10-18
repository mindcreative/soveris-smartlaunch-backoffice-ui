import { expect, it } from 'vitest'
import { hasRolePermission } from './permissions'
it('permits permanent product removal only for Admin',()=>{
 expect(hasRolePermission('Admin','products:delete')).toBe(true)
 expect(hasRolePermission('Editor','products:delete')).toBe(false)
 expect(hasRolePermission('Viewer','products:delete')).toBe(false)
})

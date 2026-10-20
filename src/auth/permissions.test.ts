import { describe,expect,it } from 'vitest'
import { hasPermission,hasAnyPermission } from './permissions'
describe('server projected permissions',()=>{
 it('display roles cannot supply permissions',()=>{
  for(const role of ['Admin','ClientOwner','ClientAdmin','Editor','Viewer']) expect(hasPermission({role} as never,'products:delete')).toBe(false)
 })
 it('requires exact permissions and never expands wildcards',()=>{
  const user={permissions:['products:delete','billing:view','*','billing:*'],platformPermissions:[]}
  expect(hasPermission(user,'products:delete')).toBe(true);expect(hasPermission(user,'billing:export')).toBe(false)
  expect(hasPermission(user,'billing:*')).toBe(false);expect(hasPermission(user,'platform:billing:adjust')).toBe(false)
 })
 it('takes separate explicit platform projections without deriving grants from client rights',()=>{
  const user={permissions:['billing:view'],platformPermissions:['platform:billing:adjust']}
  expect(hasPermission(user,'platform:billing:adjust')).toBe(true);expect(hasPermission(user,'platform:billing:reconcile')).toBe(false)
  expect(hasAnyPermission(user,['ai:create','billing:view'])).toBe(true)
 })
})

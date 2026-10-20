import { expect,it } from 'vitest'
import { hasPermission } from './permissions'
it('product removal requires the exact delivered client permission',()=>{
 expect(hasPermission({permissions:['products:delete']},'products:delete')).toBe(true)
 expect(hasPermission({permissions:['products:update'],platformPermissions:['platform:clients:status']},'products:delete')).toBe(false)
})

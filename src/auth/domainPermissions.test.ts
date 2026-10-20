import { expect,it } from 'vitest'
import { hasPermission } from './permissions'
it('requires an exact current domain grant for each operation',()=>{
 const user={permissions:['domains:view','domains:create'],platformPermissions:['platform:clients:view']}
 expect(hasPermission(user,'domains:view')).toBe(true);expect(hasPermission(user,'domains:create')).toBe(true)
 for(const op of ['verify','update','delete']) expect(hasPermission(user,`domains:${op}`)).toBe(false)
})

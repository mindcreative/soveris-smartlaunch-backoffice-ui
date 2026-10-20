import { describe,expect,it,vi } from 'vitest'
import { parseCurrentAuthority } from './currentAuthority'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { currentAuthorityEpoch,privateObjectUrl,retireAuthority } from './authorityEpoch'
describe('current session projection',()=>{
 it('accepts the original session/revision and finite own permissions',()=>{
  const value=currentAuthorityFixture();expect(parseCurrentAuthority(value)).toMatchObject({sessionId:value.sessionId,securityRevision:'1',permissions:value.permissions})
 })
 it.each([{sessionId:undefined},{clientRoleId:undefined},{securityRevision:'0'},{permissions:['*']},{permissions:['billing:adjust']},{platformPermissions:['platform:content:view']},{role:'Admin'}])('rejects legacy or malformed authority %j',change=>{
  expect(()=>parseCurrentAuthority({...currentAuthorityFixture(),...change})).toThrow()
 })
 it('preserves existing nonempty Client UUID identities without requiring session UUID version on them',()=>{
  expect(parseCurrentAuthority(currentAuthorityFixture({clientId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'})).clientId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
 })
 it('retires every private object URL synchronously at a session boundary',()=>{
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:private-authority');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const before=currentAuthorityEpoch();privateObjectUrl(new Blob(['private']));retireAuthority();expect(currentAuthorityEpoch()).toBe(before+1);expect(revoke).toHaveBeenCalledWith('blob:private-authority');create.mockRestore();revoke.mockRestore()
 })
})

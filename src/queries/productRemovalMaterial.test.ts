import {beforeEach,expect,it,vi} from 'vitest'
import {useAuthStore} from '../stores/authStore'
import {clearRemovalMaterial,readRemovalMaterial,rememberRemovalMaterial} from './productRemovalMaterial'
import {client,product} from '../test/fixtures/productRemoval'
const user={id:'01990000-0000-7000-8000-000000000005',clientId:client,role:'Admin' as const,email:'admin@example.test',displayName:'Admin',accessToken:'token',refreshToken:'refresh',expiresIn:3600}
const command={operationId:'01990000-0000-7000-8000-000000000006',expectedRevision:'9223372036854775807',policyVersion:'product-removal-v1' as const,previewFingerprint:'a'.repeat(64)}
beforeEach(()=>{vi.restoreAllMocks();clearRemovalMaterial();sessionStorage.clear();useAuthStore.setState({user,accessToken:'token',isAuthenticated:true})})
it('retains exact material when persisted authentication initializes after a reload',()=>{
 useAuthStore.setState({isAuthenticated:false});rememberRemovalMaterial(client,product,command)
 useAuthStore.setState({isAuthenticated:true});expect(readRemovalMaterial(client,product,command.operationId)).toEqual(command)
})
it.each(['client','actor','role','token','logout','refresh'] as const)('purges exact material on %s authority change',change=>{
 rememberRemovalMaterial(client,product,command);expect(readRemovalMaterial(client,product,command.operationId)).toEqual(command)
 if(change==='client')useAuthStore.setState({user:{...user,clientId:product}})
 if(change==='actor')useAuthStore.setState({user:{...user,id:product}})
 if(change==='role')useAuthStore.setState({user:{...user,role:'Viewer'}})
 if(change==='token')useAuthStore.setState({accessToken:'new-token'})
 if(change==='logout')useAuthStore.setState({user:null,accessToken:null,isAuthenticated:false})
 if(change==='refresh')window.dispatchEvent(new Event('auth:refreshed'))
 expect(Object.keys(sessionStorage).filter(k=>k.startsWith('backoffice:product-removal:'))).toEqual([])
})
it('stores only scoped minimal command material, rejects corrupt counters and never stores tokens',()=>{
 rememberRemovalMaterial(client,product,command);const key=Object.keys(sessionStorage)[0]!,stored=sessionStorage.getItem(key)!
 expect(stored).not.toContain('token');expect(stored).not.toContain('refresh');expect(JSON.parse(stored).command).toEqual(command)
 sessionStorage.setItem(key,stored.replace('9223372036854775807','9223372036854775808'));expect(readRemovalMaterial(client,product,command.operationId)).toBeNull()
})

it.each(['client','actor','role','token','logout','refresh','authentication-loss'] as const)('purges in-memory fallback on %s when session storage is unavailable', change => {
 const originalSet = Storage.prototype.setItem
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
  if (this === sessionStorage) throw new Error('Storage disabled')
  originalSet.call(this, key, value)
 })
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => { throw new Error('Storage disabled') })
 rememberRemovalMaterial(client,product,command)
 expect(readRemovalMaterial(client,product,command.operationId)).toEqual(command)
 if(change==='client')useAuthStore.setState({user:{...user,clientId:product}})
 if(change==='actor')useAuthStore.setState({user:{...user,id:product}})
 if(change==='role')useAuthStore.setState({user:{...user,role:'Viewer'}})
 if(change==='token')useAuthStore.setState({accessToken:'new-token'})
 if(change==='logout')useAuthStore.setState({user:null,accessToken:null,isAuthenticated:false})
 if(change==='refresh')window.dispatchEvent(new Event('auth:refreshed'))
 if(change==='authentication-loss')useAuthStore.setState({isAuthenticated:false})
 expect(readRemovalMaterial(client,product,command.operationId)).toBeNull()
})

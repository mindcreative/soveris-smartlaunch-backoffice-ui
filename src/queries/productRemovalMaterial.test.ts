import { viewerFixturePermissions } from '../test/authorityFixtures'
import { clientFixturePermissions } from '../test/authorityFixtures'
import {beforeEach,expect,it,vi} from 'vitest'
import {useAuthStore} from '../stores/authStore'
import {clearRemovalMaterial,readRemovalMaterial,rememberRemovalMaterial} from './productRemovalMaterial'
import {client,product} from '../test/fixtures/productRemoval'
const user={id:'01990000-0000-7000-8000-000000000005',clientId:client,role:'ClientAdmin' as const, permissions: clientFixturePermissions, sessionId: '01990000-0000-7000-8000-000000000077',clientRoleId:'01990000-0000-7000-8000-000000000078',securityRevision:'1',email:'admin@example.test',displayName:'ClientAdmin',accessToken:'token',refreshToken:'refresh',expiresIn:3600}
const command={operationId:'01990000-0000-7000-8000-000000000006',expectedRevision:'9223372036854775807',policyVersion:'product-removal-v1' as const,previewFingerprint:'a'.repeat(64)}
beforeEach(()=>{vi.restoreAllMocks();clearRemovalMaterial();sessionStorage.clear();useAuthStore.setState({user,accessToken:'token',isAuthenticated:true,isInitialized:true,isLoading:false})})
it('preserves only an original-session command after server verification during reload',()=>{
 rememberRemovalMaterial(client,product,command)
 useAuthStore.setState({isInitialized:false,isLoading:true,user:null,isAuthenticated:false})
 expect(readRemovalMaterial(client,product,command.operationId)).toBeNull()
 expect(Object.keys(sessionStorage).filter(k=>k.startsWith('backoffice:product-removal:'))).toHaveLength(1)
 useAuthStore.setState({user,isAuthenticated:true,isInitialized:true,isLoading:false})
 expect(readRemovalMaterial(client,product,command.operationId)).toEqual(command)
})
it.each(['session','revision','clientRole'] as const)('a new %s never revives an old command',change=>{
 rememberRemovalMaterial(client,product,command)
 const changed={...user,...(change==='session'?{sessionId:command.operationId}:change==='revision'?{securityRevision:'2'}:{clientRoleId:command.operationId})}
 useAuthStore.setState({user:changed})
 expect(readRemovalMaterial(client,product,command.operationId)).toBeNull()
 expect(Object.keys(sessionStorage).filter(k=>k.startsWith('backoffice:product-removal:'))).toHaveLength(0)
})
it.each(['client','actor','role','token','logout','refresh'] as const)('purges exact material on %s authority change',change=>{
 rememberRemovalMaterial(client,product,command);expect(readRemovalMaterial(client,product,command.operationId)).toEqual(command)
 if(change==='client')useAuthStore.setState({user:{...user,clientId:product}})
 if(change==='actor')useAuthStore.setState({user:{...user,id:product}})
 if(change==='role')useAuthStore.setState({user:{...user,role:'Viewer', permissions: viewerFixturePermissions}})
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
 if(change==='role')useAuthStore.setState({user:{...user,role:'Viewer', permissions: viewerFixturePermissions}})
 if(change==='token')useAuthStore.setState({accessToken:'new-token'})
 if(change==='logout')useAuthStore.setState({user:null,accessToken:null,isAuthenticated:false})
 if(change==='refresh')window.dispatchEvent(new Event('auth:refreshed'))
 if(change==='authentication-loss')useAuthStore.setState({isAuthenticated:false})
 expect(readRemovalMaterial(client,product,command.operationId)).toBeNull()
})

import { beforeEach,expect,it,vi } from 'vitest'
import type { AxiosInstance,InternalAxiosRequestConfig } from 'axios'
import { ApiClient } from './apiClient'
import { bindAuthorityToken, retireAuthority } from '../auth/authorityEpoch'
let client:ApiClient,transport:AxiosInstance
beforeEach(()=>{localStorage.setItem('backoffice_access_token','current-token');bindAuthorityToken('current-token');client=new ApiClient();transport=(client as unknown as {client:AxiosInstance}).client})
it('blocks a replacement token before a queued storage event can reach the old user',async()=>{
 const sent=vi.fn();transport.defaults.adapter=async config=>{sent();return {data:{},status:200,statusText:'OK',headers:{},config}}
 const changed=vi.fn();window.addEventListener('auth:storage-changed',changed)
 try {
  localStorage.setItem('backoffice_access_token','replacement-token')
  await expect(client.post('/users',{displayName:'private'})).rejects.toMatchObject({code:'AUTHORITY_CHANGED'})
  expect(sent).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledTimes(1)
 } finally {window.removeEventListener('auth:storage-changed',changed)}
})
it('rejects late binary data after shared storage changes even before its event is delivered',async()=>{
 let finish!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve})
 transport.defaults.adapter=config=>new Promise(resolve=>{finish=()=>resolve({data:new Blob(['private']),status:200,statusText:'OK',headers:{},config});started()})
 const request=client.get('/exports/artifact',{responseType:'blob'});await entered
 localStorage.removeItem('backoffice_access_token');finish()
 await expect(request).rejects.toMatchObject({code:'AUTHORITY_CHANGED'})
})
it('rejects a late private success after logout even when the transport ignores cancellation',async()=>{
 let finish!:()=>void;let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve})
 transport.defaults.adapter=config=>new Promise(resolve=>{finish=()=>resolve({data:{privateValue:'private-canary'},status:200,statusText:'OK',headers:{},config});started()})
 const request=client.get('/users');await entered;retireAuthority();finish()
 await expect(request).rejects.toMatchObject({code:'AUTHORITY_CHANGED'})
})
it('never automatically replays a protected mutation after a 401',async()=>{
 let calls=0
 transport.defaults.adapter=async(config:InternalAxiosRequestConfig)=>{calls++;throw {config,response:{status:401,data:{code:'authentication_required'},headers:{},config}}}
 await expect(client.post('/users',{displayName:'private'})).rejects.toMatchObject({status:401});expect(calls).toBe(1)
})
it('requires login after an expired startup token instead of refreshing the authority lookup',async()=>{
 const paths:string[]=[]
 transport.defaults.adapter=async(config:InternalAxiosRequestConfig)=>{paths.push(config.url??'');throw {config,response:{status:401,data:{code:'authentication_required'},headers:{},config}}}
 await expect(client.get('/auth/current')).rejects.toMatchObject({status:401})
 expect(paths).toEqual(['/auth/current'])
})

it.each([
 {status:503,code:'authorization_unavailable',suspended:true,forbidden:false},
 {status:503,code:'dependency_unavailable',suspended:false,forbidden:false},
 {status:403,code:'access_denied',suspended:false,forbidden:true},
])('uses the bounded authority lifecycle for $status/$code',async({status,code,suspended,forbidden})=>{
 const handler=vi.fn(),forbiddenHandler=vi.fn();window.addEventListener('auth:suspended',handler);window.addEventListener('auth:forbidden',forbiddenHandler)
 try {
  transport.defaults.adapter=async(config:InternalAxiosRequestConfig)=>{throw {config,response:{status,data:{code},headers:{},config}}}
  await expect(client.get('/users')).rejects.toMatchObject({status})
  expect(handler).toHaveBeenCalledTimes(suspended?1:0)
  expect(forbiddenHandler).toHaveBeenCalledTimes(forbidden?1:0)
 } finally {window.removeEventListener('auth:suspended',handler);window.removeEventListener('auth:forbidden',forbiddenHandler)}
})

it('recognizes an authorization outage delivered to a private binary request',async()=>{
 const handler=vi.fn();window.addEventListener('auth:suspended',handler)
 try {
  const problem=new Blob(['{"code":"authorization_unavailable"}'],{type:'application/problem+json'})
  Object.defineProperty(problem,'text',{value:async()=>'{"code":"authorization_unavailable"}'})
  transport.defaults.adapter=async(config:InternalAxiosRequestConfig)=>{throw {config,response:{status:503,data:problem,headers:{},config}}}
  await expect(client.post('/billing/ledger/exports/id/redemptions',{}, {responseType:'blob'})).rejects.toMatchObject({status:503})
  expect(handler).toHaveBeenCalledTimes(1)
 } finally {window.removeEventListener('auth:suspended',handler)}
})

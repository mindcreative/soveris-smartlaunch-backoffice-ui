import { beforeEach,expect,it,vi } from 'vitest'
import type { AxiosInstance,InternalAxiosRequestConfig } from 'axios'
import { ApiClient } from './apiClient'
import { retireAuthority } from '../auth/authorityEpoch'
let client:ApiClient,transport:AxiosInstance
beforeEach(()=>{client=new ApiClient();transport=(client as unknown as {client:AxiosInstance}).client})
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

it.each([
 {status:503,code:'authorization_unavailable',suspended:true},
 {status:503,code:'dependency_unavailable',suspended:false},
 {status:403,code:'access_denied',suspended:true},
])('retires private authority only for an authorization failure ($status/$code)',async({status,code,suspended})=>{
 const handler=vi.fn();window.addEventListener('auth:suspended',handler)
 try {
  transport.defaults.adapter=async(config:InternalAxiosRequestConfig)=>{throw {config,response:{status,data:{code},headers:{},config}}}
  await expect(client.get('/users')).rejects.toMatchObject({status})
  expect(handler).toHaveBeenCalledTimes(suspended?1:0)
 } finally {window.removeEventListener('auth:suspended',handler)}
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

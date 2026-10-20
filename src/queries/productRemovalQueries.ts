import { clearRemovalMaterial } from './productRemovalMaterial'
import { useEffect,useSyncExternalStore } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { productKeys } from './productQueries'
import { domainScopeCurrent,type DomainScope } from './domainScope'
import { hasPermission } from '../auth/permissions'
import { useAuthStore } from '../stores/authStore'
import { productRemovalApi } from '../api/productRemovalApi'
let blockedKey:string|null=null,revision=0
const listeners=new Set<()=>void>()
const scopeKey=(s:DomainScope)=>JSON.stringify([s.actorId,s.clientId,s.generation])
export function useRemovalAuthority(){useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},()=>revision)}
export function blockRemovalScope(scope:DomainScope){if(!domainScopeCurrent(scope))return;clearRemovalMaterial();blockedKey=scopeKey(scope);revision++;for(const listener of listeners)listener()}
export function removalScopeCurrent(scope:DomainScope){return blockedKey!==scopeKey(scope)&&domainScopeCurrent(scope)&&hasPermission(useAuthStore.getState().user,'products:delete')}
export const removalKeys={scope:(s:DomainScope)=>[...productKeys.client(s.clientId),'removal',s.actorId,s.generation] as const}
export function assertRemovalScope(scope:DomainScope,signal?:AbortSignal){if(signal?.aborted||!removalScopeCurrent(scope))throw new DOMException('Private scope changed','AbortError')}
function useCleanup(scope:DomainScope){
 const client=useQueryClient()
 useEffect(()=>()=>{
  const key=removalKeys.scope(scope)
  if(!removalScopeCurrent(scope)){void client.cancelQueries({queryKey:key});client.removeQueries({queryKey:key})}
 },[client,scope.actorId,scope.clientId,scope.generation])
}
export function useRemovalHistory(scope:DomainScope,page:number){
 useRemovalAuthority();useCleanup(scope)
 const query=useQuery({queryKey:[...removalKeys.scope(scope),'history',page],enabled:removalScopeCurrent(scope),retry:false,gcTime:0,
  queryFn:async({signal})=>{assertRemovalScope(scope,signal);const result=await productRemovalApi.list(scope.clientId,page,undefined,signal);assertRemovalScope(scope,signal);return result},refetchOnWindowFocus:false})
 useDenied(scope,query.error)
 return query
}
export function useRemovalPreview(scope:DomainScope,product:string,enabled:boolean){
 useRemovalAuthority();useCleanup(scope)
 const query=useQuery({queryKey:[...removalKeys.scope(scope),'preview',product],enabled:enabled&&removalScopeCurrent(scope),retry:false,gcTime:0,
  queryFn:async({signal})=>{assertRemovalScope(scope,signal);const result=await productRemovalApi.preview(scope.clientId,product,signal);assertRemovalScope(scope,signal);return result},refetchOnWindowFocus:false})
 useDenied(scope,query.error)
 return query
}

function useDenied(scope:DomainScope,error:unknown){
 const client=useQueryClient(),status=(error as {status?:number}|null)?.status
 useEffect(()=>{if(status===401||status===403){blockRemovalScope(scope);void client.cancelQueries({queryKey:removalKeys.scope(scope)});client.removeQueries({queryKey:removalKeys.scope(scope)})}},[client,scope.actorId,scope.clientId,scope.generation,status])
}

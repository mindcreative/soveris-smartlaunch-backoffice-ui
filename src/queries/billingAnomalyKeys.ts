import {useSyncExternalStore} from 'react'
export const billingAnomalyKeys={all:['backoffice','private','billing','anomalies'] as const,client:(client:string)=>['backoffice','private','billing','anomalies',client] as const}
const scopes=new Set<{client:string;signal?:string|null;retire:()=>void;blocked:()=>boolean;cooldown:(until:number)=>void}>()
const listeners=new Set<()=>void>()
export function notifyAnomalyScopes(){for(const listener of listeners)listener()}
export function hasAnomalyFilterBlock(client:string,signal?:string|null){return [...scopes].some(s=>s.client===client&&(signal===undefined||s.signal===signal)&&s.blocked())}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener)}}
export function useAnomalyFilterBlock(client:string,signal?:string|null){return useSyncExternalStore(subscribe,()=>hasAnomalyFilterBlock(client,signal))}
export function registerAnomalyScope(client:string,retire:()=>void,signal?:string|null,blocked=()=>false,cooldown=(_until:number)=>{}){const scope={client,retire,signal,blocked,cooldown};scopes.add(scope);notifyAnomalyScopes();return ()=>{scopes.delete(scope);notifyAnomalyScopes()}}
export function retireAnomalyScopes(client?:string,signal?:string|null){for(const s of [...scopes])if((client===undefined||s.client===client)&&(signal===undefined||s.signal===signal))s.retire()}

export function shareAnomalyCooldown(client:string,until:number){for(const s of scopes)if(s.client===client)s.cooldown(until)}

import { parse } from 'lossless-json'
import type { ApiError, ApiErrorResponse } from './apiClient'
import { removalDependencies } from './productRemovalContracts'
const messages:Record<string,string>={
 authentication_required:'Sign in again, then check retained removal status.',insufficient_permissions:'Removal permission is no longer available.',product_not_found:'No visible removal result was found. This does not prove an earlier request cannot still commit.',invalid_request:'The removal request is invalid.',
 time_zone_not_set:'Choose your saved timezone, then check retained removal status. The request may have committed.',stale_revision:'The Product changed. Review a fresh preview before confirming.',removal_preview_stale:'Dependencies changed. Review a fresh preview before confirming.',product_removal_blocked:'Dependencies prevent deletion. Use Archive or resolve pending attachment work.',product_operation_conflict:'The operation ID is bound to another request. Check retained removal status.',product_removed:'This Product was removed. Check its retained removal status.',dependency_unavailable:'Removal status is temporarily unavailable. Check retained status before retrying.'}
export function normalizeRemovalProblem(raw:unknown,status?:number):ApiError{
 let envelope:Record<string,unknown>={}
 try{envelope=(typeof raw==='string'?parse(raw,null,{onDuplicateKey:()=>{throw new Error()}}):raw) as Record<string,unknown>}catch{ /* fail closed */ }
 const code=envelope&&typeof envelope.code==='string'&&messages[envelope.code]?envelope.code:'dependency_unavailable'
 const details:ApiErrorResponse={code}
 try{
  if(envelope.dependencies)details.dependencies=removalDependencies(envelope.dependencies)
  if(typeof envelope.statusUrl==='string'&&/^\/api\/backoffice\/clients\/[0-9a-f-]{36}\/product-removals\/[0-9a-f-]{36}$/.test(envelope.statusUrl))details.statusUrl=envelope.statusUrl
 }catch{return {code:'dependency_unavailable',message:messages.dependency_unavailable!,status}}
 return {code,message:messages[code]!,status,problemDetails:details}
}

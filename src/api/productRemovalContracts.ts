import { isLosslessNumber, parse } from 'lossless-json'
import { domainGuid } from './domainContracts'
import { parseLocalInstant } from '../timezone/LocalInstant'
export const removalPolicy='product-removal-v1' as const
export class RemovalContractError extends Error { constructor(){super('The removal response could not be verified. Check retained status.')} }
const fail=():never=>{throw new RemovalContractError()}
type Obj=Record<string,unknown>
function object(v:unknown,keys:string):Obj{
 if(!v||typeof v!=='object'||Array.isArray(v)||isLosslessNumber(v))return fail()
 const o=v as Obj,k=keys.split(' ')
 if(Object.keys(o).length!==k.length||k.some(x=>!Object.prototype.hasOwnProperty.call(o,x)))return fail()
 return o
}
function json(text:string):unknown{try{return parse(text,null,{onDuplicateKey:()=>fail()})}catch{return fail()}}
function text(v:unknown):string{return typeof v==='string'&&v.length>0&&v.length<=4096?v:fail()}
function one<T extends string>(v:unknown,values:readonly T[]):T{return typeof v==='string'&&values.includes(v as T)?v as T:fail()}
function integer(v:unknown,positive=false):string{
 if(!isLosslessNumber(v)||!(/^(0|[1-9]\d*)$/).test(v.toString()))return fail()
 const n=BigInt(v.toString());return n<=9223372036854775807n&&(!positive||n>0n)?v.toString():fail()
}
function counts<K extends string>(v:unknown,keys:readonly K[]):Record<K,string>{const o=object(v,keys.join(' '));return Object.fromEntries(keys.map(k=>[k,integer(o[k])])) as Record<K,string>}
const assetKeys=['finalizing','ready','deleting','failed','deleted','bytesAwaitingAbsence'] as const
const uploadKeys=['receiving','processing','retryable','completed','rejected','expired','inFlight'] as const
const adoptionKeys=['staging','finalizing','ready','failed','deleted','inFlight'] as const
const jobKeys=['pending','leased','retry','completed','cancelled','deadLetter'] as const
export function removalDependencies(value:unknown){
 const d=object(value,'submissions funnelEvents productBindings primaryProductBindings domainReleaseObligations ordinaryAssets generatedAssets uploads adoptions stagingKeysToVerify existingAssetCleanupJobs')
 const result={submissions:integer(d.submissions),funnelEvents:integer(d.funnelEvents),productBindings:integer(d.productBindings),primaryProductBindings:integer(d.primaryProductBindings),domainReleaseObligations:integer(d.domainReleaseObligations),
  ordinaryAssets:counts(d.ordinaryAssets,assetKeys),generatedAssets:counts(d.generatedAssets,assetKeys),uploads:counts(d.uploads,uploadKeys),adoptions:counts(d.adoptions,adoptionKeys),stagingKeysToVerify:counts(d.stagingKeysToVerify,['ordinary','generated'] as const),existingAssetCleanupJobs:counts(d.existingAssetCleanupJobs,jobKeys)}
 if(BigInt(result.uploads.inFlight)!==BigInt(result.uploads.receiving)+BigInt(result.uploads.processing)+BigInt(result.uploads.retryable)||BigInt(result.adoptions.inFlight)!==BigInt(result.adoptions.staging)+BigInt(result.adoptions.finalizing)||BigInt(result.primaryProductBindings)>BigInt(result.productBindings)||BigInt(result.domainReleaseObligations)<BigInt(result.productBindings))return fail()
 return result
}
export type RemovalDependencies=ReturnType<typeof removalDependencies>
export const blockerCodes=['adoptions_in_flight','assets_finalizing','funnel_events_present','submissions_present','uploads_in_flight'] as const
export type RemovalBlocker=typeof blockerCodes[number]
function blockers(v:unknown):RemovalBlocker[]{if(!Array.isArray(v)||v.length>5)return fail();const values=v.map(x=>one(x,blockerCodes));if(JSON.stringify(values)!==JSON.stringify([...new Set(values)].sort()))return fail();return values}
function preview(value:unknown,client:string,product:string){
 const p=object(value,'policyVersion clientId productId productName productSlug status revision previewFingerprint hardDeleteAllowed blockers dependencies effects')
 if(p.policyVersion!==removalPolicy||domainGuid(p.clientId)!==domainGuid(client)||domainGuid(p.productId)!==domainGuid(product)||typeof p.hardDeleteAllowed!=='boolean'||typeof p.previewFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.previewFingerprint))return fail()
 const effects=object(p.effects,'product assetBytes history domains creditRefund defaultAction')
 if(effects.product!=='hard_delete'||effects.assetBytes!=='durable_cleanup'||effects.history!=='retain'||effects.domains!=='independent_cleanup'||effects.creditRefund!==false||effects.defaultAction!=='archive')return fail()
 const dependencies=removalDependencies(p.dependencies),actual:RemovalBlocker[]=[]
 if(BigInt(dependencies.adoptions.inFlight)>0n)actual.push('adoptions_in_flight')
 if(BigInt(dependencies.ordinaryAssets.finalizing)+BigInt(dependencies.generatedAssets.finalizing)>0n)actual.push('assets_finalizing')
 if(BigInt(dependencies.funnelEvents)>0n)actual.push('funnel_events_present')
 if(BigInt(dependencies.submissions)>0n)actual.push('submissions_present')
 if(BigInt(dependencies.uploads.inFlight)>0n)actual.push('uploads_in_flight')
 const blocked=blockers(p.blockers)
 if(JSON.stringify(blocked)!==JSON.stringify(actual)||p.hardDeleteAllowed!==(actual.length===0))return fail()
 return {policyVersion:removalPolicy,clientId:client,productId:product,productName:text(p.productName),productSlug:text(p.productSlug),status:one(p.status,['active','archived'] as const),revision:integer(p.revision,true),previewFingerprint:p.previewFingerprint,hardDeleteAllowed:p.hardDeleteAllowed,blockers:blocked,dependencies}
}
export type RemovalPreview=ReturnType<typeof preview>
export function parseRemovalPreview(wire:string,client:string,product:string):RemovalPreview{return preview(json(wire),client,product)}
function cleanup(value:unknown){
 const c=object(value,'assetState domainState assets domains')
 const assets=counts(c.assets,['finalObjectsTotal','finalObjectsConfirmedAbsent','stagingKeysTotal','stagingKeysConfirmedAbsent','bytesAwaitingAbsence','pendingJobs','leasedJobs','retryJobs','deadLetterJobs','unresolvedCancelledJobs'] as const)
 const domains=counts(c.domains,['total','pending','retrying','actionRequired','released'] as const)
 const assetState=one(c.assetState,['pending','retrying','action_required','complete'] as const),domainState=one(c.domainState,['pending','retrying','action_required','released'] as const)
 if(BigInt(assets.finalObjectsConfirmedAbsent)>BigInt(assets.finalObjectsTotal)||BigInt(assets.stagingKeysConfirmedAbsent)>BigInt(assets.stagingKeysTotal))return fail()
 const absent=assets.finalObjectsTotal===assets.finalObjectsConfirmedAbsent&&assets.stagingKeysTotal===assets.stagingKeysConfirmedAbsent
 if((assetState==='complete')!==absent||assetState==='complete'&&assets.bytesAwaitingAbsence!=='0')return fail()
 if(BigInt(domains.total)!==BigInt(domains.pending)+BigInt(domains.retrying)+BigInt(domains.actionRequired)+BigInt(domains.released))return fail()
 const domainActual=domains.actionRequired!=='0'?'action_required':domains.retrying!=='0'?'retrying':domains.pending!=='0'?'pending':'released'
 if(domainState!==domainActual)return fail()
 return {assetState,domainState,assets,domains}
}
function receipt(value:unknown,client:string){
 const r=object(value,'policyVersion operationId clientId productId productName productSlug removedRevision removedAt outcome statusUrl dependenciesAtRemoval cleanup')
 const operationId=domainGuid(r.operationId,true),productId=domainGuid(r.productId)
 if(r.policyVersion!==removalPolicy||domainGuid(r.clientId)!==domainGuid(client)||r.outcome!=='removed'||r.statusUrl!==`/api/backoffice/clients/${client}/product-removals/${operationId}`)return fail()
 return {policyVersion:removalPolicy,operationId,clientId:client,productId,productName:text(r.productName),productSlug:text(r.productSlug),removedRevision:integer(r.removedRevision,true),removedAt:parseLocalInstant(r.removedAt),outcome:'removed' as const,statusUrl:r.statusUrl as string,dependenciesAtRemoval:removalDependencies(r.dependenciesAtRemoval),cleanup:cleanup(r.cleanup)}
}
export type RemovalReceipt=ReturnType<typeof receipt>
export function parseRemovalReceipt(wire:string,client:string){return receipt(json(wire),client)}
export function parseRemovalPage(wire:string,client:string){
 const p=object(json(wire),'items page pageSize totalCount totalPages')
 if(!Array.isArray(p.items)||p.items.length>100)return fail()
 return {items:p.items.map(v=>receipt(v,client)),page:integer(p.page,true),pageSize:integer(p.pageSize,true),totalCount:integer(p.totalCount),totalPages:integer(p.totalPages)}
}
export interface RemovalCommand{operationId:string;expectedRevision:string;policyVersion:typeof removalPolicy;previewFingerprint:string}

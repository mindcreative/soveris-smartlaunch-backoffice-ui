import {LosslessNumber,stringify} from 'lossless-json'
import {apiClient} from './apiClient'
import {useAuthStore} from '../stores/authStore'
import {canonicalizeGuid} from '../lib/guid'
import {object,exact,list,str,token,decimal,count,responseInstant,payload,cursor,expenseMetrics,instantMicros,utcInstant,ReportContractError} from './billingReportsApi'
import type {AnomalyCommand,AnomalyDetail,AnomalyEvidence,AnomalyFilters,AnomalyInputs,AnomalyItem,AnomalyPage,AnomalyReceipt,AnomalyRouting,AnomalyTransition,OperatorStatus} from '../types/billingAnomalies'
const fail=():never=>{throw new ReportContractError()}
const statuses=['open','acknowledged','resolved','not_applicable'] as const
const guid=(v:unknown,v7=false):string=>{const s=str(v);return canonicalizeGuid(s)===s&&s!=='00000000-0000-0000-0000-000000000000'&&(!v7||/^[\da-f-]{14}7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(s))?s:fail()}
const hash=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail()
const alias=(v:unknown):string=>typeof v==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(v)?v:fail()
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail()
const small=(v:unknown):number=>{const s=count(v);return BigInt(s)<=2147483647n&&BigInt(s)>0n?Number(s):fail()}
// Keep the wire identity identical to .NET Trim and the database capability.
export const trimAnomalyReason=(v:string)=>v.replace(/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,'')
const reason=(v:unknown):string|null=>v===null?null:typeof v==='string'&&trimAnomalyReason(v)===v&&[...v].length>=1&&[...v].length<=1000&&!/[\p{Cs}\u0000]/u.test(v)?v:fail()
export function normalizeAnomalyFilters(f:AnomalyFilters):AnomalyFilters {
 const from=utcInstant(f.from),to=utcInstant(f.to);if(instantMicros(to)<=instantMicros(from)||instantMicros(to)-instantMicros(from)>366n*86400000000n||!Number.isInteger(f.pageSize)||f.pageSize<1||f.pageSize>100)fail()
 if(f.signal!==null&&!['provider_expense','credit_consumption_to_grants'].includes(f.signal)||f.currency!==null&&(!/^[A-Z]{3}$/.test(f.currency)||f.signal==='credit_consumption_to_grants')||f.configVersion!==null&&guid(f.configVersion,true)!==f.configVersion||f.ruleVersion!==null&&(!Number.isInteger(f.ruleVersion)||f.ruleVersion<1))fail()
 if(f.ruleKey!==null)alias(f.ruleKey);if(f.owner!==null)alias(f.owner);if(f.outcome!==null)token(f.outcome,['breached','not_breached','not_evaluable']);if(f.workflowStatus!==null)token(f.workflowStatus,statuses);token(f.policy,['current','historical','all'])
 return {...f,from,to}
}
function responseFilters(v:unknown):AnomalyFilters {
 const o=object(v);exact(o,['from','to','signal','currency','configVersion','ruleKey','ruleVersion','outcome','workflowStatus','owner','policy','pageSize'])
 return normalizeAnomalyFilters({...o,from:responseInstant(o.from),to:responseInstant(o.to),ruleVersion:o.ruleVersion===null?null:small(o.ruleVersion),pageSize:small(o.pageSize)} as AnomalyFilters)
}
function inputs(v:unknown,signal:string,currency:string|null):AnomalyInputs {
 const o=object(v);exact(o,['grants','consumption','creditProvenance','expense','unknownCurrencyCount','unknownMissingAmountCount','totalObservationCount','emptyData'])
 let creditProvenance:AnomalyInputs['creditProvenance']=null
 if(o.creditProvenance!==null){const p=object(o.creditProvenance);exact(p,['ledgerEntryCount','usageRecordCount','unsettledUsageCount','unsettledUsageCredits','source','ledgerDateBasis','usageDateBasis','membership','netBasis','consumptionBasis']);creditProvenance={ledgerEntryCount:count(p.ledgerEntryCount),usageRecordCount:count(p.usageRecordCount),unsettledUsageCount:count(p.unsettledUsageCount),unsettledUsageCredits:decimal(p.unsettledUsageCredits),source:token(p.source,['immutable_ledger_and_usage']),ledgerDateBasis:token(p.ledgerDateBasis,['created_at']),usageDateBasis:token(p.usageDateBasis,['created_at']),membership:token(p.membership,['committed_first_page_snapshot']),netBasis:token(p.netBasis,['posted_owned_ledger_effects']),consumptionBasis:token(p.consumptionBasis,['usage_records'])}}
 const result={grants:o.grants===null?null:decimal(o.grants),consumption:o.consumption===null?null:decimal(o.consumption),creditProvenance,expense:o.expense===null?null:expenseMetrics(o.expense,currency),unknownCurrencyCount:count(o.unknownCurrencyCount),unknownMissingAmountCount:count(o.unknownMissingAmountCount),totalObservationCount:count(o.totalObservationCount),emptyData:bool(o.emptyData)}
 if(signal==='provider_expense'?(result.grants!==null||result.consumption!==null||result.creditProvenance!==null):(result.grants===null||result.consumption===null||result.creditProvenance===null||result.expense!==null))fail()
 return result
}
function evidence(v:unknown,client:string):AnomalyEvidence {
 const o=object(v);exact(o,['evaluationId','clientId','configVersion','configHash','ruleKey','ruleVersion','ownerAlias','signal','units','currency','expenseBasis','comparator','threshold','scopeOrigin','windowFrom','windowTo','capturedAt','asOf','inputs','decision','algorithm','schemaVersion','sourceDateBasis','membership'])
 if(o.clientId!==client||count(o.schemaVersion)!=='1')fail()
 const signal=token(o.signal,['provider_expense','credit_consumption_to_grants']) as AnomalyEvidence['signal'],currency=o.currency===null?null:token(o.currency,[str(o.currency)]);if(currency!==null&&!/^[A-Z]{3}$/.test(currency))fail()
 const d=object(o.decision);exact(d,['outcome','reason','completeness'])
 const result:AnomalyEvidence={evaluationId:guid(o.evaluationId,true),clientId:guid(o.clientId),configVersion:guid(o.configVersion,true),configHash:hash(o.configHash),ruleKey:alias(o.ruleKey),ruleVersion:small(o.ruleVersion),ownerAlias:alias(o.ownerAlias),signal,units:token(o.units,['provider_money','ratio']) as AnomalyEvidence['units'],currency,expenseBasis:o.expenseBasis===null?null:token(o.expenseBasis,['effective_expense','reconciled_provider_expense']) as AnomalyEvidence['expenseBasis'],comparator:token(o.comparator,['gt','gte']) as AnomalyEvidence['comparator'],threshold:decimal(o.threshold,signal==='provider_expense'?4:8),scopeOrigin:token(o.scopeOrigin,['global','client_override']) as AnomalyEvidence['scopeOrigin'],windowFrom:responseInstant(o.windowFrom),windowTo:responseInstant(o.windowTo),capturedAt:responseInstant(o.capturedAt),asOf:responseInstant(o.asOf),inputs:inputs(o.inputs,signal,currency),decision:{outcome:token(d.outcome,['breached','not_breached','not_evaluable']) as AnomalyEvidence['decision']['outcome'],reason:token(d.reason,['zero_grants','exact_consumption_to_grants','incomplete_expense','empty_observed_zero','effective_expense','reconciled_provider_expense']),completeness:token(d.completeness,['complete','partial']) as 'complete'|'partial'},algorithm:token(o.algorithm,['exact-rational-v1']),schemaVersion:1,sourceDateBasis:token(o.sourceDateBasis,[signal==='provider_expense'?'captured_at':'created_at']),membership:token(o.membership,['committed_evaluation_snapshot'])}
 if(instantMicros(result.windowTo)<=instantMicros(result.windowFrom)||(signal==='provider_expense'?(currency===null||result.units!=='provider_money'||result.expenseBasis===null):(currency!==null||result.units!=='ratio'||result.expenseBasis!==null)))fail()
 return result
}
function routing(v:unknown,e:AnomalyEvidence):AnomalyRouting {
 const o=object(v);exact(o,['state','displayOwner','version','contentHash','destination','externalDelivery','reloadState'])
 const result:AnomalyRouting={state:token(o.state,['mapped','unmapped','unavailable']) as AnomalyRouting['state'],displayOwner:o.displayOwner===null?null:str(o.displayOwner),version:o.version===null?null:guid(o.version,true),contentHash:o.contentHash===null?null:hash(o.contentHash),destination:o.destination===null?null:str(o.destination),externalDelivery:token(o.externalDelivery,['not_configured']) as 'not_configured',reloadState:token(o.reloadState,['valid','last_known_good','unavailable']) as AnomalyRouting['reloadState']}
 if(result.state==='mapped'?(result.destination!==`/billing/clients/${e.clientId}/reports/anomalies/${e.evaluationId}`||result.displayOwner===null||!/^[A-Za-z][A-Za-z0-9 ._-]{0,99}$/.test(result.displayOwner)||result.version===null||result.contentHash===null):(result.destination!==null||result.version!==null||result.contentHash!==null||result.displayOwner!==null))fail()
 return result
}
function item(v:unknown,client:string):AnomalyItem {
 const o=object(v);exact(o,['evidence','workflow','routing','historical']);const e=evidence(o.evidence,client),w=object(o.workflow);exact(w,['status','revision'])
 const workflow={status:token(w.status,statuses) as OperatorStatus,revision:count(w.revision)}
 if((e.decision.outcome==='breached')===(workflow.status==='not_applicable')||workflow.status==='not_applicable'&&workflow.revision!=='0')fail()
 return {evidence:e,workflow,routing:routing(o.routing,e),historical:bool(o.historical)}
}
function transition(v:unknown):AnomalyTransition {
 const o=object(v);exact(o,['operationId','actorId','beforeStatus','afterStatus','beforeRevision','revision','reason','at','correlationId','routeVersion'])
 const r:AnomalyTransition={operationId:guid(o.operationId,true),actorId:guid(o.actorId),beforeStatus:token(o.beforeStatus,statuses) as OperatorStatus,afterStatus:token(o.afterStatus,statuses) as OperatorStatus,beforeRevision:count(o.beforeRevision),revision:count(o.revision),reason:reason(o.reason),at:responseInstant(o.at),correlationId:guid(o.correlationId,true),routeVersion:o.routeVersion===null?null:guid(o.routeVersion,true)}
 if(BigInt(r.revision)!==BigInt(r.beforeRevision)+1n||!allowed(r.beforeStatus,r.afterStatus)||r.afterStatus!=='acknowledged'&&r.reason===null)fail();return r
}
export function allowed(before:OperatorStatus,after:OperatorStatus){return before==='open'&&after==='acknowledged'||before==='acknowledged'&&['resolved','open'].includes(after)||before==='resolved'&&after==='open'}
export function parseAnomalyPage(raw:string,client:string,filters:AnomalyFilters):AnomalyPage {
 const o=payload(raw);exact(o,['clientId','filters','asOf','policy','items','coverageGaps','moreCoverageGaps','nextCursor','canTransition']);if(o.clientId!==client)fail()
 const f=responseFilters(o.filters);if(Object.keys(f).some(k=>f[k as keyof AnomalyFilters]!==normalizeAnomalyFilters(filters)[k as keyof AnomalyFilters]))fail()
 const p=object(o.policy);exact(p,['version','state']);const policy={version:p.version===null?null:guid(p.version,true),state:token(p.state,['configured','disabled','not_configured']) as AnomalyPage['policy']['state']}
 const items=list(o.items,f.pageSize).map(v=>item(v,client));for(const i of items){const e=i.evidence;if(instantMicros(e.windowTo)<=instantMicros(f.from)||instantMicros(e.windowFrom)>=instantMicros(f.to)||f.signal!==null&&e.signal!==f.signal||f.currency!==null&&e.currency!==f.currency||f.outcome!==null&&e.decision.outcome!==f.outcome||f.workflowStatus!==null&&i.workflow.status!==f.workflowStatus||f.owner!==null&&e.ownerAlias!==f.owner||f.configVersion!==null&&e.configVersion!==f.configVersion||f.ruleKey!==null&&e.ruleKey!==f.ruleKey||f.ruleVersion!==null&&e.ruleVersion!==f.ruleVersion||i.historical!==(e.configVersion!==policy.version)||f.policy==='current'&&i.historical||f.policy==='historical'&&!i.historical)fail()}
 const gaps=list(o.coverageGaps,100).map(v=>{const g=object(v);exact(g,['gapId','retiredVersion','supersedingVersion','ruleId','windowFrom','windowTo']);return {gapId:guid(g.gapId,true),retiredVersion:guid(g.retiredVersion,true),supersedingVersion:guid(g.supersedingVersion,true),ruleId:guid(g.ruleId,true),windowFrom:responseInstant(g.windowFrom),windowTo:responseInstant(g.windowTo)}})
 const result={clientId:guid(o.clientId),filters:f,asOf:responseInstant(o.asOf),policy,items,coverageGaps:gaps,moreCoverageGaps:bool(o.moreCoverageGaps),nextCursor:cursor(o.nextCursor),canTransition:bool(o.canTransition)};validateOrder(result.items);if(result.nextCursor&&!items.length)fail();return result
}
export function parseAnomalyDetail(raw:string,client:string,id:string,continuation=false):AnomalyDetail {
 const o=payload(raw);exact(o,['item','history','nextHistoryCursor','canTransition','historyAsOf','historyExpiresAt']);const i=item(o.item,client);if(i.evidence.evaluationId!==id)fail()
 const history=list(o.history,100).map(transition),nextHistoryCursor=cursor(o.nextHistoryCursor),historyAsOf=responseInstant(o.historyAsOf),historyExpiresAt=responseInstant(o.historyExpiresAt)
 if(instantMicros(historyExpiresAt)-instantMicros(historyAsOf)!==900000000n)fail()
 validateHistory(history)
 if((continuation||nextHistoryCursor)&&!history.length||!nextHistoryCursor&&history.length&&(history[history.length-1].revision!=='1'||history[history.length-1].beforeStatus!=='open'))fail()
 if(!continuation&&(i.workflow.revision==='0'?history.length>0:!history.length||history[0].revision!==i.workflow.revision||history[0].afterStatus!==i.workflow.status))fail()
 return {item:i,history,nextHistoryCursor,canTransition:bool(o.canTransition),historyAsOf,historyExpiresAt}
}
export function validateHistory(rows:AnomalyTransition[]){for(let i=1;i<rows.length;i++)if(BigInt(rows[i-1].beforeRevision)!==BigInt(rows[i].revision)||rows[i-1].beforeStatus!==rows[i].afterStatus)fail()}
function validateOrder(rows:AnomalyItem[]){for(let i=1;i<rows.length;i++){const a=rows[i-1].evidence,b=rows[i].evidence;if(instantMicros(a.windowTo)<instantMicros(b.windowTo)||a.windowTo===b.windowTo&&a.evaluationId<=b.evaluationId)fail()}}
export function appendAnomalyPage(first:AnomalyPage,next:AnomalyPage):AnomalyPage {
 if(first.asOf!==next.asOf||JSON.stringify(first.filters)!==JSON.stringify(next.filters)||JSON.stringify(first.policy)!==JSON.stringify(next.policy)||JSON.stringify(first.coverageGaps)!==JSON.stringify(next.coverageGaps)||first.moreCoverageGaps!==next.moreCoverageGaps||first.items.length+next.items.length>10000||!next.items.length)fail()
 const items=[...first.items,...next.items];validateOrder(items);return {...first,items,nextCursor:next.nextCursor}
}
export function serializeAnomalyCommand(r:AnomalyCommand):string {
 guid(r.operationId,true);guid(r.configVersion,true);hash(r.configHash);if(!/^(0|[1-9]\d*)$/.test(r.expectedRevision)||BigInt(r.expectedRevision)>9223372036854775807n||!['acknowledged','resolved','open'].includes(r.action))fail()
 const normalized=r.reason===null?null:trimAnomalyReason(r.reason)||null;reason(normalized);if(r.action!=='acknowledged'&&normalized===null)fail()
 return stringify({...r,expectedRevision:new LosslessNumber(r.expectedRevision),reason:normalized})!
}
function receipt(raw:string,client:string,id:string,r:AnomalyCommand):AnomalyReceipt {
 const o=payload(raw);exact(o,['clientId','evaluationId','operationId','actorId','beforeStatus','status','beforeRevision','revision','at','reason','configVersion','configHash','correlationId','routeVersion'])
 if(o.actorId!==useAuthStore.getState().user?.id||o.clientId!==client||o.evaluationId!==id||o.operationId!==r.operationId||o.configVersion!==r.configVersion||o.configHash!==r.configHash||o.status!==r.action||count(o.beforeRevision)!==r.expectedRevision||o.reason!==(r.reason===null?null:trimAnomalyReason(r.reason)||null))fail()
 const t=transition({operationId:o.operationId,actorId:o.actorId,beforeStatus:o.beforeStatus,afterStatus:o.status,beforeRevision:o.beforeRevision,revision:o.revision,reason:o.reason,at:o.at,correlationId:o.correlationId,routeVersion:o.routeVersion})
 return {clientId:client,evaluationId:id,operationId:t.operationId,actorId:t.actorId,beforeStatus:t.beforeStatus,status:t.afterStatus,beforeRevision:t.beforeRevision,revision:t.revision,reason:t.reason,at:t.at,configVersion:guid(o.configVersion,true),configHash:hash(o.configHash),correlationId:t.correlationId,routeVersion:t.routeVersion}
}
export async function readAnomalies(client:string,f:AnomalyFilters,next:string|undefined,signal:AbortSignal):Promise<AnomalyPage>{guid(client);const params=new URLSearchParams({clientId:client});for(const [k,v] of Object.entries(next===undefined?normalizeAnomalyFilters(f):{cursor:next}))if(v!==null)params.set(k,String(v));const response=await apiClient.getApiRoot<string>('/api/billing/anomalies',{params,signal,responseType:'text',transformResponse:[v=>v],retryOnUnauthorized:false,timeout:30000});if(signal.aborted)throw new DOMException('Cancelled','AbortError');return parseAnomalyPage(response.data,client,f)}
export async function readAnomalyDetail(client:string,id:string,next:string|undefined,signal:AbortSignal):Promise<AnomalyDetail>{guid(client);guid(id,true);const response=await apiClient.getApiRoot<string>(`/api/billing/anomalies/${id}`,{params:{clientId:client,...(next?{historyCursor:next}:{})},signal,responseType:'text',transformResponse:[v=>v],retryOnUnauthorized:false,timeout:30000});if(signal.aborted)throw new DOMException('Cancelled','AbortError');return parseAnomalyDetail(response.data,client,id,next!==undefined)}
export async function transitionAnomaly(client:string,id:string,r:AnomalyCommand,signal:AbortSignal):Promise<AnomalyReceipt>{guid(client);guid(id,true);const response=await apiClient.postApiRoot<string>(`/api/billing/anomalies/${id}/transitions`,serializeAnomalyCommand(r),{params:{clientId:client},signal,headers:{'Content-Type':'application/json'},responseType:'text',transformResponse:[v=>v],retryOnUnauthorized:false,timeout:30000});if(signal.aborted)throw new DOMException('Cancelled','AbortError');return receipt(response.data,client,id,r)}

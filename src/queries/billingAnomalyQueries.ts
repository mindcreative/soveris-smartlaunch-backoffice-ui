import {useLayoutEffect,useState,useSyncExternalStore} from 'react'
import {QueryClient,useQueryClient} from '@tanstack/react-query'
import {allowed,appendAnomalyPage,readAnomalies,readAnomalyDetail,serializeAnomalyCommand,trimAnomalyReason,transitionAnomaly,validateHistory} from '../api/billingAnomaliesApi'
import {instantMicros,ReportContractError} from '../api/billingReportsApi'
import {createUuidV7} from '../lib/uuidV7'
import {billingAnomalyKeys,registerAnomalyScope,notifyAnomalyScopes,shareAnomalyCooldown} from './billingAnomalyKeys'
import type {AnomalyCommand,AnomalyDetail,AnomalyFilters,AnomalyPage,AnomalyReceipt} from '../types/billingAnomalies'
interface Transport {list:typeof readAnomalies;detail:typeof readAnomalyDetail;command:typeof transitionAnomaly}
export interface InvestigationState {
 page:AnomalyPage|null;detail:AnomalyDetail|null;listBusy:boolean;detailBusy:boolean;commandBusy:boolean;stale:boolean;historyStale:boolean;retired:boolean;
 error:string|null;detailError:string|null;message:string;commandState:'idle'|'pending'|'ambiguous'|'conflict'|'success'|'invalid';
 action:AnomalyCommand['action']|null;reason:string;command:AnomalyCommand|null;receipt:AnomalyReceipt|null;retryAt:number
}
let generation=0
export class AnomalyInvestigation {
 private state:InvestigationState={page:null,detail:null,listBusy:false,detailBusy:false,commandBusy:false,stale:false,historyStale:false,retired:false,error:null,detailError:null,message:'',commandState:'idle',action:null,reason:'',command:null,receipt:null,retryAt:0}
 private listeners=new Set<()=>void>();private alive=true;private auth:string;private generation=++generation;private request=0
 private listAbort:AbortController|null=null;private detailAbort:AbortController|null=null;private commandAbort:AbortController|null=null
 private unregister:()=>void=()=>{};private expiry:ReturnType<typeof setTimeout>|undefined;private historyExpiry:ReturnType<typeof setTimeout>|undefined;private cooldown:ReturnType<typeof setTimeout>|undefined
 private traversal=0;private detailEpoch=0;private selected:string|null=null;private cursors=new Set<string>();private historyCursors=new Set<string>()
 constructor(private queries:QueryClient,readonly client:string,readonly filters:AnomalyFilters,private authority:()=>string,private denied:(status:number)=>void,private transport:Transport={list:readAnomalies,detail:readAnomalyDetail,command:transitionAnomaly}){this.auth=authority()}
 snapshot=()=>this.state
 subscribe=(f:()=>void)=>{this.listeners.add(f);return ()=>{this.listeners.delete(f)}}
 private emit(value:Partial<InvestigationState>){this.state={...this.state,...value};for(const f of this.listeners)f();notifyAnomalyScopes()}
 private get prefix(){return [...billingAnomalyKeys.client(this.client),this.filters,this.generation]}
 activate(){this.alive=true;this.auth=this.authority();this.generation=++generation;this.unregister();this.unregister=registerAnomalyScope(this.client,()=>this.retire(),this.filters.signal,()=>Boolean(this.state.command)||this.state.commandBusy||this.state.retryAt>Date.now(),this.setCooldown);this.emit({retired:false})}
 retire(){if(!this.alive)return;this.alive=false;this.traversal++;this.detailEpoch++;this.listAbort?.abort();this.detailAbort?.abort();this.commandAbort?.abort();clearTimeout(this.expiry);clearTimeout(this.historyExpiry);clearTimeout(this.cooldown);this.cursors.clear();this.historyCursors.clear();this.selected=null;void this.queries.cancelQueries({queryKey:this.prefix});this.queries.removeQueries({queryKey:this.prefix});this.unregister();this.emit({page:null,detail:null,listBusy:false,detailBusy:false,commandBusy:false,stale:false,historyStale:false,retired:true,error:null,detailError:null,message:'',action:null,reason:'',command:null,receipt:null,commandState:'idle'})}
 private valid(abort:AbortController){return this.alive&&!abort.signal.aborted&&this.auth===this.authority()}
 private expiryTime(page:AnomalyPage){return Number(instantMicros(page.asOf)/1000n)+15*60000}
 private async bounded<T>(work:Promise<T>):Promise<T>{let timeout:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject({status:503}),30000)})])}finally{clearTimeout(timeout)}}
 private fail(error:unknown,abort:AbortController):boolean {
  if(!this.valid(abort))return true
  const status=(error as {status?:number})?.status;if(status===401||status===403){this.retire();this.denied(status);return true}return false
 }
 private setCooldown=(until:number)=>{const next=Math.max(this.state.retryAt,until);clearTimeout(this.cooldown);this.emit({retryAt:next});this.cooldown=setTimeout(()=>{if(this.alive)this.emit({retryAt:0})},Math.max(0,next-Date.now()))}
 private throttle(error:unknown){const status=(error as {status?:number})?.status;if(status!==429)return;const seconds=(error as {retryAfterSeconds?:number})?.retryAfterSeconds;const until=Date.now()+Math.max(1000,Number.isFinite(seconds)?seconds!*1000:30000);this.setCooldown(until);shareAnomalyCooldown(this.client,until)}

 refresh=async()=>{if(!this.alive||this.state.listBusy||this.state.retryAt>Date.now())return;this.listAbort?.abort();this.traversal++;this.cursors.clear();clearTimeout(this.expiry);this.emit({page:null,stale:false,error:null});await this.loadList(false)}
 more=async()=>{if(!this.state.page?.nextCursor||this.state.listBusy||this.state.stale||this.state.retryAt>Date.now())return;if(this.expiryTime(this.state.page)<=Date.now()){this.emit({stale:true});return}await this.loadList(true)}
 private async loadList(more:boolean){
  const abort=new AbortController(),traversal=this.traversal,previous=this.state.page,next=more?previous?.nextCursor??undefined:undefined;this.listAbort=abort;this.emit({listBusy:true,error:null,message:more?'Loading more from the saved anomaly snapshot.':'Loading saved anomaly evidence.'})
  try{
   const result=await this.queries.fetchQuery({queryKey:[...this.prefix,'list',traversal,++this.request],retry:false,staleTime:Infinity,gcTime:0,queryFn:async({signal})=>{
    const cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});try{const page=await this.bounded(this.transport.list(this.client,this.filters,next,abort.signal));if(!this.valid(abort)||this.traversal!==traversal)throw new DOMException('Retired','AbortError');return page}finally{signal.removeEventListener('abort',cancel)}}})
   if(!this.valid(abort)||this.traversal!==traversal)return
   if(next&&(this.cursors.has(next)||result.nextCursor===next||result.nextCursor!==null&&this.cursors.has(result.nextCursor)))throw new ReportContractError()
   const page=more&&previous?appendAnomalyPage(previous,result):result;if(next)this.cursors.add(next)
   this.emit({page,error:null,stale:this.state.stale||this.expiryTime(page)<=Date.now(),message:`${page.items.length} evaluations loaded; ${page.nextCursor?'more available':'end of results'}.`})
   clearTimeout(this.expiry);this.expiry=setTimeout(()=>{if(this.alive&&this.traversal===traversal)this.emit({stale:true,message:'Anomaly list snapshot expired. Refresh to continue.'})},Math.max(0,this.expiryTime(page)-Date.now()))
  }catch(error){if(this.traversal!==traversal||this.fail(error,abort))return;this.throttle(error);const contract=error instanceof ReportContractError,status=(error as {status?:number})?.status;this.emit({page:contract?null:previous,stale:this.state.stale||Boolean(previous&&status===400),error:contract?'Anomaly evidence verification failed.':status===400?'Anomaly query or cursor was rejected. Refresh or correct filters.':more?'Partial load: further anomaly evidence is unavailable.':'Anomaly query unavailable. No conclusion about anomalies can be drawn.'})}
  finally{if(this.listAbort===abort){abort.abort();this.listAbort=null;if(this.alive)this.emit({listBusy:false})}}
 }
 select=async(id:string)=>{if(!this.alive||this.state.retryAt>Date.now()||this.state.commandBusy||this.state.commandState==='ambiguous')return;this.detailAbort?.abort();this.detailEpoch++;this.selected=id;this.historyCursors.clear();clearTimeout(this.historyExpiry);this.emit({historyStale:false,detail:null,detailError:null,action:null,reason:'',command:null,receipt:null,commandState:'idle'});await this.loadDetail(false)}
 refreshDetail=async()=>{if(this.selected&&this.state.retryAt<=Date.now()&&!this.state.detailBusy&&!this.state.commandBusy&&this.state.commandState!=='ambiguous'){this.detailEpoch++;this.detailAbort?.abort();this.historyCursors.clear();await this.loadDetail(false)}}
 moreHistory=async()=>{if(!this.state.detail?.nextHistoryCursor||this.state.detailBusy||this.state.commandBusy||this.state.historyStale||this.state.retryAt>Date.now())return;if(Number(instantMicros(this.state.detail.historyExpiresAt)/1000n)<=Date.now()){this.emit({historyStale:true});return}await this.loadDetail(true)}
 private armHistoryExpiry(detail:AnomalyDetail,epoch:number){
  clearTimeout(this.historyExpiry);this.historyExpiry=setTimeout(()=>{if(this.alive&&epoch===this.detailEpoch)this.emit({historyStale:true})},Math.max(0,Number(instantMicros(detail.historyExpiresAt)/1000n)-Date.now()))
 }
 private async loadDetail(more:boolean){
  if(!this.selected||!this.alive)return;const abort=new AbortController(),epoch=this.detailEpoch,id=this.selected,previous=this.state.detail,next=more?previous?.nextHistoryCursor??undefined:undefined;this.detailAbort=abort;if(previous)this.armHistoryExpiry(previous,epoch);this.emit({detailBusy:true,detailError:null})
  try{
   const result=await this.bounded(this.transport.detail(this.client,id,next,abort.signal));if(!this.valid(abort)||epoch!==this.detailEpoch||id!==this.selected)return
   if(next&&(this.historyCursors.has(next)||result.nextHistoryCursor===next||result.nextHistoryCursor!==null&&this.historyCursors.has(result.nextHistoryCursor)))throw new ReportContractError()
   if(more&&previous&&(previous.historyAsOf!==result.historyAsOf||previous.historyExpiresAt!==result.historyExpiresAt))throw new ReportContractError()
   const history=more&&previous?[...previous.history,...result.history]:result.history;validateHistory(history);if(history.length>10000)throw new ReportContractError();if(next)this.historyCursors.add(next)
   if(previous&&JSON.stringify(previous.item.evidence)!==JSON.stringify(result.item.evidence))throw new ReportContractError()
   this.emit({detail:{...result,history},detailError:null,historyStale:Number(instantMicros(result.historyExpiresAt)/1000n)<=Date.now()})
   this.armHistoryExpiry(result,epoch)
  }catch(error){if(epoch!==this.detailEpoch||id!==this.selected||this.fail(error,abort))return;this.throttle(error);const expired=more&&(error as {status?:number})?.status===400;this.emit({detail:error instanceof ReportContractError?null:previous,historyStale:this.state.historyStale||expired||Boolean(previous&&Number(instantMicros(previous.historyExpiresAt)/1000n)<=Date.now()),detailError:expired?'History cursor was rejected. Refresh investigation evidence to start a new history snapshot.':'Evidence/history unavailable. Refresh evidence or retry history; no operator outcome is implied.'})}
  finally{if(this.detailAbort===abort){abort.abort();this.detailAbort=null;if(this.alive)this.emit({detailBusy:false})}}
 }
 openAction=(action:AnomalyCommand['action'])=>{if(!this.alive||this.state.commandBusy||this.state.detailBusy||this.state.commandState==='ambiguous'||!this.state.detail||!allowed(this.state.detail.item.workflow.status,action))return;this.emit({action,reason:'',command:null,receipt:null,commandState:'idle'})}
 setReason=(reason:string)=>{if(!this.state.commandBusy&&!this.state.command)this.emit({reason})}
 closeAction=()=>{if(!this.state.commandBusy)this.emit({action:null})}
 confirm=async()=>{
  if(!this.state.detail||!this.state.action||this.state.commandBusy||this.state.commandState==='conflict'||this.state.retryAt>Date.now())return
  if(!this.state.command){const d=this.state.detail;const command:AnomalyCommand={operationId:createUuidV7(),expectedRevision:d.item.workflow.revision,configVersion:d.item.evidence.configVersion,configHash:d.item.evidence.configHash,action:this.state.action,reason:trimAnomalyReason(this.state.reason)||null};try{serializeAnomalyCommand(command)}catch{this.emit({commandState:'invalid',message:'Enter a reason of 1–1000 characters for resolve or reopen.'});return}this.emit({command})}
  await this.sendCommand()
 }
 recover=async()=>{if(this.state.command&&this.state.commandState==='ambiguous'&&!this.state.commandBusy&&this.state.retryAt<=Date.now())await this.sendCommand()}
 private async sendCommand(){
  const command=this.state.command,id=this.selected;if(!command||!id||!this.alive)return;const abort=new AbortController();this.commandAbort=abort;this.emit({commandBusy:true,commandState:'pending',message:'Confirming operator status. Saved expense and credits remain evidence.'})
  try{
   const receipt=await this.bounded(this.transport.command(this.client,id,command,abort.signal));if(!this.valid(abort)||this.state.command!==command)return
   this.emit({receipt,command:null,action:null,reason:'',commandState:'success',message:`Operator status recorded: ${receipt.status}, revision ${receipt.revision}. The immutable evaluation outcome is unchanged. Refresh evidence for current workflow state.`,stale:true})
   await this.loadDetail(false)
  }catch(error){if(this.fail(error,abort)||this.state.command!==command)return;this.throttle(error);const status=(error as {status?:number})?.status;
   if(status===409){this.emit({command:null,commandState:'conflict',message:'The workflow or evidence changed. Refresh evidence and explicitly confirm a new action.'})}
   else if(status===400){this.emit({command:null,commandState:'invalid',message:'The operator request was rejected. Check the action and reason.'})}
   else this.emit({commandState:'ambiguous',message:'Outcome not yet confirmed. Recover using this same operation; do not submit a new operation.'})
  }finally{if(this.commandAbort===abort){abort.abort();this.commandAbort=null;if(this.alive)this.emit({commandBusy:false})}}
 }
}
export function useAnomalyInvestigation(client:string,filters:AnomalyFilters,authority:()=>string,denied:(status:number)=>void){
 const queries=useQueryClient();const [controller]=useState(()=>new AnomalyInvestigation(queries,client,filters,authority,denied));const state=useSyncExternalStore(controller.subscribe,controller.snapshot)
 useLayoutEffect(()=>{controller.activate();void controller.refresh();return ()=>controller.retire()},[controller]);return {controller,...state}
}

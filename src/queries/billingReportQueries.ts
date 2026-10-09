import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { appendReportPage, instantMicros, readBillingReport, ReportContractError } from '../api/billingReportsApi'
import { billingReportKeys, registerReportScope } from './billingReportKeys'
import type { ReportFilters, ReportKind, ReportPage } from '../types/billingReports'

export interface ReportFailure {kind:'contract'|'invalid'|'transient';message:string;retryAt:number}
export interface TraversalState {page:ReportPage|null;busy:boolean;error:ReportFailure|null;stale:boolean;announcement:string}
type Reader=typeof readBillingReport
let authorityGeneration=0
export class ReportTraversal {
  private state:TraversalState={page:null,busy:false,error:null,stale:false,announcement:''}
  private listeners=new Set<()=>void>()
  private alive=true
  private traversal=0
  private request=0
  private generation=++authorityGeneration
  private controller:AbortController|null=null
  private cooldown:ReturnType<typeof setTimeout>|undefined
  private expiry:ReturnType<typeof setTimeout>|undefined
  private auth:string
  private unregister:()=>void=()=>{}
  private cursors=new Set<string>()
  private queryPrefix:readonly unknown[]
  constructor(private queries:QueryClient,private kind:ReportKind,readonly client:string,private filters:ReportFilters,private authority:()=>string,private denied:(status:number)=>void,private reader:Reader=readBillingReport){
    this.auth=authority();this.queryPrefix=[...billingReportKeys.client(client),kind,filters,this.generation]

  }
  activate(){this.alive=true;this.auth=this.authority();this.generation=++authorityGeneration;this.queryPrefix=[...billingReportKeys.client(this.client),this.kind,this.filters,this.generation];this.unregister();this.unregister=registerReportScope(this.client,this.kind,()=>this.retire())}
  snapshot=()=>this.state
  subscribe=(callback:()=>void)=>{this.listeners.add(callback);return ()=>{this.listeners.delete(callback)}}
  private emit(next:Partial<TraversalState>){this.state={...this.state,...next};for(const listener of this.listeners)listener()}
  private cancel(){this.controller?.abort();this.controller=null;clearTimeout(this.expiry);clearTimeout(this.cooldown);void this.queries.cancelQueries({queryKey:this.queryPrefix});this.queries.removeQueries({queryKey:this.queryPrefix})}
  retire(){if(!this.alive)return;this.alive=false;this.traversal++;this.cancel();this.cursors.clear();this.unregister();this.emit({page:null,busy:false,error:null,stale:false,announcement:''})}
  private current(controller:AbortController,traversal:number){return this.alive&&this.controller===controller&&this.traversal===traversal&&this.authority()===this.auth&&!controller.signal.aborted}
  refresh=async()=>{
    if(!this.alive||this.authority()!==this.auth||(this.state.error?.retryAt??0)>Date.now())return
    this.unregister();this.unregister=registerReportScope(this.client,this.kind,()=>this.retire())
    // UI locks duplicate refresh; programmatic replacement cancels a pending continuation.
    if(this.state.busy&&!this.state.page)return
    this.cancel();this.cursors.clear();this.traversal++;this.emit({page:null,busy:false,error:null,stale:false,announcement:'Loading a fresh report snapshot.'})
    await this.load(false)
  }
  more=async()=>{
    if(!this.alive||this.state.busy||!this.state.page?.nextCursor||this.state.stale||(this.state.error?.retryAt??0)>Date.now())return
    if(this.expired(this.state.page)){this.expire();return}
    await this.load(true)
  }
  private expired(page:ReportPage){return Number(instantMicros(page.asOf)/1000n)+15*60000<=Date.now()}
  private expire(){this.emit({stale:true,announcement:'This snapshot is stale. Refresh report to continue.'})}
  private async load(more:boolean){
    const previous=this.state.page, cursor=more?previous?.nextCursor??undefined:undefined
    const controller=new AbortController(),traversal=this.traversal;this.controller=controller
    this.emit({busy:true,error:null,announcement:more?'Loading more from the same snapshot.':'Loading a fresh report snapshot.'})
    let timeout:ReturnType<typeof setTimeout>|undefined
    try{
      const request=++this.request
      const page=await this.queries.fetchQuery({queryKey:billingReportKeys.page(this.client,this.kind,this.filters,this.generation,traversal,request),staleTime:Infinity,gcTime:Infinity,retry:false,
        queryFn:async({signal})=>{
          const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true})
          try{const result=await Promise.race([this.reader(this.kind,this.client,this.filters,cursor,controller.signal),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{reject({status:503});},30000)})]);if(!this.current(controller,traversal))throw new DOMException('Cancelled','AbortError');return result}
          finally{signal.removeEventListener('abort',abort);clearTimeout(timeout)}
        }})
      if(!this.current(controller,traversal))return
      if(cursor&&(this.cursors.has(cursor)||page.nextCursor===cursor||page.nextCursor!==null&&this.cursors.has(page.nextCursor)))throw new ReportContractError()
      if(!more&&page.unit==='abstract_credits'&&page.items[0]?.periodStart!==page.from)throw new ReportContractError()
      if(page.unit==='abstract_credits'&&page.nextCursor===null&&page.items[page.items.length-1]?.periodEnd!==page.to)throw new ReportContractError()
      const combined=more&&previous?appendReportPage(previous,page):page
      if(cursor)this.cursors.add(cursor)
      this.emit({page:combined,error:null,stale:this.expired(page),announcement:`${combined.items.length} ${this.kind==='credit'?'periods':'groups'} loaded; ${page.nextCursor?'more available':'end of results'}.`})
      clearTimeout(this.expiry)
      this.expiry=setTimeout(()=>this.expire(),Math.max(0,Number(instantMicros(page.asOf)/1000n)+15*60000-Date.now()))
    }catch(error){
      if(!this.current(controller,traversal))return
      const status=(error as {status?:number})?.status
      if(status===401||status===403){this.retire();this.denied(status);return}
      const contract=error instanceof ReportContractError||status===500
      const invalid=status===400
      const retrySeconds=(error as {retryAfterSeconds?:number})?.retryAfterSeconds
      const retryAt=status===429?Date.now()+Math.max(1000,Number.isFinite(retrySeconds)?retrySeconds!*1000:30000):0
      this.queries.removeQueries({queryKey:this.queryPrefix})
      if(retryAt) this.cooldown=setTimeout(()=>{if(this.alive&&this.traversal===traversal&&this.state.error) this.emit({error:{...this.state.error,retryAt:0}})},Math.max(0,retryAt-Date.now()))
      this.emit({page:contract?null:previous,stale:!contract&&Boolean(previous&&(this.state.stale||this.expired(previous)||(more&&invalid))),error:{kind:contract?'contract':invalid?'invalid':'transient',retryAt,message:contract?'Report unavailable: the evidence or response could not be verified.':invalid?(more?'This snapshot can no longer be continued. Refresh report to restart.':'The query was rejected. Correct or narrow the filters and apply again.'):(more?'Partial load: more results could not be loaded. Validated totals still describe the full window.':'The report could not be loaded. Try again.')},announcement:'Report request stopped. This read changes no credits or provider evidence.'})
    }finally{
      clearTimeout(timeout)
      if(this.controller===controller){controller.abort();this.controller=null;if(this.alive)this.emit({busy:false})}
    }
  }
}
export function useFrozenReport(kind:ReportKind,client:string,filters:ReportFilters,authority:()=>string,denied:(status:number)=>void){
  const queries=useQueryClient()
  const [report]=useState(()=>new ReportTraversal(queries,kind,client,filters,authority,denied))
  const state=useSyncExternalStore(report.subscribe,report.snapshot)
  useLayoutEffect(()=>{report.activate();void report.refresh();return ()=>report.retire()},[report])
  return {...state,refresh:report.refresh,more:report.more}
}

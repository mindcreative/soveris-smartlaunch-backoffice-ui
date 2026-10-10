import {describe,it,expect,vi} from 'vitest'
import {QueryClient} from '@tanstack/react-query'
import {AnomalyInvestigation} from './billingAnomalyQueries'
import type {AnomalyPage} from '../types/billingAnomalies'
import {retireAnomalyScopes} from './billingAnomalyKeys'
const filters={from:'2024-01-01T00:00:00Z',to:'2025-01-01T00:00:00Z',signal:'provider_expense' as const,currency:null,configVersion:null,ruleKey:null,ruleVersion:null,outcome:null,workflowStatus:null,owner:null,policy:'all' as const,pageSize:25}
describe('anomaly private generations',()=>{
 it('retires before cancellation completes and ignores both late outcomes',async()=>{
  const queries=new QueryClient();let reject!:(e:unknown)=>void;let authority='A';const denied=vi.fn()
  const lane=new AnomalyInvestigation(queries,'client',filters,()=>authority,denied,{list:()=>new Promise<AnomalyPage>((_,r)=>{reject=r}),detail:vi.fn(),command:vi.fn()});lane.activate();const pending=lane.refresh();await vi.waitFor(()=>expect(reject).toBeDefined());retireAnomalyScopes();expect(lane.snapshot().page).toBeNull();expect(lane.snapshot().retired).toBe(true);authority='B';reject({status:403});await pending;expect(denied).not.toHaveBeenCalled();expect(queries.getQueryCache().getAll()).toHaveLength(0)
 })
})

import {parseAnomalyPage,parseAnomalyDetail} from '../api/billingAnomaliesApi'
import {anomalyPageFixture,anomalyDetailFixture,ANOMALY_ID} from '../test/billingAnomaliesFixture'
import {REPORT_CLIENT} from '../test/billingReportsFixture'
import type {AnomalyReceipt} from '../types/billingAnomalies'
it('a retired A command success cannot enter a new A or preserve a private draft',async()=>{
 const queries=new QueryClient();const deny=vi.fn();let resolve!:(r:AnomalyReceipt)=>void
 const transport={list:async(client:string,f:import('../types/billingAnomalies').AnomalyFilters)=>parseAnomalyPage(anomalyPageFixture(f,client),client,f),detail:async(client:string,id:string)=>parseAnomalyDetail(anomalyDetailFixture(client),client,id),command:vi.fn(()=>new Promise<AnomalyReceipt>(r=>{resolve=r}))}
 const old=new AnomalyInvestigation(queries,REPORT_CLIENT,filters,()=> 'same-A',deny,transport);old.activate();await old.refresh();await old.select(ANOMALY_ID);old.openAction('acknowledged');old.setReason('PRIVATE-DRAFT-ANOMALY');const sent=old.confirm();await vi.waitFor(()=>expect(resolve).toBeDefined());const command=old.snapshot().command!;old.retire();expect(old.snapshot().reason).toBe('');expect(old.snapshot().command).toBeNull();expect(old.snapshot().detail).toBeNull()
 const current=new AnomalyInvestigation(queries,REPORT_CLIENT,filters,()=> 'same-A',deny,transport);current.activate();await current.refresh();resolve({clientId:REPORT_CLIENT,evaluationId:ANOMALY_ID,operationId:command.operationId,actorId:REPORT_CLIENT,beforeStatus:'open',status:'acknowledged',beforeRevision:'0',revision:'1',at:'2026-10-10T00:00:00Z',reason:command.reason,configVersion:command.configVersion,configHash:command.configHash,correlationId:command.operationId,routeVersion:null});await sent;expect(current.snapshot().receipt).toBeNull();expect(current.snapshot().page).not.toBeNull();expect(deny).not.toHaveBeenCalled();current.retire()
})
it('timeout/503 keeps an ambiguous operation and revoked recovery retires all private state',async()=>{
 let calls=0;const denied=vi.fn();const identities:string[]=[]
 const transport={list:async(client:string,f:import('../types/billingAnomalies').AnomalyFilters)=>parseAnomalyPage(anomalyPageFixture(f,client),client,f),detail:async(client:string,id:string)=>parseAnomalyDetail(anomalyDetailFixture(client),client,id),command:vi.fn(async(_client:string,_id:string,r:import('../types/billingAnomalies').AnomalyCommand)=>{identities.push(r.operationId);if(calls++===0)throw {status:503};throw {status:403}})}
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',denied,transport);lane.activate();await lane.refresh();await lane.select(ANOMALY_ID);lane.openAction('acknowledged');await lane.confirm();expect(lane.snapshot().commandState).toBe('ambiguous');await lane.recover();expect(identities[0]).toBe(identities[1]);expect(lane.snapshot().retired).toBe(true);expect(lane.snapshot().page).toBeNull();expect(lane.snapshot().command).toBeNull();expect(denied).toHaveBeenCalledWith(403)
})
it('obeys detail Retry-After before inspect or refresh requests',async()=>{
 vi.useFakeTimers();const read=vi.fn(async()=>{throw {status:429,retryAfterSeconds:5}})
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),{list:vi.fn(),detail:read,command:vi.fn()});lane.activate()
 try{await lane.select(ANOMALY_ID);expect(read).toHaveBeenCalledTimes(1);await lane.refreshDetail();await lane.select(ANOMALY_ID);expect(read).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(5001);await lane.refreshDetail();expect(read).toHaveBeenCalledTimes(2)}finally{lane.retire();vi.useRealTimers()}
})

it('expires history without sending the known expired cursor and starts fresh only on refresh',async()=>{
 vi.useFakeTimers();const detail=parseAnomalyDetail(anomalyDetailFixture(),REPORT_CLIENT,ANOMALY_ID);detail.nextHistoryCursor='snapshot-cursor';const read=vi.fn(async(_client:string,_id:string,_next:string|undefined)=>detail)
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),{list:vi.fn(),detail:read,command:vi.fn()});lane.activate()
 try{await lane.select(ANOMALY_ID);await vi.advanceTimersByTimeAsync(900001);expect(lane.snapshot().historyStale).toBe(true);await lane.moreHistory();expect(read).toHaveBeenCalledTimes(1);await lane.refreshDetail();expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls[1][2]).toBeUndefined()}finally{lane.retire();vi.useRealTimers()}
})
it('invalid history cursor becomes stale while readable evidence survives until explicit refresh',async()=>{
 const detail=parseAnomalyDetail(anomalyDetailFixture(),REPORT_CLIENT,ANOMALY_ID);detail.nextHistoryCursor='snapshot-cursor';const read=vi.fn(async(_client:string,_id:string,next:string|undefined)=>{if(next)throw {status:400};return detail})
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),{list:vi.fn(),detail:read,command:vi.fn()});lane.activate()
 try{await lane.select(ANOMALY_ID);await lane.moreHistory();expect(lane.snapshot().historyStale).toBe(true);expect(lane.snapshot().detail?.item).toBe(detail.item);await lane.moreHistory();expect(read).toHaveBeenCalledTimes(2);await lane.refreshDetail();expect(lane.snapshot().historyStale).toBe(false);expect(read).toHaveBeenCalledTimes(3)}finally{lane.retire()}
})
it('keeps expired history visibly stale when a fresh detail request fails',async()=>{
 vi.useFakeTimers();const detail=parseAnomalyDetail(anomalyDetailFixture(),REPORT_CLIENT,ANOMALY_ID);detail.nextHistoryCursor='expired-snapshot';let calls=0;const read=vi.fn(async()=>{if(calls++)throw {status:503};return detail})
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),{list:vi.fn(),detail:read,command:vi.fn()});lane.activate()
 try{await lane.select(ANOMALY_ID);await vi.advanceTimersByTimeAsync(900001);expect(lane.snapshot().historyStale).toBe(true);await lane.refreshDetail();expect(lane.snapshot().detail?.item).toBe(detail.item);expect(lane.snapshot().historyStale).toBe(true);await lane.moreHistory();expect(read).toHaveBeenCalledTimes(2)}finally{lane.retire();vi.useRealTimers()}
})
it('retains the old expiry timer while a replacement snapshot is still pending',async()=>{
 vi.useFakeTimers();const detail=parseAnomalyDetail(anomalyDetailFixture(),REPORT_CLIENT,ANOMALY_ID);detail.nextHistoryCursor='snapshot';let calls=0;let reject!:(e:unknown)=>void;const read=vi.fn(()=>calls++?new Promise<import('../types/billingAnomalies').AnomalyDetail>((_,r)=>{reject=r}):Promise.resolve(detail))
 const lane=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),{list:vi.fn(),detail:read,command:vi.fn()});lane.activate()
 try{await lane.select(ANOMALY_ID);await vi.advanceTimersByTimeAsync(895000);const pending=lane.refreshDetail();await vi.advanceTimersByTimeAsync(5001);expect(lane.snapshot().historyStale).toBe(true);reject({status:503});await pending;expect(lane.snapshot().historyStale).toBe(true)}finally{lane.retire();vi.useRealTimers()}
})
it('shares Retry-After across the active credit and expense lanes using the same endpoint',async()=>{
 const read=vi.fn(async()=>{throw {status:429,retryAfterSeconds:30}});const transport={list:vi.fn(),detail:read,command:vi.fn()};const expense=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,filters,()=> 'authority',vi.fn(),transport);const credit=new AnomalyInvestigation(new QueryClient(),REPORT_CLIENT,{...filters,signal:'credit_consumption_to_grants'},()=> 'authority',vi.fn(),transport);expense.activate();credit.activate()
 try{await expense.select(ANOMALY_ID);await credit.select(ANOMALY_ID);expect(read).toHaveBeenCalledTimes(1);expect(credit.snapshot().retryAt).toBe(expense.snapshot().retryAt)}finally{expense.retire();credit.retire()}
})

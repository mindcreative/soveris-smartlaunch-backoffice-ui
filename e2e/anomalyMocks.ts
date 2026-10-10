import type {Page} from '@playwright/test'
import {anomalyItemFixture,anomalyPageFixture,anomalyHistoryMetadata,ANOMALY_ID,ANOMALY_CONFIG} from '../src/test/billingAnomaliesFixture'
import type {AnomalyFilters} from '../src/types/billingAnomalies'
import {ACTOR,CLIENT} from './reportMocks'
export async function installAnomalies(page:Page,options:{viewOnly?:boolean;ambiguous?:boolean}={}){
 let revision=0,status='open';const receipts=new Map<string,object>(),history:object[]=[];let lost=false
 await page.route('**/api/billing/anomalies**',async route=>{
  const request=route.request(),url=new URL(request.url()),client=url.searchParams.get('clientId')??CLIENT
  if(request.method()==='POST'){
   const r=request.postDataJSON();let receipt=receipts.get(r.operationId)
   if(!receipt){receipt={clientId:client,evaluationId:ANOMALY_ID,operationId:r.operationId,actorId:ACTOR,beforeStatus:status,status:r.action,beforeRevision:revision,revision:++revision,at:new Date().toISOString(),reason:r.reason,configVersion:r.configVersion,configHash:r.configHash,correlationId:'019a0000-0000-7000-8000-000000006609',routeVersion:null};receipts.set(r.operationId,receipt);history.unshift({...receipt,afterStatus:r.action});const t=history[0] as Record<string,unknown>;for(const key of ['clientId','evaluationId','status','configVersion','configHash'])delete t[key];status=r.action;if(options.ambiguous&&!lost){lost=true;await route.abort('timedout');return}}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(receipt)});return
  }
  if(url.pathname==='/api/billing/anomalies'){
   const f:AnomalyFilters={from:url.searchParams.get('from')!,to:url.searchParams.get('to')!,signal:url.searchParams.get('signal') as AnomalyFilters['signal'],currency:url.searchParams.get('currency'),configVersion:url.searchParams.get('configVersion'),ruleKey:url.searchParams.get('ruleKey'),ruleVersion:null,outcome:url.searchParams.get('outcome') as AnomalyFilters['outcome'],workflowStatus:url.searchParams.get('workflowStatus') as AnomalyFilters['workflowStatus'],owner:url.searchParams.get('owner'),policy:(url.searchParams.get('policy')??'current') as AnomalyFilters['policy'],pageSize:Number(url.searchParams.get('pageSize')??25)}
   await route.fulfill({contentType:'application/json',body:anomalyPageFixture(f,client)});return
  }
  const raw=`{"item":${anomalyItemFixture(client,'provider_expense',String(revision),status)},"history":${JSON.stringify(history)},"nextHistoryCursor":null,"canTransition":${!options.viewOnly},${JSON.stringify(anomalyHistoryMetadata()).slice(1,-1)}}`
  await route.fulfill({contentType:'application/json',body:raw})
 })
 return {receipts,history,ANOMALY_CONFIG}
}

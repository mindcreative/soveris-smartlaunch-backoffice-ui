import { stringify, LosslessNumber } from 'lossless-json'
import type { Page, Route } from '@playwright/test'
import { CREDIT_METRICS, CREDIT_METRICS as metrics } from '../src/test/billingReportsFixture'
export const CLIENT='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',CLIENT_B='ffffffff-1111-4222-8333-444444444444',ACTOR='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'
export const reportsPath=(client=CLIENT)=>`/billing/clients/${client}/reports`
const zero=JSON.parse(metrics.replace(/:(?:10\.0000|4\.0000|6\.0000|10|6|0\.40000000)/g,':0').replace('"consumptionToGrantRatio":0','"consumptionToGrantRatio":null').replace('"defined"','"zero_grants"'))
// This fixture keeps raw numeric tokens independent of the production adapter.
export function raw(value:unknown):string {return stringify(value,(_key,v)=>v instanceof Exact?new LosslessNumber(v.value):v)!}
class Exact {constructor(readonly value:string){}}
const n=(v:string|number)=>new Exact(String(v))
const decimalKeys=['grants','consumption','postedConsumption','adjustments','reversals','netActivity','holdsCreated','holdsClosed','holdNetActivity','releasedWithoutConsumption','unusedOnCommit','releases','usagePostingDifference','consumptionToGrantRatio']
function exactMetrics(value:Record<string,unknown>){return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decimalKeys.includes(k)&&v!==null?n(String(v)):v]))}
function creditMetrics(version:number,large=false){
 const m=JSON.parse(CREDIT_METRICS);m.grants=large?'9007199254740993.0001':version>1?'20.0000':'10.0000';m.netActivity=large?'9007199254740989.0001':version>1?'16.0000':'6.0000';m.consumptionToGrantRatio=large?'0.00000000':version>1?'0.20000000':'0.40000000';return exactMetrics(m)
}
function expenseMetrics(status:'unresolved'|'estimated'|'reconciled',amount:string|null,estimate:string|null=null,count=1){
 const unresolved=status==='unresolved',estimated=status==='estimated',reconciled=status==='reconciled'
 return {observationCount:n(count),unresolvedCount:n(unresolved?count:0),estimatedCount:n(estimated?count:0),reconciledCount:n(reconciled?count:0),withoutUsageCount:n(unresolved?count:0),withInvoiceCount:n(reconciled?count:0),missingAmountCount:n(unresolved?count:0),retainedEstimateCount:n(estimated||estimate!==null?count:0),retainedEstimatedExpense:estimate===null?(estimated?n(amount!):null):n(estimate),unreconciledEstimatedExpense:estimated?n(amount!):null,reconciledProviderExpense:reconciled?n(amount!):null,effectiveExpense:amount===null?null:n(amount),estimateSources:estimated||estimate!==null?[{source:'provider_response',observationCount:n(count),amount:n(estimate??amount!)}]:[],actualSources:reconciled?[{source:'manual_reconciliation',observationCount:n(count),amount:n(amount!)}]:[]}
}
function sumExpense(values:ReturnType<typeof expenseMetrics>[]) {
 const counts=['observationCount','unresolvedCount','estimatedCount','reconciledCount','withoutUsageCount','withInvoiceCount','missingAmountCount','retainedEstimateCount'] as const
 const amounts=['retainedEstimatedExpense','unreconciledEstimatedExpense','reconciledProviderExpense','effectiveExpense'] as const
 const result={} as ReturnType<typeof expenseMetrics>
 for(const key of counts) result[key]=n(values.reduce((s,m)=>s+BigInt(m[key].value),0n).toString())
 const scaled=(v:Exact)=>{const [whole,fraction='']=v.value.split('.');return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'))}
 const money=(v:bigint)=>n(`${v/10000n}.${(v%10000n).toString().padStart(4,'0')}`)
 for(const key of amounts) {const present=values.map(m=>m[key]).filter((v):v is Exact=>v!==null);result[key]=present.length?money(present.reduce((s,v)=>s+scaled(v),0n)):null}
 for(const key of ['estimateSources','actualSources'] as const){const entries=new Map<string,{count:bigint;amount:bigint}>();for(const m of values)for(const source of m[key]){const e=entries.get(source.source)??{count:0n,amount:0n};e.count+=BigInt(source.observationCount.value);e.amount+=scaled(source.amount);entries.set(source.source,e)}result[key]=[...entries].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([source,e])=>({source,observationCount:n(e.count.toString()),amount:money(e.amount)}))}
 return result
}

export async function installSession(page:Page,role='Admin') {await page.addInitScript(({client,actor,role})=>{const user={id:actor,clientId:client,role,email:'operator@example.test',displayName:'Operator',accessToken:'test-token',refreshToken:'test-refresh',expiresIn:3600};localStorage.setItem('backoffice_access_token','test-token');localStorage.setItem('backoffice_refresh_token','test-refresh');localStorage.setItem('backoffice-auth-persist',JSON.stringify({state:{accessToken:'test-token',refreshTokenValue:'test-refresh',user},version:0}))},{client:CLIENT,actor:ACTOR,role})}
function periods(from:string,to:string,grain:string){const result:{bucketStart:string;periodStart:string;periodEnd:string}[]=[];const date=new Date(from);date.setUTCHours(0,0,0,0);if(grain==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);if(grain==='month')date.setUTCDate(1);while(date.getTime()<Date.parse(to)){const start=date.toISOString();if(grain==='month')date.setUTCMonth(date.getUTCMonth()+1);else date.setUTCDate(date.getUTCDate()+(grain==='week'?7:1));result.push({bucketStart:start,periodStart:new Date(Math.max(Date.parse(start),Date.parse(from))).toISOString(),periodEnd:new Date(Math.min(date.getTime(),Date.parse(to))).toISOString()})}return result}
export function mockReports(){
 let version=1,sequence=0;const snapshots=new Map<string,{kind:string;client:string;filters:Record<string,any>;asOf:string;version:number;position:number}>();const requests:URL[]=[]
 let expenseCount=0,largeCredit=false,hostile=false,empty=false
 const expenseCache=new Map<string,{groups:any[];totals:any[]}>()
 const make=(kind:string,client:string,filters:Record<string,any>,asOf:string,snapshotVersion:number,position:number)=>{
  const calendar=periods(filters.from,filters.to,filters.groupBy);const pageSize=filters.pageSize;let totalRows=calendar.length,items:unknown[],base:Record<string,unknown>
  if(kind==='credit'){
   items=calendar.slice(position,position+pageSize).map((p,i)=>({...p,metrics:position+i===0&&!empty?creditMetrics(snapshotVersion,largeCredit):exactMetrics(zero)}));base={schemaVersion:1,clientId:client,unit:'abstract_credits',from:filters.from,to:filters.to,groupBy:filters.groupBy,timeZone:'UTC',asOf,provenance:{source:'immutable_ledger_and_usage',ledgerDateBasis:'created_at',usageDateBasis:'created_at',membership:'committed_first_page_snapshot',netBasis:'posted_owned_ledger_effects',consumptionBasis:'usage_records',ledgerEntryCount:n(empty?0:4),usageRecordCount:n(empty?0:1),unsettledUsageCount:n(0),unsettledUsageCredits:n(0)},totals:empty?exactMetrics(zero):creditMetrics(snapshotVersion,largeCredit)}
  }else{
   const cacheKey=JSON.stringify([filters,snapshotVersion,expenseCount,hostile,empty]);let cached=expenseCache.get(cacheKey)
   if(!cached){
   const provider=hostile?'<img src=x onerror=alert(1)>':'provider',model=hostile?'model '+ '🧭'.repeat(64):'model'
   const group=(currencyCode:string|null,status:'unresolved'|'estimated'|'reconciled',value:string|null,estimate:string|null=null,name=model)=>({...calendar[0],key:{currencyCode,provider:filters.dimensions.includes('provider')?provider:null,model:filters.dimensions.includes('model')?name:null,status:filters.dimensions.includes('status')?status:null,source:filters.dimensions.includes('source')?(status==='unresolved'?null:status==='estimated'?'provider_response':'manual_reconciliation'):null},metrics:{...expenseMetrics(status,value,estimate),withInvoiceCount:n(status==='reconciled'&&value!=='0.0000'?1:0)}})
   let groups=expenseCount?Array.from({length:expenseCount},(_,i)=>group('USD','reconciled','1.0000',null,String(i).padStart(5,'0'))):[group(null,'unresolved',null),group('EUR','reconciled','7.0000'),group('USD','estimated','2.0000'),group('USD','reconciled','3.0000','4.0000'),group('USD','reconciled','0.0000',null,'zero')]
   if(!expenseCount&&snapshotVersion>1){
     groups=[group('EUR','reconciled','7.0000'),group('EUR','reconciled','0.0000'),group('USD','reconciled','4.0000','2.0000'),group('USD','reconciled','3.0000','4.0000'),group('USD','reconciled','0.0000',null,'zero')]
   }
   const combined=new Map<string,typeof groups[number]>()
   for(const g of groups){const key=JSON.stringify(g.key),existing=combined.get(key);if(existing)existing.metrics=sumExpense([existing.metrics,g.metrics]);else combined.set(key,g)}
   groups=[...combined.values()].sort((a,b)=>{for(const key of ['currencyCode','provider','model','status','source'] as const){if(a.key[key]===b.key[key])continue;if(a.key[key]===null)return -1;if(b.key[key]===null)return 1;return a.key[key]!<b.key[key]!?-1:1}return 0})
   const currencyGroups=new Map<string|null,ReturnType<typeof expenseMetrics>[]>()
   for(const g of groups)currencyGroups.set(g.key.currencyCode,[...(currencyGroups.get(g.key.currencyCode)??[]),g.metrics])
   let totals=[...currencyGroups].map(([currencyCode,values])=>({currencyCode,metrics:sumExpense(values)}))
   if(empty||(filters.provider&&filters.provider!==provider)||(filters.model&&filters.model!==model)){groups=[];totals=[]}
   if(filters.currency){groups=groups.filter(g=>g.key.currencyCode===(filters.currency==='unknown'?null:filters.currency));totals=totals.filter(t=>t.currencyCode===(filters.currency==='unknown'?null:filters.currency))}
   cached={groups,totals};expenseCache.set(cacheKey,cached)
   }
   const {groups,totals}=cached
   totalRows=groups.length;items=groups.slice(position,position+pageSize);base={schemaVersion:1,clientId:client,unit:'provider_money',filters,timeZone:'UTC',asOf,provenance:{source:'provider_cost_records',accountingDateBasis:'captured_at',membership:'committed_first_page_revisions',sourceGroupingBasis:'actual_else_estimated',observationCount:n(totals.reduce((s,t)=>s+Number(t.metrics.observationCount.value),0)),unknownCurrencyCount:n(totals.filter(t=>t.currencyCode===null).length),missingAmountCount:n(totals.filter(t=>t.currencyCode===null).length)},totals}
  }
  let nextCursor:string|null=null
  if(position+pageSize<totalRows){nextCursor=`snapshot-${++sequence}-opaque+&`;snapshots.set(nextCursor,{kind,client,filters,asOf,version:snapshotVersion,position:position+pageSize})}
  return raw({...base,items,nextCursor})
 }
 const response=(url:URL)=>{
  const kind=url.pathname.endsWith('credit-activity')?'credit':'expense',client=url.searchParams.get('clientId')!;const cursor=url.searchParams.get('cursor')
  if(cursor){const snapshot=snapshots.get(cursor);if(!snapshot)throw new Error('Unknown test cursor');return make(snapshot.kind,snapshot.client,snapshot.filters,snapshot.asOf,snapshot.version,snapshot.position)}
  const q=url.searchParams;const filters:Record<string,any>={from:q.get('from')!,to:q.get('to')!,groupBy:q.get('groupBy')!,pageSize:Number(q.get('pageSize')??20)}
  if(kind==='expense')Object.assign(filters,{dimensions:(q.get('dimensions')??'currency,provider,model,status,source').split(','),currency:q.get('currency'),provider:q.get('provider'),model:q.get('model'),status:q.get('status'),source:q.get('source')})
  return make(kind,client,filters,new Date().toISOString(),version,0)
 }
 return {requests,response,setVersion:(v:number)=>version=v,maximum:(count:number)=>expenseCount=count,large:()=>largeCredit=true,hostile:()=>hostile=true,empty:()=>empty=true,install:async(page:Page,override?:(route:Route,url:URL,body:string)=>Promise<boolean>)=>{await page.route('**/api/billing/reports/*',async route=>{const url=new URL(route.request().url());requests.push(url);const body=response(url);if(override&&await override(route,url,body))return;await route.fulfill({status:200,contentType:'application/json',body,headers:{'cache-control':'no-store'}})})}}
}

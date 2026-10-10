import { isLosslessNumber, parse } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { CREDIT_FIELDS, EXPENSE_AMOUNTS, EXPENSE_COUNTS, REPORT_DIMENSIONS, REPORT_SOURCES, REPORT_STATUSES, type CreditMetrics, type CreditPage, type ExpenseFilters, type ExpenseKey, type ExpenseMetrics, type ExpensePage, type Period, type ReportFilters, type ReportKind, type ReportPage, type SourceTotal } from '../types/billingReports'

export class ReportContractError extends Error { constructor() { super('The report response could not be verified.'); this.name='ReportContractError' } }
export class ReportInputError extends Error {
  constructor(readonly field: string) { super('Check the report filter value.'); this.name='ReportInputError' }
}
const fail = (): never => { throw new ReportContractError() }
const input = (field:string):never => {throw new ReportInputError(field)}
type Obj = Record<string,unknown>
export function object(v:unknown):Obj {return v!==null && typeof v==='object' && !Array.isArray(v) ? v as Obj : fail()}
export function exact(v:Obj,keys:readonly string[]) {if(Object.keys(v).length!==keys.length || keys.some(k=>!Object.prototype.hasOwnProperty.call(v,k))) fail()}
export function list(v:unknown,max:number):unknown[] {return Array.isArray(v)&&v.length<=max?v:fail()}
export function str(v:unknown):string {return typeof v==='string'?v:fail()}
function constant<T extends string>(v:unknown,c:T):T {return v===c?c:fail()}
export function token(v:unknown,choices:readonly string[]):string {return typeof v==='string'&&choices.includes(v)?v:fail()}
const DECIMAL_MAX=79228162514264337593543950335n
export function decimal(v:unknown,scale=4,signed=false):string {
  if(!isLosslessNumber(v)) return fail()
  const s=v.toString()
  if(!new RegExp(`^${signed?'-?':''}(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`).test(s)) return fail()
  // .NET decimal coefficient is 96 bits; remove insignificant trailing zeros before checking.
  const coefficient=s.replace('-','').replace(/(\.\d*?)0+$/,'$1').replace('.','')||'0'
  if(BigInt(coefficient)>DECIMAL_MAX) return fail()
  return s.startsWith('-') && scaled(s,scale)===0n?s.slice(1):s
}
export function count(v:unknown):string {if(!isLosslessNumber(v)) return fail();const s=v.toString();return /^(0|[1-9]\d*)$/.test(s)&&BigInt(s)<=9223372036854775807n?s:fail()}
export function scaled(s:string,scale=4):bigint {const [a,b='']=s.replace('-','').split('.');return (BigInt(a)*10n**BigInt(scale)+BigInt(b.padEnd(scale,'0')))*(s.startsWith('-')?-1n:1n)}

// Validate calendar fields before Date normalization. Preserve all six fractional digits.
export function utcInstant(v:string):string {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v)
  if(!m) return input('from')
  const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number)
  const leap=y%4===0&&(y%100!==0||y%400===0)
  if(y<1||mo<1||mo>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]||h>23||mi>59||s>59||Number(m[10]??0)>14||Number(m[11]??0)>59||(m[10]==='14'&&m[11]!=='00')) return input('from')
  const base=Date.parse(`${v.slice(0,19)}${m[8]}`)
  if(!Number.isFinite(base)) return input('from')
  const date=new Date(base).toISOString().slice(0,19)
  if(!/^\d{4}-/.test(date)||date.startsWith('0000')) return input('from')
  return `${date}.${(m[7]??'').padEnd(6,'0')}Z`
}
export function instantMicros(v:string):bigint {const c=utcInstant(v);return BigInt(Date.parse(`${c.slice(0,19)}Z`))*1000n+BigInt(c.slice(20,26))}
export function responseInstant(v:unknown):string {try {const s=str(v);if(!s.endsWith('Z')&&!s.endsWith('+00:00')) return fail();return utcInstant(s)}catch{return fail()}}
function requestText(v:unknown,max:number,field:string):string|null {
  if(v===undefined||v===null) return null
  if(typeof v!=='string'||!v||/^\p{White_Space}|\p{White_Space}$/u.test(v)||[...v].length>max||/\p{Cc}/u.test(v)||/\p{Cs}/u.test(v)) return input(field)
  return v
}
export function normalizeReportFilters(kind:ReportKind,f:ReportFilters):ReportFilters & Partial<ExpenseFilters> {
  if(!f||typeof f!=='object') return input('from')
  const keys=['from','to','groupBy','pageSize',...(kind==='expense'?['dimensions','currency','provider','model','status','source']:[])]
  if(Object.keys(f).some(k=>!keys.includes(k))) return input('from')
  let from:string,to:string
  try {from=utcInstant(f.from)}catch{return input('from')}
  try {to=utcInstant(f.to)}catch{return input('to')}
  const duration=instantMicros(to)-instantMicros(from)
  if(duration<=0n||duration>366n*86400000000n) return input('to')
  if(!['day','week','month'].includes(f.groupBy)) return input('groupBy')
  const pageSize=f.pageSize??20
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100) return input('pageSize')
  const base={from,to,groupBy:f.groupBy,pageSize}
  if(kind==='credit') return base
  const dims=f.dimensions??REPORT_DIMENSIONS
  if(!Array.isArray(dims)||!dims.includes('currency')||new Set(dims).size!==dims.length||dims.some(d=>!REPORT_DIMENSIONS.includes(d))) return input('dimensions')
  const currency=f.currency??null,status=f.status??null,source=f.source??null
  if(currency!==null&&!/^(?:[A-Z]{3}|unknown)$/.test(currency)) return input('currency')
  if(status!==null&&!REPORT_STATUSES.includes(status as never)) return input('status')
  if(source!==null&&!REPORT_SOURCES.includes(source as never)) return input('source')
  return {...base,dimensions:REPORT_DIMENSIONS.filter(d=>dims.includes(d)),currency,status,source,provider:requestText(f.provider,64,'provider'),model:requestText(f.model,256,'model')}
}
export function buildReportQuery(kind:ReportKind,clientId:string,query:ReportFilters|{cursor:string}):URLSearchParams {
  if(canonicalizeGuid(clientId)!==clientId||clientId==='00000000-0000-0000-0000-000000000000') return input('clientId')
  const params=new URLSearchParams({clientId})
  if('cursor' in query){if(Object.keys(query).length!==1||typeof query.cursor!=='string'||!query.cursor.trim()||query.cursor.length>4096) return input('cursor');params.set('cursor',query.cursor);return params}
  const filters=normalizeReportFilters(kind,query)
  for(const [key,value] of Object.entries(filters)) if(value!==null&&value!==undefined) params.set(key,Array.isArray(value)?value.join(','):String(value))
  return params
}
function assertNoDuplicateObjectKeys(source: string): void {
  let index = 0
  const whitespace = () => { while (/\s/.test(source[index] ?? '')) index += 1 }
  const stringToken = (): string => {
    const start = index
    if (source[index++] !== '"') fail()
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue }
      if (source[index++] === '"') {
        try { return JSON.parse(source.slice(start, index)) as string }
        catch { return fail() }
      }
    }
    return fail()
  }
  const value = (): void => {
    whitespace()
    if (source[index] === '{') {
      index += 1; whitespace()
      const keys = new Set<string>()
      if (source[index] === '}') { index += 1; return }
      while (index < source.length) {
        const key = stringToken()
        if (keys.has(key)) fail()
        keys.add(key); whitespace()
        if (source[index++] !== ':') fail()
        value(); whitespace()
        if (source[index] === '}') { index += 1; return }
        if (source[index++] !== ',') fail()
        whitespace()
      }
      fail()
    }
    if (source[index] === '[') {
      index += 1; whitespace()
      if (source[index] === ']') { index += 1; return }
      while (index < source.length) {
        value(); whitespace()
        if (source[index] === ']') { index += 1; return }
        if (source[index++] !== ',') fail()
      }
      fail()
    }
    if (source[index] === '"') { stringToken(); return }
    const start = index
    while (index < source.length && !/[\s,}\]]/.test(source[index]!)) index += 1
    if (index === start) fail()
  }
  value(); whitespace()
  if (index !== source.length) fail()
}

export function payload(s:string):Obj {try{assertNoDuplicateObjectKeys(s);return object(parse(s,null,{onDuplicateKey:()=>fail()}))}catch{return fail()}}
export function cursor(v:unknown):string|null {return v===null?null:typeof v==='string'&&v.trim()&&v.length<=4096?v:fail()}
function common<T extends 'abstract_credits'|'provider_money'>(o:Obj,client:string,unit:T) {
  if(!isLosslessNumber(o.schemaVersion)||o.schemaVersion.toString()!=='1'||o.clientId!==client||canonicalizeGuid(client)!==client||client==='00000000-0000-0000-0000-000000000000') return fail()
  return {schemaVersion:1 as const,clientId:client,unit:constant(o.unit,unit),timeZone:constant(o.timeZone,'UTC'),asOf:responseInstant(o.asOf),nextCursor:cursor(o.nextCursor)}
}
export function creditMetrics(v:unknown):CreditMetrics {
  const o=object(v);exact(o,[...CREDIT_FIELDS,'consumptionToGrantRatio','ratioStatus'])
  const result={} as CreditMetrics
  for(const k of CREDIT_FIELDS) result[k]=decimal(o[k],4,['adjustments','reversals','netActivity','holdNetActivity','usagePostingDifference'].includes(k))
  result.consumptionToGrantRatio=o.consumptionToGrantRatio===null?null:decimal(o.consumptionToGrantRatio,8)
  result.ratioStatus=token(o.ratioStatus,['defined','zero_grants']) as CreditMetrics['ratioStatus']
  if((scaled(result.grants)===0n)!==(result.ratioStatus==='zero_grants')||(result.ratioStatus==='zero_grants')!==(result.consumptionToGrantRatio===null)) fail()
  if(scaled(result.netActivity)!==scaled(result.grants)-scaled(result.postedConsumption)+scaled(result.adjustments)+scaled(result.reversals)||scaled(result.holdNetActivity)!==scaled(result.holdsCreated)-scaled(result.holdsClosed)||scaled(result.releases)!==scaled(result.releasedWithoutConsumption)+scaled(result.unusedOnCommit)||scaled(result.usagePostingDifference)!==scaled(result.consumption)-scaled(result.postedConsumption)) fail()
  return result
}
function period(v:Obj,f:ReportFilters):Period {
  const bucketStart=responseInstant(v.bucketStart),periodStart=responseInstant(v.periodStart),periodEnd=responseInstant(v.periodEnd)
  const date=new Date(Date.parse(bucketStart));const next=new Date(date)
  if(date.getUTCHours()||date.getUTCMinutes()||date.getUTCSeconds()||instantMicros(bucketStart)%1000000n) fail()
  if(f.groupBy==='day') next.setUTCDate(next.getUTCDate()+1)
  if(f.groupBy==='week'){if(date.getUTCDay()!==1) fail();next.setUTCDate(next.getUTCDate()+7)}
  if(f.groupBy==='month'){if(date.getUTCDate()!==1) fail();next.setUTCMonth(next.getUTCMonth()+1)}
  const start=instantMicros(bucketStart),end=instantMicros(next.toISOString()),from=instantMicros(f.from),to=instantMicros(f.to)
  if(start>=to||end<=from||instantMicros(periodStart)!==(start>from?start:from)||instantMicros(periodEnd)!==(end<to?end:to)) fail()
  return {bucketStart,periodStart,periodEnd}
}
export function parseCreditActivity(raw:string,client:string,expected:ReportFilters):CreditPage {
  const o=payload(raw);exact(o,['schemaVersion','clientId','unit','from','to','groupBy','timeZone','asOf','provenance','totals','items','nextCursor'])
  const filters=normalizeReportFilters('credit',expected)
  const from=responseInstant(o.from),to=responseInstant(o.to)
  if(from!==filters.from||to!==filters.to||o.groupBy!==filters.groupBy) fail()
  const p=object(o.provenance);exact(p,['source','ledgerDateBasis','usageDateBasis','membership','netBasis','consumptionBasis','ledgerEntryCount','usageRecordCount','unsettledUsageCount','unsettledUsageCredits'])
  const provenance={source:constant(p.source,'immutable_ledger_and_usage'),ledgerDateBasis:constant(p.ledgerDateBasis,'created_at'),usageDateBasis:constant(p.usageDateBasis,'created_at'),membership:constant(p.membership,'committed_first_page_snapshot'),netBasis:constant(p.netBasis,'posted_owned_ledger_effects'),consumptionBasis:constant(p.consumptionBasis,'usage_records'),ledgerEntryCount:count(p.ledgerEntryCount),usageRecordCount:count(p.usageRecordCount),unsettledUsageCount:count(p.unsettledUsageCount),unsettledUsageCredits:decimal(p.unsettledUsageCredits)}
  if(BigInt(provenance.unsettledUsageCount)>BigInt(provenance.usageRecordCount)) fail()
  const items=list(o.items,filters.pageSize).map(v=>{const row=object(v);exact(row,['bucketStart','periodStart','periodEnd','metrics']);return {...period(row,filters),metrics:creditMetrics(row.metrics)}})
  const page={...common(o,client,'abstract_credits'),from,to,groupBy:filters.groupBy,provenance,totals:creditMetrics(o.totals),items}
  validateReportOrder(page);if(page.nextCursor&&!items.length) fail()
  return page
}
function currency(v:unknown):string|null {return v===null?null:typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:fail()}
function sources(v:unknown,allowed:string[]):SourceTotal[] {
  return list(v,allowed.length).map((v,i,a)=>{const o=object(v);exact(o,['source','observationCount','amount']);const source=token(o.source,allowed),observationCount=count(o.observationCount);if(observationCount==='0'||(i>0&&str(object(a[i-1]).source)>=source)) fail();return {source,observationCount,amount:decimal(o.amount)}})
}
export function expenseMetrics(v:unknown,code:string|null):ExpenseMetrics {
  const o=object(v);exact(o,[...EXPENSE_COUNTS,...EXPENSE_AMOUNTS,'estimateSources','actualSources'])
  const m={} as ExpenseMetrics
  for(const k of EXPENSE_COUNTS) m[k]=count(o[k])
  for(const k of EXPENSE_AMOUNTS) m[k]=o[k]===null?null:decimal(o[k])
  m.estimateSources=sources(o.estimateSources,['calculated_from_provider_pricing','provider_response']);m.actualSources=sources(o.actualSources,['manual_reconciliation','provider_billing_api','provider_response'])
  const n=BigInt(m.observationCount)
  if(n===0n||BigInt(m.unresolvedCount)+BigInt(m.estimatedCount)+BigInt(m.reconciledCount)!==n||EXPENSE_COUNTS.some(k=>BigInt(m[k])>n)||m.missingAmountCount!==m.unresolvedCount||BigInt(m.withInvoiceCount)>BigInt(m.reconciledCount)||BigInt(m.retainedEstimateCount)<BigInt(m.estimatedCount)) fail()
  const present=(value:string|null,contributors:bigint)=>{if((value===null)!==(contributors===0n)) fail()}
  present(m.retainedEstimatedExpense,BigInt(m.retainedEstimateCount));present(m.unreconciledEstimatedExpense,BigInt(m.estimatedCount));present(m.reconciledProviderExpense,BigInt(m.reconciledCount));present(m.effectiveExpense,n-BigInt(m.missingAmountCount))
  if(code===null&&(m.unresolvedCount!==m.observationCount||EXPENSE_AMOUNTS.some(k=>m[k]!==null))) fail()
  if(m.effectiveExpense!==null&&scaled(m.effectiveExpense)!==scaled(m.unreconciledEstimatedExpense??'0')+scaled(m.reconciledProviderExpense??'0')) fail()
  for(const [entries,amount,contributors] of [[m.estimateSources,m.retainedEstimatedExpense,m.retainedEstimateCount],[m.actualSources,m.reconciledProviderExpense,m.reconciledCount]] as const){if(entries.reduce((s,x)=>s+BigInt(x.observationCount),0n)!==BigInt(contributors)||entries.reduce((s,x)=>s+scaled(x.amount),0n)!==scaled(amount??'0')) fail()}
  return m
}
function storedText(v:unknown,max:number):string|null {return v===null?null:typeof v==='string'&&[...v].length<=max&&v.replace(/^ +| +$/g,'').length>0&&!/\p{Cs}/u.test(v)?v:fail()}
function expenseKey(v:unknown,f:ExpenseFilters):ExpenseKey {
  const o=object(v);exact(o,['currencyCode','provider','model','status','source'])
  const key={currencyCode:currency(o.currencyCode),provider:storedText(o.provider,64),model:storedText(o.model,256),status:o.status===null?null:token(o.status,REPORT_STATUSES),source:o.source===null?null:token(o.source,REPORT_SOURCES.filter(s=>s!=='unknown'))}
  for(const d of REPORT_DIMENSIONS.filter(d=>d!=='currency')){if(!f.dimensions.includes(d)&&key[d]!==null) fail();if(f.dimensions.includes(d)&&['provider','model','status'].includes(d)&&key[d]===null) fail()}
  for(const d of ['provider','model','status','source'] as const){const expected=f[d];if(f.dimensions.includes(d)&&expected!==null&&key[d]!==(expected==='unknown'&&d==='source'?null:expected)) fail()}
  return key
}
function responseFilters(v:unknown):ExpenseFilters {
  const o=object(v);exact(o,['from','to','groupBy','dimensions','currency','provider','model','status','source','pageSize'])
  if(!isLosslessNumber(o.pageSize)||!/^([1-9]\d{0,2})$/.test(o.pageSize.toString())) return fail()
  try {const f={...o,from:responseInstant(o.from),to:responseInstant(o.to),pageSize:Number(o.pageSize.toString())} as unknown as ExpenseFilters;const n=normalizeReportFilters('expense',f) as ExpenseFilters;if(JSON.stringify(n.dimensions)!==JSON.stringify(f.dimensions)) fail();return n}catch{return fail()}
}
export function parseProviderExpense(raw:string,client:string,expected:ReportFilters):ExpensePage {
  const o=payload(raw);exact(o,['schemaVersion','clientId','unit','filters','timeZone','asOf','provenance','totals','items','nextCursor'])
  const filters=responseFilters(o.filters),normalized=normalizeReportFilters('expense',expected)
  if(JSON.stringify(filters)!==JSON.stringify(normalized)) fail()
  const p=object(o.provenance);exact(p,['source','accountingDateBasis','membership','sourceGroupingBasis','observationCount','unknownCurrencyCount','missingAmountCount'])
  const provenance={source:constant(p.source,'provider_cost_records'),accountingDateBasis:constant(p.accountingDateBasis,'captured_at'),membership:constant(p.membership,'committed_first_page_revisions'),sourceGroupingBasis:constant(p.sourceGroupingBasis,'actual_else_estimated'),observationCount:count(p.observationCount),unknownCurrencyCount:count(p.unknownCurrencyCount),missingAmountCount:count(p.missingAmountCount)}
  const totals=list(o.totals,256).map(v=>{const t=object(v);exact(t,['currencyCode','metrics']);const currencyCode=currency(t.currencyCode);return {currencyCode,metrics:expenseMetrics(t.metrics,currencyCode)}})
  if(filters.currency!==null&&totals.some(t=>t.currencyCode!==(filters.currency==='unknown'?null:filters.currency))) fail()
  if(totals.reduce((s,t)=>s+BigInt(t.metrics.observationCount),0n)!==BigInt(provenance.observationCount)||totals.reduce((s,t)=>s+BigInt(t.metrics.missingAmountCount),0n)!==BigInt(provenance.missingAmountCount)||totals.filter(t=>t.currencyCode===null).reduce((s,t)=>s+BigInt(t.metrics.observationCount),0n)!==BigInt(provenance.unknownCurrencyCount)) fail()
  for(let i=1;i<totals.length;i++) if(compareText(totals[i-1].currencyCode,totals[i].currencyCode)>=0) fail()
  const items=list(o.items,filters.pageSize).map(v=>{const b=object(v);exact(b,['bucketStart','periodStart','periodEnd','key','metrics']);const key=expenseKey(b.key,filters);if(!totals.some(t=>t.currencyCode===key.currencyCode)) fail();return {...period(b,filters),key,metrics:expenseMetrics(b.metrics,key.currencyCode)}})
  const page={...common(o,client,'provider_money'),filters,provenance,totals,items}
  if((provenance.observationCount==='0')!==(totals.length===0)||(totals.length>0&&items.length===0)||page.nextCursor&&!items.length) fail()
  validateReportOrder(page);return page
}
// PostgreSQL UTF-8 C ordering is Unicode scalar order, not UTF-16 or locale collation.
export function compareText(a:string|null,b:string|null):number {
  if(a===b) return 0;if(a===null) return -1;if(b===null) return 1
  const aa=[...a].map(x=>x.codePointAt(0)!),bb=[...b].map(x=>x.codePointAt(0)!)
  for(let i=0;i<Math.min(aa.length,bb.length);i++) if(aa[i]!==bb[i]) return aa[i]-bb[i]
  return aa.length-bb.length
}
function compareRows(a:Period & {key?:ExpenseKey},b:Period & {key?:ExpenseKey}):number {
  const time=instantMicros(a.bucketStart)-instantMicros(b.bucketStart);if(time!==0n)return time<0n?-1:1
  if(a.key&&b.key) for(const k of ['currencyCode','provider','model','status','source'] as const){const c=compareText(a.key[k],b.key[k]);if(c)return c}
  return 0
}
export function validateReportOrder(page:ReportPage,previous?:ReportPage):void {
  const items=[...(previous?.items??[]),...page.items]
  if(items.length>(page.unit==='abstract_credits'?367:10000)) fail()
  for(let i=1;i<items.length;i++){if(compareRows(items[i-1],items[i])>=0)fail();if(page.unit==='abstract_credits'&&items[i-1].periodEnd!==items[i].periodStart) fail()}
}
export function appendReportPage<T extends ReportPage>(first:T,next:T):T {
  const envelope=(p:T)=>{const {items:_items,nextCursor:_cursor,...rest}=p;return JSON.stringify(rest)}
  if(envelope(first)!==envelope(next)||!next.items.length) fail()
  validateReportOrder(next,first)
  return {...first,items:[...first.items,...next.items],nextCursor:next.nextCursor} as T
}
export async function readBillingReport(kind:ReportKind,client:string,filters:ReportFilters,nextCursor?:string,signal?:AbortSignal):Promise<ReportPage> {
  const params=buildReportQuery(kind,client,nextCursor===undefined?filters:{cursor:nextCursor})
  const response=await apiClient.getApiRoot<string>(`/api/billing/reports/${kind==='credit'?'credit-activity':'provider-expenses'}`,{params,signal,responseType:'text',transformResponse:[v=>v],retryOnUnauthorized:false,timeout:30000})
  if(signal?.aborted) throw new DOMException('Cancelled','AbortError')
  if(response.status!==200||typeof response.data!=='string') throw new ReportContractError()
  return kind==='credit'?parseCreditActivity(response.data,client,filters):parseProviderExpense(response.data,client,filters)
}

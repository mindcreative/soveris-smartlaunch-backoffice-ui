import { useLayoutEffect, useRef, useState } from 'react'
import { normalizeReportFilters, ReportInputError } from '../../../api/billingReportsApi'
import { REPORT_DIMENSIONS, REPORT_SOURCES, REPORT_STATUSES, type ReportFilters as Filters, type ReportDimension } from '../../../types/billingReports'
import { FormErrorSummary, type FormFieldError } from '../../shared/FormErrorSummary'
export function defaultReportFilters():Filters {
  const to=new Date();to.setUTCHours(0,0,0,0);const from=new Date(to);from.setUTCDate(from.getUTCDate()-30)
  return normalizeReportFilters('credit',{from:from.toISOString(),to:to.toISOString(),groupBy:'day',pageSize:20})
}
interface Draft {from:string;to:string;groupBy:Filters['groupBy'];creditPageSize:string;expensePageSize:string;dimensions:ReportDimension[];currency:string;provider:string;model:string;status:string;source:string}
const draftFrom=(credit:Filters,expense:Filters):Draft=>({from:credit.from,to:credit.to,groupBy:credit.groupBy,creditPageSize:String(credit.pageSize),expensePageSize:String(expense.pageSize),dimensions:[...(expense.dimensions??REPORT_DIMENSIONS)],currency:expense.currency??'',provider:expense.provider??'',model:expense.model??'',status:expense.status??'',source:expense.source??''})
export function ReportFilters({credit,expense,onApply}:{credit:Filters;expense:Filters;onApply:(credit:Filters,expense:Filters)=>void}) {
  const [draft,setDraft]=useState(()=>draftFrom(credit,expense));const [errors,setErrors]=useState<FormFieldError[]>([])
  const [acceptedDraft,setAcceptedDraft]=useState(()=>JSON.stringify(draftFrom(credit,expense)))
  const errorRef=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{if(errors.length)errorRef.current?.focus()},[errors])
  const unapplied=JSON.stringify(draft)!==acceptedDraft
  const edit=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(d=>({...d,[key]:value}))
  const labels:Record<string,string>={from:'From (inclusive UTC)',to:'To (exclusive UTC)',groupBy:'UTC grain',creditPageSize:'Credit periods per page',expensePageSize:'Expense groups per page',currency:'Currency',provider:'Provider (exact match)',model:'Model (exact match)',status:'Cost status',source:'Effective source',dimensions:'Group expense by'}
  function apply(next:Draft){
    const failures:FormFieldError[]=[];let c:Filters|undefined,e:Filters|undefined
    for(const kind of ['credit','expense'] as const){try {
      const sizeKey=kind==='credit'?'creditPageSize':'expensePageSize'
      if(!/^\d+$/.test(next[sizeKey]))throw new ReportInputError(sizeKey)
      const base={from:next.from,to:next.to,groupBy:next.groupBy,pageSize:Number(next[sizeKey])}
      const normalized=normalizeReportFilters(kind,kind==='credit'?base:{...base,dimensions:next.dimensions,currency:next.currency||null,provider:next.provider||null,model:next.model||null,status:next.status||null,source:next.source||null})
      if(kind==='credit')c=normalized;else e=normalized
    }catch(error){let field=error instanceof ReportInputError?error.field:'from';if(field==='pageSize')field=kind==='credit'?'creditPageSize':'expensePageSize';if(!failures.some(x=>x.fieldId===`report-${field}`))failures.push({fieldId:`report-${field}`,label:labels[field],message:field==='to'?'Use a valid offset instant after From, within 366 days.':field==='from'?'Use a valid RFC3339 instant with Z or an explicit offset and at most six fractional digits.':field.includes('PageSize')?'Use an integer from 1 to 100.':'Use the exact allowed value; no surrounding whitespace or control characters.'})}}
    setErrors(failures);if(c&&e&&!failures.length){onApply(c,e);setAcceptedDraft(JSON.stringify(next))}
  }
  const errorFor=(name:string)=>errors.find(e=>e.fieldId===`report-${name}`)
  const textControl=(name:'from'|'to'|'currency'|'provider'|'model'|'creditPageSize'|'expensePageSize')=><div><label htmlFor={`report-${name}`}>{labels[name]}</label><input id={`report-${name}`} value={draft[name]} onChange={e=>edit(name,e.target.value)} required={['from','to','creditPageSize','expensePageSize'].includes(name)} inputMode={name.includes('PageSize')?'numeric':undefined} aria-invalid={!!errorFor(name)} aria-describedby={`${name==='from'||name==='to'?'report-utc-help':'report-exact-help'}${errorFor(name)?` report-${name}-error`:''}`}/>{errorFor(name)&&<p id={`report-${name}-error`} className="text-red-800">{errorFor(name)!.message}</p>}</div>
  const selectControl=(name:'groupBy'|'status'|'source',options:readonly string[])=><div><label htmlFor={`report-${name}`}>{labels[name]}</label><select id={`report-${name}`} value={draft[name]} onChange={e=>edit(name,e.target.value as never)}>{name!=='groupBy'&&<option value="">All</option>}{options.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div>
  return <form aria-label="Report filters" noValidate onSubmit={e=>{e.preventDefault();apply(draft)}} className="report-filters space-y-4">
    <h2 className="text-lg font-semibold">Report filters</h2>
    <p id="report-utc-help">UTC instants: inclusive From, exclusive To. Use Z or an explicit offset; up to six fractional digits. Maximum range 366 days. Weeks begin Monday in UTC.</p>
    <FormErrorSummary ref={errorRef} errors={errors}/>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{textControl('from')}{textControl('to')}{selectControl('groupBy',['day','week','month'])}{textControl('creditPageSize')}{textControl('expensePageSize')}</div>
    <fieldset id="report-dimensions" className="min-w-0"><legend>Group expense by</legend><div className="flex flex-wrap gap-3">{REPORT_DIMENSIONS.map(dim=><label key={dim} className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.dimensions.includes(dim)} disabled={dim==='currency'} onChange={e=>edit('dimensions',REPORT_DIMENSIONS.filter(x=>x===dim?e.target.checked:draft.dimensions.includes(x)))}/>{dim}{dim==='currency'?' (required)':''}</label>)}</div></fieldset>
    <p id="report-exact-help">Provider and model are exact, case-sensitive matches. No discovery or fuzzy search. A known currency excludes unknown-currency observations. Source means actual when reconciled, otherwise estimate, otherwise unknown.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{textControl('currency')}{textControl('provider')}{textControl('model')}{selectControl('status',REPORT_STATUSES)}{selectControl('source',REPORT_SOURCES)}</div>
    <p role="status">{unapplied?'Unapplied changes — displayed results retain their applied filters.':'Drafts match applied filters.'}</p>
    <div className="flex flex-wrap gap-3"><button type="submit">Apply filters</button><button type="button" onClick={()=>{const defaults=defaultReportFilters(),next=draftFrom(defaults,defaults);setDraft(next);apply(next)}}>Reset filters</button></div>
  </form>
}

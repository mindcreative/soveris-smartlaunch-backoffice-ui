import { useId, useState, type ReactNode } from 'react'
import { CreditAmount } from '../CreditAmount'
import type { CreditMetrics, Period, ReportFilters, ReportPage } from '../../../types/billingReports'

export const creditLabels:Record<keyof CreditMetrics,string>={grants:'Grants',consumption:'Consumption',postedConsumption:'Posted consumption',adjustments:'Adjustments',reversals:'Reversals',netActivity:'Net activity',holdsCreated:'Holds created',holdsClosed:'Holds closed',holdNetActivity:'Hold net activity',releasedWithoutConsumption:'Released without consumption',unusedOnCommit:'Unused on commit',releases:'Releases',usagePostingDifference:'Usage posting difference',consumptionToGrantRatio:'Consumption-to-grant ratio',ratioStatus:'Ratio status'}
export function CreditValue({value,ratio=false}:{value:string|null;ratio?:boolean}) {
  if(value===null)return <>Not defined — no grants in this period</>
  return ratio?<span className="font-mono">{value}</span>:<CreditAmount value={value} compact/>
}
export function Money({value,currency}:{value:string|null;currency:string|null}) {
  if(currency===null)return <>Not available — unknown currency</>
  return <span className="font-mono">{value===null?`Not available (${currency})`:`${value} ${currency}`}</span>
}
export function UtcTime({value}:{value:string}) {return <time dateTime={value} className="report-instant">{value.replace('T',' ').replace('Z',' UTC')}</time>}
export function PeriodLabel({period}:{period:Period}) {return <span className="block"><span className="block">Bucket: <UtcTime value={period.bucketStart}/></span><span className="block">Included: <UtcTime value={period.periodStart}/> to <UtcTime value={period.periodEnd}/> (exclusive)</span></span>}
export function DataViews({label,table,structured}:{label:string;table:ReactNode;structured:ReactNode}) {
  const id=useId();const [mode,setMode]=useState('auto')
  return <div className={`report-data report-view-${mode}`}><label htmlFor={id}>{label} data view</label><select id={id} value={mode} onChange={e=>setMode(e.target.value)}><option value="auto">Responsive</option><option value="structured">Structured list</option><option value="table">Table</option></select><div className="report-table-view">{table}</div><div className="report-structured-view">{structured}</div></div>
}
export interface MetricRow {label:string;value:ReactNode}
export function MetricList({rows}:{rows:MetricRow[]}) {return <dl className="report-metrics">{rows.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
export function MetricTable({rows,caption}:{rows:MetricRow[];caption:string}) {return <table className="report-metric-table"><caption>{caption}</caption><thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead><tbody>{rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody></table>}
export function ScrollTable({label,children}:{label:string;children:ReactNode}) {return <div role="region" aria-label={label} tabIndex={0} className="report-table-scroll">{children}</div>}
export function appliedSummary(filters:ReportFilters):string {
  return `${filters.groupBy} in UTC; ${filters.from} inclusive to ${filters.to} exclusive; ${filters.pageSize} per page.`
}
export function ReportProvenance({page,pageSize}:{page:ReportPage;pageSize:number}) {
  const filters=page.unit==='abstract_credits'?{from:page.from,to:page.to,groupBy:page.groupBy,pageSize}:page.filters
  return <div className="report-provenance"><p>Point-in-time snapshot as of <UtcTime value={page.asOf}/>.</p><p>Applied filters: {appliedSummary(filters)}</p>{page.unit==='provider_money'&&<>
    <p>Grouped dimensions: {page.filters.dimensions.join(', ')}.</p><dl className="report-metrics">{(['currency','provider','model','status','source'] as const).map(k=><div key={k}><dt>{k==='source'?'Effective source filter':`${k} filter`}</dt><dd>{page.filters[k]??'All'}</dd></div>)}</dl>{page.filters.currency&&page.filters.currency!=='unknown'&&<p>Known-currency filter excludes unknown-currency evidence.</p>}
  </>}
    <details><summary>Snapshot and accounting provenance</summary><MetricList rows={Object.entries(page.provenance).map(([label,value])=>({label:label.replace(/([A-Z])/g,' $1'),value:label==='unsettledUsageCredits'?<CreditValue value={value}/>:value}))}/><p>{page.unit==='abstract_credits'?'Ledger and usage use their own created_at accounting dates. Pending usage and posted debits may differ.':'Amounts use original captured_at; later reconciliation can restate that capture period only in a fresh report. Invoice presence is a count, with no invoice references.'}</p><p>Totals and provenance cover the full filtered window, including unloaded pages. Refresh starts a new snapshot; the other report keeps its own as-of.</p></details>
  </div>
}

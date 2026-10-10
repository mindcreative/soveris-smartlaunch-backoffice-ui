import { startTransition, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { canonicalizeGuid } from '../../lib/guid'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Forbidden } from '../../components/shared/ErrorDisplay'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { CreditActivityResults, ProviderExpenseResults } from '../../components/billing/reports/ReportResults'
import { ReportProvenance } from '../../components/billing/reports/ReportPresentation'
import { ReportState } from '../../components/billing/reports/ReportState'
import { defaultReportFilters, ReportFilters } from '../../components/billing/reports/ReportFilters'
import { useFrozenReport } from '../../queries/billingReportQueries'
import { retireReportScopes } from '../../queries/billingReportKeys'
import { clearPrivateBillingQueries } from '../../queries/billingQueries'
import { useQueryClient } from '@tanstack/react-query'
import { normalizeReportFilters } from '../../api/billingReportsApi'
import { apiClient, type AuthRefreshLifecycleDetail } from '../../api/apiClient'
import type { ReportFilters as Filters, ReportKind } from '../../types/billingReports'
import '../../components/billing/reports/reports.css'
import {AnomalyPanel} from '../../components/billing/anomalies/AnomalyPanel'
import {retireAnomalyScopes,hasAnomalyFilterBlock,useAnomalyFilterBlock} from '../../queries/billingAnomalyKeys'
export function reportAuthority():string {
  const s=useAuthStore.getState();return JSON.stringify([s.isInitialized,s.isLoading,s.isAuthenticated,s.user?.id,s.user?.clientId,s.user?.role,s.accessToken])
}
function ReportSection({kind,client,filters,deny}:{kind:ReportKind;client:string;filters:Filters;deny:(status:number)=>void}) {
  const report=useFrozenReport(kind,client,filters,reportAuthority,deny)
  const refreshButton=useRef<HTMLButtonElement>(null)
  const title=kind==='credit'?'Abstract-credit activity':'Provider expense by currency'
  return <section aria-label={title} aria-busy={report.busy} className="report-section state-indicator">
    <h2 className="text-xl font-semibold">{title}</h2>
    <button ref={refreshButton} type="button" aria-disabled={report.busy||(report.error?.retryAt??0)>Date.now()} onClick={()=>{if(!report.busy&&(report.error?.retryAt??0)<=Date.now())void report.refresh()}}>Refresh {kind==='credit'?'credit report':'expense report'}</button>

    {report.page&&<><ReportProvenance page={report.page} pageSize={filters.pageSize}/>{report.page.unit==='abstract_credits'?<CreditActivityResults page={report.page}/>:<ProviderExpenseResults page={report.page}/>}</>}
    <ReportState kind={kind} report={report} refreshButtonRef={refreshButton}/>
    <AnomalyPanel kind={kind} client={client} range={filters} authority={reportAuthority} deny={deny}/>
  </section>
}
function Workspace({client}:{client:string}) {
  const blocked=useAnomalyFilterBlock(client);const heading=useRef<HTMLHeadingElement>(null);const [denied,setDenied]=useState(false);const queries=useQueryClient()
  const [credit,setCredit]=useState<Filters>(defaultReportFilters);const [expense,setExpense]=useState<Filters>(()=>normalizeReportFilters('expense',defaultReportFilters()))
  const [creditEpoch,setCreditEpoch]=useState(0),[expenseEpoch,setExpenseEpoch]=useState(0)
  useLayoutEffect(()=>{heading.current?.focus()},[])
  const deny=(status:number)=>{
    retireAnomalyScopes();retireReportScopes();flushSync(()=>setDenied(true));void clearPrivateBillingQueries(queries)
    if(status===401)apiClient.clearAuthState()
  }
  const apply=(c:Filters,e:Filters)=>{
    if(hasAnomalyFilterBlock(client))return
    if(JSON.stringify(c)!==JSON.stringify(credit)){retireReportScopes(client,'credit');setCredit(c);setCreditEpoch(x=>x+1)}
    if(JSON.stringify(e)!==JSON.stringify(expense)){retireReportScopes(client,'expense');setExpense(e);setExpenseEpoch(x=>x+1)}
  }
  return <div className="billing-reports space-y-6"><nav aria-label="Breadcrumb"><span>Billing / Usage &amp; expense</span></nav><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">Usage &amp; expense</h1><p className="break-all">Selected Client: {client}</p><BillingWorkspaceNav clientId={client}/>
    {denied?<Forbidden message="Current report access is unavailable. Private report state was removed."/>:<>
    <p>Point-in-time reports are read-only. Anomaly investigation has separately authorized operator actions. Abstract Soveris credits and provider money are separate domains. Each report has its own snapshot; their as-of times may differ.</p>
    <ReportFilters credit={credit} expense={expense} onApply={apply} blocked={blocked}/>
    <ReportSection key={`credit:${creditEpoch}`} kind="credit" client={client} filters={credit} deny={deny}/>
    <ReportSection key={`expense:${expenseEpoch}`} kind="expense" client={client} filters={expense} deny={deny}/>
    </>}
  </div>
}
export function BillingReportsPage() {
  const {clientId:routeClient,evaluationId}=useParams();const client=canonicalizeGuid(routeClient);const location=useLocation()
  const auth=useAuth();const signature=reportAuthority()
  const [binding,setBinding]=useState({signature,epoch:0});const [restoring,setRestoring]=useState(false);const [cleared,setCleared]=useState(false)
  if(binding.signature!==signature)setBinding({signature,epoch:binding.epoch+1})
  useLayoutEffect(()=>{
    const refresh=(event:Event)=>{
      retireAnomalyScopes();retireReportScopes();flushSync(()=>{setRestoring(true);setBinding(b=>({...b,epoch:b.epoch+1}))})
      const pending=useAuthStore.getState().handleSuccessfulRefresh().then(()=>flushSync(()=>setRestoring(false)))
      ;(event as CustomEvent<AuthRefreshLifecycleDetail>).detail?.waitUntil(pending)
    }
    const clear=()=>{retireAnomalyScopes();retireReportScopes();flushSync(()=>setCleared(true))}
    const history=()=>{retireAnomalyScopes();retireReportScopes();startTransition(()=>setBinding(b=>({...b,epoch:b.epoch+1})))}
    window.addEventListener('popstate',history);window.addEventListener('auth:refreshed',refresh);window.addEventListener('auth:cleared',clear)
    return ()=>{window.removeEventListener('popstate',history);window.removeEventListener('auth:refreshed',refresh);window.removeEventListener('auth:cleared',clear)}
  },[])
  if(restoring||!auth.isInitialized||auth.isLoading)return <LoadingSpinner message="Re-establishing report authority…"/>
  if(cleared||!auth.isAuthenticated||!auth.hasPermission('billing:view')||!auth.user)return <Forbidden message="Current billing:view permission is required."/>
  if(!client||client==='00000000-0000-0000-0000-000000000000')return <Forbidden message="A valid Client context is required."/>
  if(auth.user.role!=='Admin'&&auth.user.clientId!==client)return <Forbidden message="This Client is outside your authorized report scope."/>
  if(routeClient!==client)return <Navigate to={`/billing/clients/${client}/reports${evaluationId?`/anomalies/${canonicalizeGuid(evaluationId)??evaluationId}`:''}`} replace/>
  return <Workspace key={`${binding.epoch}:${location.key}:${client}:${auth.user.id}:${auth.user.clientId}:${auth.user.role}`} client={client}/>
}

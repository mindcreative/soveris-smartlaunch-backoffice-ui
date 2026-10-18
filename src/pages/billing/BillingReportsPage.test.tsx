import { StrictMode } from 'react'
import { render,screen,waitFor,within,act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import App from '../../App'
import type {ReportPage, ReportKind} from '../../types/billingReports'
import {useAuthStore} from '../../stores/authStore'
import {queryClient} from '../../queryClient'
import * as anomalies from '../../api/billingAnomaliesApi'
import {ANOMALY_ID,anomalyDetailFixture} from '../../test/billingAnomaliesFixture'
import * as api from '../../api/billingReportsApi'
import {creditFixture,expenseFixture,REPORT_CLIENT,REPORT_RANGE} from '../../test/billingReportsFixture'
const B='ffffffff-1111-4222-8333-444444444444'
function session(role:'Admin'|'Viewer'='Admin'){useAuthStore.setState({accessToken:'token',refreshTokenValue:'refresh',isLoading:false,isAuthenticated:true,isInitialized:true,user:{id:'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa',clientId:REPORT_CLIENT,role,email:'test@example.test',displayName:'Operator',accessToken:'token',refreshToken:'refresh',expiresIn:3600}})}
describe('Usage & expense route',()=>{
 beforeEach(()=>{vi.restoreAllMocks();queryClient.clear();localStorage.clear();session();window.history.replaceState({},'',`/billing/clients/${REPORT_CLIENT}/reports`)})
 it('denies direct navigation before any report request',()=>{session('Viewer');const read=vi.spyOn(api,'readBillingReport');render(<App/>);expect(screen.getByText(/Current billing:view permission/)).toBeInTheDocument();expect(read).not.toHaveBeenCalled()})
 it('loads both sections under StrictMode, focuses route heading and preserves drafts',async()=>{
  const read=vi.spyOn(api,'readBillingReport').mockImplementation(async(kind,client,filters)=>{
   if(kind==='credit') {const page=api.parseCreditActivity(creditFixture(client),client,REPORT_RANGE);return {...page,from:api.utcInstant(filters.from),to:api.utcInstant(filters.to),items:page.items.map(i=>({...i,periodStart:api.utcInstant(filters.from)}))}}
   return {...api.parseProviderExpense(expenseFixture(client),client,REPORT_RANGE),filters:{...api.normalizeReportFilters('expense',filters)} as never}
  });render(<StrictMode><App/></StrictMode>);await waitFor(()=>expect(screen.getByText('Full-window credit totals')).toBeInTheDocument());expect(screen.getByRole('heading',{name:'Usage & expense'})).toHaveFocus()
  expect(screen.getByRole('link',{name:'Usage & expense'})).toHaveAttribute('aria-current','page')
  const form=screen.getByRole('form',{name:'Report filters'});const user=userEvent.setup();await user.clear(within(form).getByLabelText('Provider (exact match)'));await user.type(within(form).getByLabelText('Provider (exact match)'),'draft');expect(screen.getByText(/Unapplied changes/)).toBeInTheDocument();expect(screen.getByText('Full-window credit totals')).toBeInTheDocument();const before=read.mock.calls.length;await user.clear(within(form).getByLabelText('From (inclusive UTC)'));await user.click(within(form).getByRole('button',{name:'Apply filters'}));expect(screen.getByRole('alert')).toHaveFocus();expect(read.mock.calls.length).toBe(before)
 })
 it('a current denial clears both sections and late results never refill them',async()=>{
  let reject!:(e:unknown)=>void,resolve!:(p:ReportPage)=>void
  vi.spyOn(api,'readBillingReport').mockImplementation(kind=>kind==='expense'?new Promise((_,r)=>{reject=r}):new Promise(r=>{resolve=r}))
  render(<App/>);await waitFor(()=>expect(reject).toBeDefined());await act(async()=>reject({status:403}));expect(screen.getByRole('heading',{name:'Access denied'})).toBeInTheDocument();await act(async()=>resolve(api.parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE)));expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument()
 })
 it('token/role changes gate existing protected content synchronously',async()=>{
  vi.spyOn(api,'readBillingReport').mockImplementation(async kind=>kind==='credit'?api.parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE):api.parseProviderExpense(expenseFixture(),REPORT_CLIENT,REPORT_RANGE));render(<App/>);await waitFor(()=>expect(screen.getByText('Full-window credit totals')).toBeInTheDocument());act(()=>session('Viewer'));expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument();expect(screen.getByText(/Current billing:view permission/)).toBeInTheDocument()
 })
 it.each([
  {strict:false,returnToA:false}, {strict:false,returnToA:true},
  {strict:true,returnToA:false}, {strict:true,returnToA:true},
 ])('rejects old successes/denials even when transport ignores abort ($strict StrictMode, return to A $returnToA)',async({strict,returnToA})=>{
  type Pending={resolve:(v:ReportPage)=>void;reject:(e:unknown)=>void;client:string;kind:ReportKind;signal:AbortSignal;page:ReportPage}
  const pending:Pending[]=[]
  vi.spyOn(api,'readBillingReport').mockImplementation((kind,client,filters,_cursor,signal)=>new Promise((resolve,reject)=>{
   const page:ReportPage=kind==='credit'?api.parseCreditActivity(creditFixture(client),client,REPORT_RANGE):api.parseProviderExpense(expenseFixture(client),client,REPORT_RANGE)
   if(page.unit==='abstract_credits'){
    page.from=api.utcInstant(filters.from);page.to=api.utcInstant(filters.to)
    page.items=page.items.map(i=>({...i,periodStart:page.from}))
   }
   pending.push({resolve,reject,client,kind,signal:signal!,page})
  }))
  render(strict?<StrictMode><App/></StrictMode>:<App/>)
  const active=(client:string)=>pending.filter(r=>r.client===client&&!r.signal.aborted)
  const waitForPair=async(client:string)=>{await waitFor(()=>expect(active(client).map(r=>r.kind).sort()).toEqual(['credit','expense']))}
  const navigate=async(client:string)=>{act(()=>{window.history.pushState({},'',`/billing/clients/${client}/reports`);window.dispatchEvent(new PopStateEvent('popstate'))});await waitForPair(client)}
  await waitForPair(REPORT_CLIENT)
  const oldA=[...active(REPORT_CLIENT)]
  await navigate(B)
  const oldB=[...active(B)]
  if(returnToA)await navigate(REPORT_CLIENT)
  expect(oldA.every(r=>r.signal.aborted)).toBe(true)
  if(returnToA)expect(oldB.every(r=>r.signal.aborted)).toBe(true)
  // Resolve/reject the promises despite their aborted signals: cancellation
  // alone cannot make this pass if the report authority fence is broken.
  await act(async()=>{
   for(const r of pending.filter(r=>r.signal.aborted)){
    if(r.kind==='credit')r.resolve(r.page);else r.reject({status:401})
   }
  })
  expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument()
  expect(screen.queryByText('Full-window expense totals')).not.toBeInTheDocument()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(useAuthStore.getState().accessToken).toBe('token')
  expect(window.location.pathname).toBe(`/billing/clients/${returnToA?REPORT_CLIENT:B}/reports`)
  await act(async()=>{for(const r of active(returnToA?REPORT_CLIENT:B))r.resolve(r.page)})
  await waitFor(()=>expect(screen.getByText('Full-window credit totals')).toBeInTheDocument())
  expect(screen.getByText('Full-window expense totals')).toBeInTheDocument()
 })

})

it('canonicalizes uppercase Client deep links without losing the evaluation',async()=>{
 session();queryClient.clear();const detail=vi.spyOn(anomalies,'readAnomalyDetail').mockImplementation(async(client,id)=>anomalies.parseAnomalyDetail(anomalyDetailFixture(client),client,id));vi.spyOn(anomalies,'readAnomalies').mockRejectedValue({status:503});vi.spyOn(api,'readBillingReport').mockRejectedValue({status:503})
 window.history.replaceState({},'',`/billing/clients/${REPORT_CLIENT.toUpperCase()}/reports/anomalies/${ANOMALY_ID}`);render(<App/>);await waitFor(()=>expect(window.location.pathname).toBe(`/billing/clients/${REPORT_CLIENT}/reports/anomalies/${ANOMALY_ID}`));await waitFor(()=>expect(detail).toHaveBeenCalled());expect(detail.mock.calls[0].slice(0,2)).toEqual([REPORT_CLIENT,ANOMALY_ID])
})

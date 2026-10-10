import { StrictMode } from 'react'
import { render,screen,waitFor,within,act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import App from '../../App'
import type {CreditPage} from '../../types/billingReports'
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
  let reject!:(e:unknown)=>void,resolve!:(p:CreditPage)=>void
  vi.spyOn(api,'readBillingReport').mockImplementation(kind=>kind==='expense'?new Promise((_,r)=>{reject=r}):new Promise(r=>{resolve=r}))
  render(<App/>);await waitFor(()=>expect(reject).toBeDefined());await act(async()=>reject({status:403}));expect(screen.getByRole('heading',{name:'Access denied'})).toBeInTheDocument();await act(async()=>resolve(api.parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE)));expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument()
 })
 it('token/role changes gate existing protected content synchronously',async()=>{
  vi.spyOn(api,'readBillingReport').mockImplementation(async kind=>kind==='credit'?api.parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE):api.parseProviderExpense(expenseFixture(),REPORT_CLIENT,REPORT_RANGE));render(<App/>);await waitFor(()=>expect(screen.getByText('Full-window credit totals')).toBeInTheDocument());act(()=>session('Viewer'));expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument();expect(screen.getByText(/Current billing:view permission/)).toBeInTheDocument()
 })
 it('switch A→B→A rejects the first A success and errors even after abort',async()=>{
  const pending:{resolve:(v:CreditPage)=>void;reject:(e:unknown)=>void;client:string}[]=[]
  vi.spyOn(api,'readBillingReport').mockImplementation((_,client)=>new Promise((resolve,reject)=>pending.push({resolve,reject,client})))
  render(<App/>);await waitFor(()=>expect(pending.length).toBe(2));act(()=>{window.history.pushState({},'',`/billing/clients/${B}/reports`);window.dispatchEvent(new PopStateEvent('popstate'))});await waitFor(()=>expect(pending.length).toBe(4));act(()=>{window.history.pushState({},'',`/billing/clients/${REPORT_CLIENT}/reports`);window.dispatchEvent(new PopStateEvent('popstate'))});await waitFor(()=>expect(pending.length).toBe(6));await act(async()=>{pending[0].resolve(api.parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE));pending[1].reject({status:401})});expect(screen.queryByText('Full-window credit totals')).not.toBeInTheDocument();expect(useAuthStore.getState().isAuthenticated).toBe(true)
 })
})

it('canonicalizes uppercase Client deep links without losing the evaluation',async()=>{
 session();queryClient.clear();const detail=vi.spyOn(anomalies,'readAnomalyDetail').mockImplementation(async(client,id)=>anomalies.parseAnomalyDetail(anomalyDetailFixture(client),client,id));vi.spyOn(anomalies,'readAnomalies').mockRejectedValue({status:503});vi.spyOn(api,'readBillingReport').mockRejectedValue({status:503})
 window.history.replaceState({},'',`/billing/clients/${REPORT_CLIENT.toUpperCase()}/reports/anomalies/${ANOMALY_ID}`);render(<App/>);await waitFor(()=>expect(window.location.pathname).toBe(`/billing/clients/${REPORT_CLIENT}/reports/anomalies/${ANOMALY_ID}`));await waitFor(()=>expect(detail).toHaveBeenCalled());expect(detail.mock.calls[0].slice(0,2)).toEqual([REPORT_CLIENT,ANOMALY_ID])
})

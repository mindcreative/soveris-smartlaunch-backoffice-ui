import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { useAuthStore } from '../../stores/authStore'
import { queryClient } from '../../queryClient'
import { currentAuthorityFixture } from '../../test/authorityFixtures'
import { billingApi } from '../../api/billingApi'
import * as reports from '../../api/billingReportsApi'
import * as anomalies from '../../api/billingAnomaliesApi'
const CLIENT='01990000-0000-7000-8000-000000000002'
function session(permissions:string[], platformPermissions:string[]) {
  useAuthStore.getState().setTokens('fixture-token','fixture-refresh')
  useAuthStore.setState({isAuthenticated:true,isInitialized:true,isLoading:false,user:currentAuthorityFixture({permissions,platformPermissions})})
}
beforeEach(()=>{vi.restoreAllMocks();queryClient.clear();localStorage.clear()})
it('workspace credit reports never request provider or anomaly evidence even with dual authority', async()=>{
  session(['billing:view'],['platform:billing:view','platform:billing:reconcile'])
  const report=vi.spyOn(reports,'readBillingReport').mockRejectedValue({status:503})
  const anomaly=vi.spyOn(anomalies,'readAnomalies').mockRejectedValue({status:503})
  window.history.replaceState({},'',`/billing/clients/${CLIENT}/reports`);render(<App/>);
  await waitFor(()=>expect(report).toHaveBeenCalled())
  expect(report.mock.calls.every(([kind])=>kind==='credit')).toBe(true)
  expect(anomaly).not.toHaveBeenCalled()
  expect(screen.queryByText('Provider expense by currency')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Provider (exact match)')).not.toBeInTheDocument()
})
it('platform subscription read omits capabilities and command controls with only billing view', async()=>{
  session([],['platform:billing:view'])
  const capability=vi.spyOn(billingApi,'getClientCapabilities').mockRejectedValue({status:403})
  vi.spyOn(billingApi,'getSubscriptionState').mockResolvedValue({clientId:CLIENT,stateAsOf:'2026-10-21T00:00:00.000000',current:null,pendingChange:null,subscriptionHistory:[],grantHistory:{items:[],historyAsOf:'2026-10-21T00:00:00.000000',nextCursor:null}})
  vi.spyOn(billingApi,'getAccountSnapshot').mockResolvedValue({clientId:CLIENT,creditAccountId:CLIENT,ownedBalance:'0.0000',activelyReservedAmount:'0.0000',availableBalance:'0.0000',activeReservationCount:0,status:'active',asOf:'2026-10-21T00:00:00.000000',walletVersion:'1'})
  vi.spyOn(billingApi,'getResourceAccessConsequences').mockResolvedValue([])
  window.history.replaceState({},'',`/platform/clients/${CLIENT}/subscriptions`);render(<App/>);
  await screen.findByText(/No current subscription is configured/)
  expect(capability).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
  expect(screen.getByRole('link',{name:'My workspace'})).toBeInTheDocument()
})
it('denies a command-only operator before financial reads',()=>{
  session([],['platform:packages:manage'])
  const read=vi.spyOn(billingApi,'getSubscriptionState')
  window.history.replaceState({},'',`/platform/clients/${CLIENT}/subscriptions`);render(<App/>);
  expect(screen.getByRole('heading',{name:'Access denied'})).toBeInTheDocument()
  expect(read).not.toHaveBeenCalled()
})
it('workspace account suppresses adjustment controls for dual authority', async()=>{
  session(['billing:view'],['platform:billing:view','platform:billing:adjust'])
  vi.spyOn(billingApi,'getAccountSnapshot').mockResolvedValue({clientId:CLIENT,creditAccountId:CLIENT,ownedBalance:'0.0000',activelyReservedAmount:'0.0000',availableBalance:'0.0000',activeReservationCount:0,status:'active',asOf:'2026-10-21T00:00:00.000000',walletVersion:'1'})
  window.history.replaceState({},'',`/billing/clients/${CLIENT}/account`);render(<App/>);
  await screen.findByText('Active reservations')
  expect(screen.queryByRole('button',{name:'Adjust credits'})).not.toBeInTheDocument()
})

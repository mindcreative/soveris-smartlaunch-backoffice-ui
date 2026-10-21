import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { currentAuthorityFixture } from '../src/test/authorityFixtures'

const client='01990000-0000-7000-8000-000000000002'
const replacementId='01990000-0000-7000-8000-000000000088'
const accountPath=`/billing/clients/${client}/account`

async function prepare(context: BrowserContext, first: Page) {
  await context.route('**/api/backoffice/auth/current',route=>route.fulfill({json:currentAuthorityFixture({
    clientId:client,...(route.request().headers().authorization==='Bearer replacement-access'?{id:replacementId,displayName:'Replacement account'}:{})
  })}))
  await context.route('**/api/backoffice/auth/login',route=>route.fulfill({json:{
    accessToken:'replacement-access',refreshToken:'replacement-refresh',expiresIn:3600,
    user:currentAuthorityFixture({id:replacementId,clientId:client,displayName:'Replacement account'})
  }}))
  await context.route('**/api/backoffice/auth/revoke',route=>route.fulfill({status:204}))
  await context.route('**/api/backoffice/clients/*/billing/account',route=>route.fulfill({
    contentType:'application/json',headers:{'x-user-time-zone-revision':'1'},
    body:`{"creditAccountId":"01990000-0000-7000-8000-000000000010","clientId":"${client}","ownedBalance":${route.request().headers().authorization==='Bearer replacement-access'?'17.1250':'42.2500'},"activelyReservedAmount":0.0000,"availableBalance":0.0000,"activeReservationCount":0,"status":"active","asOf":"2026-10-20T08:00:00.000000","walletVersion":1}`
  }))
  await first.goto('/login')
  await first.evaluate(()=>{
    localStorage.setItem('backoffice_access_token','initial-access')
    localStorage.setItem('backoffice_refresh_token','initial-refresh')
    localStorage.setItem('backoffice-auth-persist',JSON.stringify({version:2,state:{accessToken:'initial-access',refreshTokenValue:'initial-refresh'}}))
  })
  await first.goto(accountPath)
  await expect(first.getByText('42.2500').first()).toBeVisible()
  const second=await context.newPage()
  await second.goto(accountPath)
  await expect(second.getByText('42.2500').first()).toBeVisible()
  return second
}

async function startLateResponse(page: Page, binary = false) {
  let release!: ()=>Promise<void>,entered!: ()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  await page.route(`**/api/backoffice/cross-tab-private${binary?'-binary':''}`,async route=>{
    await new Promise<void>(resolve=>{release=async()=>{await route.fulfill({json:{privateValue:'late private value'}});resolve()};entered()})
  })
  await page.evaluate(async(binary)=>{
    const path='/src/api/apiClient.ts'
    const {apiClient}=await import(path)
    const state=window as Window & {crossTabResult?:string;crossTabBinaryResult?:string}
    const result=(value:string)=>{if(binary)state.crossTabBinaryResult=value;else state.crossTabResult=value}
    void apiClient.get(`/cross-tab-private${binary?'-binary':''}`,{responseType:binary?'blob':'json'}).then(()=>result('accepted'),(error:{code:string})=>result(error.code))
  },binary)
  await started
  return release
}

test('another real tab logs out: retire private view and reject a late response',async({context,page})=>{
  const second=await prepare(context,page)
  const release=await startLateResponse(page)
  const releaseBinary=await startLateResponse(page,true)
  await second.evaluate(async()=>{const path='/src/stores/authStore.ts';const {useAuthStore}=await import(path);await useAuthStore.getState().logout()})
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible()
  await expect(page.getByText('42.2500')).toHaveCount(0)
  await release()
  await releaseBinary()
  await expect.poll(()=>page.evaluate(()=>(window as Window & {crossTabBinaryResult?:string}).crossTabBinaryResult)).toBe('AUTHORITY_CHANGED')
  await expect.poll(()=>page.evaluate(()=>(window as Window & {crossTabResult?:string}).crossTabResult)).toBe('AUTHORITY_CHANGED')
  await page.goBack()
  await expect(page.getByText('42.2500')).toHaveCount(0)
})

test('another real tab switches accounts: replacement authority gates requests and late responses',async({context,page})=>{
  const second=await prepare(context,page)
  const releaseLate=await startLateResponse(page)
  let releaseRefresh!:()=>void,refreshEntered!:()=>void
  const refreshStarted=new Promise<void>(resolve=>{refreshEntered=resolve}),refreshGate=new Promise<void>(resolve=>{releaseRefresh=resolve})
  await page.route('**/api/backoffice/refresh-trigger',route=>route.fulfill({status:401,json:{code:'authentication_required'}}))
  await page.route('**/api/backoffice/auth/refresh',async route=>{refreshEntered();await refreshGate;await route.fulfill({json:{accessToken:'obsolete-refresh-access',refreshToken:'obsolete-refresh-token',expiresIn:3600}})})
  await page.evaluate(async()=>{
    const path='/src/api/apiClient.ts';const {apiClient}=await import(path)
    void apiClient.get('/refresh-trigger').then(()=>{(window as Window & {refreshResult?:string}).refreshResult='accepted'},(error:{code:string})=>{(window as Window & {refreshResult?:string}).refreshResult=error.code})
  })
  await refreshStarted
  let releaseAuthority!:()=>void,entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  const validation=new Promise<void>(resolve=>{releaseAuthority=resolve})
  await page.route('**/api/backoffice/auth/current',async route=>{
    if(route.request().headers().authorization==='Bearer replacement-access') {
      entered();await validation
      await route.fulfill({json:currentAuthorityFixture({id:replacementId,clientId:client,displayName:'Replacement account'})})
    } else await route.fallback()
  })
  await second.evaluate(async()=>{const path='/src/stores/authStore.ts';const {useAuthStore}=await import(path);await useAuthStore.getState().login('replacement@example.test','synthetic-password')})
  await started
  await expect(page.getByText('42.2500')).toHaveCount(0)
  let protectedCalls=0
  await page.route('**/api/backoffice/validation-gated',route=>{protectedCalls++;return route.fulfill({json:{}})})
  const blocked=await page.evaluate(async()=>{
    const path='/src/api/apiClient.ts';const {apiClient}=await import(path)
    try {await apiClient.post('/validation-gated',{});return 'accepted'} catch(error) {return (error as {code:string}).code}
  })
  expect(blocked).toBe('AUTHORITY_CHANGED');expect(protectedCalls).toBe(0)
  await releaseLate()
  await expect.poll(()=>page.evaluate(()=>(window as Window & {crossTabResult?:string}).crossTabResult)).toBe('AUTHORITY_CHANGED')
  releaseRefresh()
  await expect.poll(()=>page.evaluate(()=>(window as Window & {refreshResult?:string}).refreshResult)).toBe('AUTHORITY_CHANGED')
  expect(await page.evaluate(()=>localStorage.getItem('backoffice_access_token'))).toBe('replacement-access')
  releaseAuthority()
  await expect.poll(()=>page.evaluate(async()=>{
    const path='/src/stores/authStore.ts';const {useAuthStore}=await import(path)
    return useAuthStore.getState().isAuthenticated?useAuthStore.getState().user?.id:null
  })).toBe(replacementId)
  // A real logout/login transition may already have redirected this tab to the
  // safe login page. Opening the workspace now uses only the verified account.
  await page.goto(accountPath)
  await expect(page.getByText('Replacement account').first()).toBeVisible()
  await expect(page.getByText('17.1250').first()).toBeVisible()
  await expect(page.getByText('42.2500')).toHaveCount(0)
})

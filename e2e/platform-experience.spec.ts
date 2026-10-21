import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installCurrentSession } from './currentSession'
import { currentAuthorityFixture } from '../src/test/authorityFixtures'
import { readFileSync } from 'node:fs'
const fixture=JSON.parse(readFileSync(new URL('../src/api/fixtures/health-v2.json',import.meta.url),'utf8'))
const client='01990000-0000-7000-8000-000000000002'
const foreign='01990000-0000-7000-8000-000000000099'

test('health-only operator uses separate shell; expiry, outage and fresh recovery are honest',async({page})=>{
  await installCurrentSession(page,{permissions:[],platformPermissions:['platform:health:view']})
  let calls=0,mode:'success'|'unavailable'='success'
  await page.route('**/api/backoffice/health',route=>{
    calls++
    const body=structuredClone(fixture)
    Object.assign(body.components.find(r=>r.alias==='api_process')!,{validForSeconds:1,ageSeconds:29})
    return route.fulfill({status:mode==='success'?200:503,json:mode==='success'?body:{error:'authorization_unavailable'}})
  })
  await page.goto('/platform/health')
  await expect(page.getByRole('heading',{name:'Platform System Health'})).toBeVisible()
  await expect(page.getByRole('link',{name:'My workspace'})).toBeVisible()
  await expect(page.getByText('Backoffice API process',{exact:true})).toBeVisible()
  await expect(page.getByText(/Stale|stale/).first()).toBeVisible()
  const initialCalls=calls
  await page.waitForTimeout(1200)
  expect(calls).toBe(initialCalls)
  await page.setViewportSize({width:320,height:780})
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
  mode='unavailable';await page.getByRole('button',{name:'Refresh health',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Current access unavailable'})).toBeVisible()
  await expect(page.getByText('Backoffice API process',{exact:true})).toHaveCount(0)
  mode='success';await page.getByRole('button',{name:'Verify access'}).click()
  await expect(page.getByText('Backoffice API process',{exact:true})).toBeVisible()
})

test('customer and command-only routes make no protected platform requests',async({page})=>{
  await installCurrentSession(page,{permissions:['products:view'],platformPermissions:[]})
  let protectedCalls=0
  await page.route('**/api/backoffice/health',route=>{protectedCalls++;return route.abort()})
  await page.route('**/api/backoffice/clients/**',route=>{protectedCalls++;return route.abort()})
  for(const path of ['/platform/health',`/platform/clients/${foreign}/account`,`/billing/clients/${client}/reports/anomalies/01990000-0000-7000-8000-0000000000aa`]) {
    await page.goto(path);await expect(page.getByRole('heading',{name:'Access denied'})).toBeVisible()
  }
  await expect(page.getByRole('link',{name:'Platform operations',exact:true})).toHaveCount(0)
  expect(protectedCalls).toBe(0)
})

test('platform target changes and workspace return discard held metadata responses',async({page})=>{
  await installCurrentSession(page,{permissions:[],platformPermissions:['platform:clients:view']})
  let release!:()=>void,started!:()=>void
  const entered=new Promise<void>(r=>{started=r}),gate=new Promise<void>(r=>{release=r})
  await page.route('**/api/backoffice/clients/*',async route=>{
    const id=route.request().url().split('/').pop()!
    if(id===client){started();await gate}
    await route.fulfill({json:{id,name:id===client?'retired-target-name':'Fresh target',status:1,clientClassification:'customer',classificationRevision:0,createdAt:'2026-10-21T00:00:00Z'}})
  })
  await page.goto(`/platform/clients/${client}`);await entered
  // Browser navigation exercises real history and cancels the old request.
  await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},`/platform/clients/${foreign}`)
  await expect(page.getByText('Fresh target',{exact:true})).toBeVisible()
  release();await expect(page.getByText('retired-target-name')).toHaveCount(0)
  await page.getByRole('link',{name:'My workspace'}).click()
  await expect(page.getByRole('heading',{name:'My workspace'})).toBeVisible()
  await expect(page.getByText('Fresh target')).toHaveCount(0)
  await page.goBack();await expect(page.getByText('Fresh target',{exact:true})).toBeVisible()
  await page.reload();await expect(page.getByText('Fresh target',{exact:true})).toBeVisible()
})

test('pending cold restoration keeps the saved theme in every frame in both shells',async({page})=>{
  const user=currentAuthorityFixture({permissions:[],platformPermissions:['platform:health:view']})
  await page.emulateMedia({colorScheme:'light'})
  const token='e30.'+Buffer.from(JSON.stringify({sub:user.id,exp:4102444800})).toString('base64url')+'.c2ln'
  await page.addInitScript(({token,id})=>{
    localStorage.setItem('backoffice_access_token',token);localStorage.setItem('backoffice_refresh_token','hint-refresh')
    localStorage.setItem('backoffice-auth-persist',JSON.stringify({version:2,state:{accessToken:token,refreshTokenValue:'hint-refresh'}}))
    localStorage.setItem(`soveris-smartlaunch-appearance:user:${id}`,'dark')
    const samples:string[]=[];(window as unknown as {themeFrames:string[]}).themeFrames=samples
    const sample=()=>{if(document.querySelector('#root')?.childElementCount)samples.push(document.documentElement.dataset.theme??'missing');requestAnimationFrame(sample)};requestAnimationFrame(sample)
  },{token,id:user.id})
  let release!:()=>void
  let gate=Promise.resolve()
  await page.route('**/api/backoffice/auth/current',async route=>{await gate;await route.fulfill({json:user})})
  await page.route('**/api/backoffice/health',route=>route.fulfill({json:fixture}))
  for(const path of ['/workspace-access','/platform/health']) {
    gate=new Promise<void>(r=>{release=r})
    await page.goto(path)
    await expect(page.getByText('Restoring your session…')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await page.evaluate(()=>(window as unknown as {themeFrames:string[]}).themeFrames)).not.toContain('light')
    release()
    await expect(page.getByText('Restoring your session…')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  }
})

test('same-origin platform tabs synchronously retire health inventory on logout',async({context,page})=>{
  const user=currentAuthorityFixture({permissions:[],platformPermissions:['platform:health:view']})
  await context.route('**/api/backoffice/auth/current',route=>route.fulfill({json:user}))
  await context.route('**/api/backoffice/auth/revoke',route=>route.fulfill({status:204}))
  await context.route('**/api/backoffice/health',route=>route.fulfill({json:fixture}))
  await page.goto('/login')
  await page.evaluate(()=>{
    localStorage.setItem('backoffice_access_token','platform-token');localStorage.setItem('backoffice_refresh_token','platform-refresh')
    localStorage.setItem('backoffice-auth-persist',JSON.stringify({version:2,state:{accessToken:'platform-token',refreshTokenValue:'platform-refresh'}}))
  })
  await page.goto('/platform/health');await expect(page.getByText('Backoffice API process',{exact:true})).toBeVisible()
  const other=await context.newPage();await other.goto('/platform/health');await expect(other.getByText('Backoffice API process',{exact:true})).toBeVisible()
  await other.getByRole('button',{name:/User menu:/}).click()
  await other.getByRole('menuitem',{name:'Logout',exact:true}).click()
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible()
  await expect(page.getByText('Backoffice API process',{exact:true})).toHaveCount(0)
  await page.goBack();await expect(page.getByText('Backoffice API process',{exact:true})).toHaveCount(0)
})

for(const role of ['Editor','Viewer'] as const)test(`${role} login chooses a permitted workspace landing without a Dashboard request`,async({page})=>{
  const user=currentAuthorityFixture({role,permissions:['products:view','submissions:view'],platformPermissions:[]})
  let dashboards=0
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/') && new URL(request.url()).pathname.endsWith('/dashboard'))dashboards++})
  await page.route('**/api/backoffice/auth/login',route=>route.fulfill({json:{user,accessToken:'landing-access',refreshToken:'landing-refresh',expiresIn:3600}}))
  await page.route('**/api/backoffice/auth/current',route=>route.fulfill({json:user}))
  await page.route('**/api/backoffice/clients/*/products*',route=>route.fulfill({json:{items:[],page:1,pageSize:20,totalCount:0,totalPages:0}}))
  await page.route('**/api/backoffice/clients/*/capabilities',route=>route.fulfill({status:503,json:{code:'projection_unavailable'}}))
  await page.goto('/dashboard')
  await page.getByLabel('Email address').fill('collaborator@example.test')
  await page.getByLabel('Password',{exact:true}).fill('isolated-fixture')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('heading',{name:'Products',exact:true})).toBeVisible()
  expect(dashboards).toBe(0)
  await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toHaveCount(0)
})

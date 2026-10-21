import { test,expect } from '@playwright/test'
// This lane is selected only by the supported owned Infrastructure browser runner.
// No route interception, fake sessions or positive-assurance adapters are used.
const enabled=process.env.PLATFORM_WORKSPACE_BROWSER==='1'
test.skip(!enabled,'Use DOMAINS_BROWSER_SMOKE=1 PLATFORM_WORKSPACE_BROWSER=1 with the canonical HTTP runner')
const qa=[['admin@soveris.com','0149620b-af5c-47c9-8290-95edde45ef8f'],['customer-admin@soveris.com','98b71ac3-7f62-4ac8-9b28-30444993a001'],['customer-b-owner@soveris.com','0199f001-0000-7000-8000-000000000002']]
for(const [email,client] of qa)test(`shipping workspace preserves Dashboard products and submissions for ${email}`,async({page})=>{
  let platformRequests=0
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/backoffice/health')platformRequests++})
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password',{exact:true}).fill('TestUser@123')
  const dashboard=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/backoffice/clients/${client}/dashboard`)
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  const response=await dashboard;expect(response.status()).toBe(200)
  expect(Object.keys(await response.json()).sort()).toEqual(['clientId','products','totalSubmissions','verifiedSubmissions'])
  await expect(page).toHaveURL(/\/dashboard$/)
  const products=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/backoffice/clients/${client}/products` && r.request().method()==='GET')
  await page.getByRole('link',{name:'Products',exact:true}).click();expect((await products).status()).toBe(200)
  await expect(page.getByRole('heading',{name:'Products',exact:true})).toBeVisible()
  const submissions=page.waitForResponse(r=>new URL(r.url()).pathname.replace(/\/$/,'')==='/api/backoffice/submissions' && r.request().method()==='GET')
  await page.getByRole('link',{name:'Submissions',exact:true}).click();expect((await submissions).status()).toBe(200)
  await expect(page.getByRole('heading',{name:'Submissions',exact:true})).toBeVisible()
  await page.reload();await expect(page.getByRole('heading',{name:'Submissions',exact:true})).toBeVisible()
  for(const target of [client===qa[0][1]?qa[1][1]:qa[0][1],'01990000-0000-7000-8000-0000000000ff']) {
    const denied=await page.evaluate(async target=>{const token=localStorage.getItem('backoffice_access_token');const r=await fetch(`/api/backoffice/clients/${target}/products`,{headers:{Authorization:`Bearer ${token}`}});return {status:r.status,noStore:r.headers.get('cache-control'),body:await r.text()}},target)
    expect(denied.status).toBe(403);expect(denied.noStore).toContain('no-store')
    expect(denied.body.includes('items')).toBe(false)
  }
  await page.goto('/platform/health');await expect(page.getByRole('heading',{name:'Access denied'})).toBeVisible()
  expect(platformRequests).toBe(0)
})

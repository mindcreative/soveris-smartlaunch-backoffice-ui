import { test, expect } from '@playwright/test'
import { installCurrentSession } from './currentSession'
import { currentAuthorityFixture } from '../src/test/authorityFixtures'
const client='01990000-0000-7000-8000-000000000002'
const foreign='01990000-0000-7000-8000-000000000099'

test('legacy persisted Admin and wildcard never open private pages', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('backoffice-auth-persist',JSON.stringify({version:0,state:{accessToken:'old-token',refreshTokenValue:'old-refresh',user:{role:'Admin',permissions:['*']}}})))
  const requests:string[]=[]
  await page.route(/\/api\/(?:backoffice|billing|ai)\//,route => {requests.push(route.request().url());return route.abort()})
  await page.goto('/products')
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible()
  expect(requests).toEqual([])
})

test('current Client administrator cannot fetch foreign billing or technical health', async ({page}) => {
  await installCurrentSession(page,{clientId:client,platformPermissions:[]})
  const privateRequests:string[]=[]
  await page.route('**/api/backoffice/clients/**',route => {privateRequests.push(route.request().url());return route.abort()})
  await page.goto(`/billing/clients/${foreign}/account`)
  await expect(page.getByText(/outside your current financial scope/)).toBeVisible()
  expect(privateRequests).toEqual([])
  await page.goto('/dashboard')
  await expect(page.getByRole('region',{name:'System Health'})).toHaveCount(0)
})

test('authority outage clears private values and requires fresh server verification', async ({page}) => {
  await installCurrentSession(page,{clientId:client})
  let denied=false
  await page.route('**/api/backoffice/clients/*/billing/account',route => route.fulfill({status:denied?503:200,contentType:'application/json',headers:{'x-user-time-zone-revision':'1'},body:denied?'{"code":"authorization_unavailable"}':`{"creditAccountId":"01990000-0000-7000-8000-000000000010","clientId":"${client}","ownedBalance":42.2500,"activelyReservedAmount":0.0000,"availableBalance":42.2500,"activeReservationCount":0,"status":"active","asOf":"2026-10-20T08:00:00.000000","walletVersion":1}`}))
  await page.goto(`/billing/clients/${client}/account`)
  await expect(page.getByText('42.2500').first()).toBeVisible()
  denied=true
  await page.getByRole('button',{name:'Refresh snapshot'}).click()
  await expect(page.getByRole('heading',{name:'Current access unavailable'})).toBeFocused()
  await expect(page.getByText('42.2500')).toHaveCount(0)
  await page.route('**/api/backoffice/auth/current',route => route.fulfill({json:currentAuthorityFixture({clientId:client,permissions:[],platformPermissions:[]})}))
  await page.getByRole('button',{name:'Verify access'}).click()
  await expect(page.getByText('42.2500')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Current access unavailable'})).toHaveCount(0)
})

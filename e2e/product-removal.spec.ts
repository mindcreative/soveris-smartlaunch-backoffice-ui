import { installCurrentSession } from './currentSession'
import { expect,test,type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { client,product,preview,receipt } from '../src/test/fixtures/productRemoval'
import { installTimeZoneRoute,fulfillLocal } from './localPresentationMocks'
async function setup(page:Page,mode:'success'|'unknown'|'denied'|'uncommitted'='success'){
 let deleted=false,stored:typeof receipt|null=null,deletes=0,refreshes=0
 await installCurrentSession(page, { clientId: client })
 await installTimeZoneRoute(page)
 await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/,async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method()
  if(path.endsWith('/me/timezone')){await route.fallback();return}
  let body:unknown={},status=200
  if(path.endsWith('/auth/refresh'))refreshes++
  if(path===`/api/backoffice/clients/${client}/products`)body={items:deleted?[]:[{id:product,clientId:client,name:'Product',slug:'product',status:'active',publicationStatus:'draft',revision:1,contentSchemaVersion:null,contentRevision:1,draftSchemaVersion:null,draftRevision:0,completeness:{isComplete:false,missingRequirements:[]},canonicalUrl:null,createdAt:'2026-10-17T12:00:00.000000',updatedAt:'2026-10-17T12:00:00.000000'}],page:1,pageSize:20,totalCount:deleted?0:1,totalPages:deleted?0:1}
  else if(path.endsWith('/removal-preview')){expect(route.request().headers()['x-product-client-id']).toBe(client);body=preview}
  else if(path===`/api/backoffice/products/${product}`&&method==='DELETE'){
   deletes++;const command=route.request().postDataJSON();expect(Object.keys(command).sort()).toEqual(['expectedRevision','operationId','policyVersion','previewFingerprint']);expect(command.expectedRevision).toBe(1);expect(command.previewFingerprint).toBe(preview.previewFingerprint)
   if(mode==='denied'){status=401;body={code:'authentication_required',title:'Authentication required'}}
   else if(mode==='uncommitted'&&deletes===1){status=503;body={code:'dependency_unavailable',title:'Request outcome unavailable'}}
   else{deleted=true;stored={...receipt,operationId:command.operationId,statusUrl:`/api/backoffice/clients/${client}/product-removals/${command.operationId}`};body=stored;if(mode==='unknown'){status=503;body={code:'dependency_unavailable',title:'Response lost after commit'}}}
  }
  else if(path===`/api/backoffice/clients/${client}/product-removals`)body={items:stored?[stored]:[],page:1,pageSize:20,totalCount:stored?1:0,totalPages:stored?1:0}
  else if(path.startsWith(`/api/backoffice/clients/${client}/product-removals/`)){body=stored??{code:'product_not_found',title:'No visible committed result'};if(!stored)status=404}
  else{await route.abort();return}
  await fulfillLocal(route,{status,contentType:status>=400?'application/problem+json':'application/json',body:JSON.stringify(body)})
 })
 return {deletes:()=>deletes,refreshes:()=>refreshes}
}
test('built confirmation is keyboard safe, accessible at 320 CSS px and restores stable focus after row removal',async({page},testInfo)=>{
 const state=await setup(page);await page.setViewportSize({width:320,height:900});await page.goto('/products')
 await page.getByRole('button',{name:'Remove Product',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete product permanently'})
 await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await expect(dialog.getByText(/no submissions or analytics records/)).toBeVisible()
 const targets=await dialog.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {name:button.getAttribute('aria-label')??button.textContent,width:r.width,height:r.height}}))
 expect(targets.every(target=>target.width>=44&&target.height>=44)).toBe(true)
 await testInfo.attach('target-sizes.json',{body:JSON.stringify({viewport:'320 CSS px',targets}),contentType:'application/json'})
 expect((await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(state.deletes()).toBe(0)
 await page.getByRole('button',{name:'Remove Product',exact:true}).click();await dialog.getByRole('button',{name:'Delete product permanently',exact:true}).click()
 await expect(dialog.getByRole('heading',{name:'Product deleted: Product'})).toBeVisible();await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('heading',{name:'Products',exact:true})).toBeFocused();expect(state.deletes()).toBe(1)
 await page.reload();await expect(page.getByRole('heading',{name:'Product deleted: Product'})).toBeVisible();expect(state.deletes()).toBe(1)
})
test('lost response recovers by retained GET after real reload without another DELETE',async({page})=>{
 const state=await setup(page,'unknown');await page.goto('/products');await page.getByRole('button',{name:'Remove Product',exact:true}).click();await page.getByRole('button',{name:'Delete product permanently',exact:true}).click()
 await expect(page.getByText(/Outcome unknown/)).toBeVisible();expect(state.deletes()).toBe(1)
 await page.reload();await expect(page.getByRole('heading',{name:'Product deleted: Product'})).toBeVisible();expect(state.deletes()).toBe(1)
})
test('401 never automatically replays a destructive request after authentication refresh',async({page})=>{
 const state=await setup(page,'denied');await page.goto('/products');await page.getByRole('button',{name:'Remove Product',exact:true}).click();await page.getByRole('button',{name:'Delete product permanently',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible()
 expect(state.deletes()).toBe(1);expect(state.refreshes()).toBe(0)
})

test('records local acknowledgement and pending-label latency on the actual built flow',async({browser},testInfo)=>{
 test.setTimeout(120000)
 const samples:Array<{ackMs:number;pendingMs:number}>=[]
 for(let index=0;index<20;index++){
  const page=await browser.newPage();await setup(page,'unknown');await page.goto('/products')
  await page.evaluate(()=>{
   const state={openAt:0,deleteAt:0,ackMs:-1,pendingMs:-1};(window as unknown as {feedback:typeof state}).feedback=state
   document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest('button');if(button?.textContent==='Remove Product')state.openAt=performance.now();if(button?.textContent==='Delete product permanently')state.deleteAt=performance.now()},true)
   new MutationObserver(()=>{if(state.openAt&&state.ackMs<0&&document.querySelector('[role="dialog"]'))state.ackMs=performance.now()-state.openAt
    if(state.deleteAt&&state.pendingMs<0&&[...document.querySelectorAll('[role="status"]')].some(node=>node.textContent?.includes('Checking or removing Product')))state.pendingMs=performance.now()-state.deleteAt
   }).observe(document.body,{childList:true,subtree:true,characterData:true})
  })
  await page.getByRole('button',{name:'Remove Product',exact:true}).click();await page.getByRole('button',{name:'Delete product permanently',exact:true}).click();await expect(page.getByText(/Outcome unknown/)).toBeVisible()
  samples.push(await page.evaluate(()=>{const f=(window as unknown as {feedback:{ackMs:number;pendingMs:number}}).feedback;return {ackMs:f.ackMs,pendingMs:f.pendingMs}}));await page.close()
 }
 const p95=(key:'ackMs'|'pendingMs')=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1]!
 await testInfo.attach('feedback-samples.json',{body:JSON.stringify({profile:'20 isolated Chromium pages; built Vite preview; mocked transport committed/lost response; DOM MutationObserver event-to-visible-state samples',browser:browser.version(),samples,p95AckMs:p95('ackMs'),p95PendingMs:p95('pendingMs')},null,2),contentType:'application/json'})
 expect(samples.every(s=>s.ackMs>=0&&s.pendingMs>=0)).toBe(true);expect(p95('ackMs')).toBeLessThanOrEqual(100);expect(p95('pendingMs')).toBeLessThanOrEqual(500)
})

test('text spacing, landscape, forced colours and reduced motion retain keyboard-reachable controls',async({page},testInfo)=>{
 await setup(page);await page.setViewportSize({width:900,height:420});await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await page.goto('/products')
 await page.addStyleTag({content:'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'})
 await page.getByRole('button',{name:'Remove Product',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete product permanently'});await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
 for(let index=0;index<8;index++){await page.keyboard.press('Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:testInfo.outputPath('landscape-forced-colours.png'),fullPage:true})
 await testInfo.attach('scope.json',{body:JSON.stringify({automated:['900x420 landscape viewport','WCAG text spacing','Chromium forcedColours emulation','reducedMotion emulation','keyboard containment'],manualStillOpen:['real virtual keyboard','actual 400% browser zoom','actual 200% text zoom','screen reader observation']}),contentType:'application/json'})
})


test('uncommitted unknown outcome survives reload and only explicit exact retry sends identical bytes',async({page})=>{
 const state=await setup(page,'uncommitted');const bodies:string[]=[]
 page.on('request',r=>{if(r.method()==='DELETE')bodies.push(r.postData()??'')})
 await page.goto('/products');await page.getByRole('button',{name:'Remove Product',exact:true}).click();await page.getByRole('button',{name:'Delete product permanently',exact:true}).click()
 await expect(page.getByText(/Outcome unknown/)).toBeVisible();await page.reload()
 await expect(page.getByText(/The earlier request outcome is unverified/)).toBeVisible();expect(state.deletes()).toBe(1)
 await page.getByRole('button',{name:'Remove Product',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete product permanently'})
 await expect(dialog.getByRole('button',{name:'Retry exact same request',exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Retry exact same request',exact:true}).click()
 await expect(dialog.getByRole('heading',{name:'Product deleted: Product'})).toBeVisible();expect(state.deletes()).toBe(2);expect(bodies[1]).toBe(bodies[0])
})

for (const unavailable of [false, true]) {
 test(`two ambiguous Products retain separate recovery after reload (session storage unavailable: ${unavailable})`, async ({ page }) => {
  await setup(page)
  if (unavailable) {
   await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    const getItem = Storage.prototype.getItem
    Storage.prototype.setItem = function (key, value) {
     if (this === sessionStorage) throw new Error('Session storage disabled for recovery proof')
     setItem.call(this, key, value)
    }
    Storage.prototype.getItem = function (key) {
     if (this === sessionStorage) throw new Error('Session storage disabled for recovery proof')
     return getItem.call(this, key)
    }
   })
  }
  const second = '01990000-0000-7000-8000-000000000099'
  const commands: Array<{ path: string; body: string }> = []
  const reads: string[] = []
  await page.route(/\/api\/backoffice\/(?!auth\/current(?:[?]|$)|auth\/revoke(?:[?]|$))/, async route => {
   const request = route.request()
   const path = new URL(request.url()).pathname
   let body: unknown
   let status = 200
   if (path === `/api/backoffice/clients/${client}/products`) {
    body = { items: [product, second].map((id, index) => ({
     id, clientId: client, name: index === 0 ? 'Product A' : 'Product B', slug: index === 0 ? 'product-a' : 'product-b',
     status: 'active', publicationStatus: 'draft', revision: 1, contentSchemaVersion: null, contentRevision: 1,
     draftSchemaVersion: null, draftRevision: 0, completeness: { isComplete: false, missingRequirements: [] }, canonicalUrl: null,
     createdAt: '2026-10-17T12:00:00.000000', updatedAt: '2026-10-17T12:00:00.000000',
    })), page: 1, pageSize: 20, totalCount: 2, totalPages: 1 }
   } else if (path.endsWith('/removal-preview')) {
    const id = path.split('/')[4]!
    body = { ...preview, productId: id, productName: id === product ? 'Product A' : 'Product B' }
   } else if (request.method() === 'DELETE') {
    commands.push({ path, body: request.postData()! })
    status = 503
    body = { code: 'dependency_unavailable', title: 'Outcome unavailable' }
   } else if (path.startsWith(`/api/backoffice/clients/${client}/product-removals/`)) {
    reads.push(path)
    status = 404
    body = { code: 'product_not_found', title: 'No visible committed result' }
   } else {
    await route.fallback()
    return
   }
   await fulfillLocal(route, { status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/products')
  const dialog = page.getByRole('dialog', { name: 'Delete product permanently' })
  for (const name of ['Product A', 'Product B']) {
   await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
   await dialog.getByRole('button', { name: 'Delete product permanently', exact: true }).click()
   await expect(dialog.getByText(/Outcome unknown/)).toBeVisible()
   await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  expect(commands).toHaveLength(2)
  expect(new URL(page.url()).searchParams.getAll('productRemoval')).toHaveLength(2)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Check earlier request', exact: true })).toHaveCount(2)
  expect(commands).toHaveLength(2)
  for (const command of commands) {
   const operationId = (JSON.parse(command.body) as { operationId: string }).operationId
   await expect.poll(() => reads.includes(`/api/backoffice/clients/${client}/product-removals/${operationId}`)).toBe(true)
  }
  await page.getByRole('button', { name: 'Remove Product A', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Delete product permanently', exact: true })).toHaveCount(0)
  if (unavailable) {
   await expect(dialog.getByRole('button', { name: 'Retry exact same request', exact: true })).toHaveCount(0)
   await dialog.getByRole('button', { name: 'Check retained status', exact: true }).click()
   await expect(dialog.getByText(/No visible committed result/)).toBeVisible()
   expect(commands).toHaveLength(2)
  } else {
   await dialog.getByRole('button', { name: 'Retry exact same request', exact: true }).click()
   await expect(dialog.getByText(/Outcome unknown/)).toBeVisible()
   expect(commands).toHaveLength(3)
   expect(commands[2]).toEqual(commands[0])
  }
 })
}

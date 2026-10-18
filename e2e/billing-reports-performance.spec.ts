import {expect,test} from '@playwright/test'
import {mockReports,installSession,reportsPath} from './reportMocks'
import {writeFile} from 'node:fs/promises'
import {cpus,platform,release} from 'node:os'

test.beforeEach(async({page})=>{await installSession(page)})

test('bounded maximum fixtures, labelled progress and local action responsiveness',async({page,browser},info)=>{
 test.setTimeout(120000)
 expect(info.project.metadata.appMode, 'Run with playwright.reports.config.ts or playwright.appearance.config.ts').toBe('production')
 const samples:Record<string,number[]>={draft:[],expand:[],refresh:[],apply:[],loadMore:[]}
 let progressMs:number|null=null
 try {
 const mock=mockReports();mock.maximum(9900);mock.large();await mock.install(page);await page.goto(reportsPath());await page.getByLabel('From (inclusive UTC)').fill('2024-01-01T12:00:00Z');await page.getByLabel('To (exclusive UTC)').fill('2025-01-01T12:00:00Z');await page.getByLabel('Credit periods per page').fill('100');await page.getByLabel('Expense groups per page').fill('100');await page.getByRole('button',{name:'Apply filters'}).click();const expense=page.getByRole('region',{name:'Provider expense by currency',exact:true}),credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await expect(expense.locator('p[id]').filter({hasText:/100 groups loaded/})).toBeVisible();await expect(credit.getByText('9,007,199,254,740,993.0001').first()).toBeVisible()
 for(let i=0;i<30;i++){
  samples.draft.push(await page.evaluate(()=>{const start=performance.now(),el=document.querySelector<HTMLInputElement>('#report-provider')!;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(el,'x'+start);el.dispatchEvent(new Event('input',{bubbles:true}));return new Promise<number>(resolve=>requestAnimationFrame(()=>resolve(performance.now()-start)))}))
  samples.expand.push(await page.evaluate(()=>{const start=performance.now();(Array.from(document.querySelectorAll('summary')).find(e=>e.textContent==='Provider expense definitions') as HTMLElement).click();return new Promise<number>(resolve=>requestAnimationFrame(()=>resolve(performance.now()-start)))}))
 }
 await page.getByLabel('Provider (exact match)').fill('');for(let i=0;i<30;i++){
  samples.loadMore.push(await expense.getByRole('button',{name:'Load more',exact:true}).evaluate(el=>{const start=performance.now();(el as HTMLButtonElement).click();return new Promise<number>(resolve=>requestAnimationFrame(()=>resolve(performance.now()-start)))}));await expect(expense).toHaveAttribute('aria-busy','false')
 }
 await expect(expense.locator('p[id]').filter({hasText:/3100 groups loaded/})).toBeVisible();expect(await expense.getByRole('table',{name:/Provider expense groups by UTC period/}).getByRole('rowheader').count()).toBe(100)
 for(let i=0;i<68;i++){await expense.getByRole('button',{name:'Load more',exact:true}).click();await expect(expense).toHaveAttribute('aria-busy','false')}
 await expect(expense.locator('p[id]').filter({hasText:/9900 groups loaded/})).toBeVisible();await expect(expense.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);await expense.getByRole('button',{name:'Later loaded groups'}).click();await expect(expense.getByText(/Showing loaded groups 101–200/)).toBeVisible()
 for(let i=0;i<30;i++){samples.refresh.push(await credit.getByRole('button',{name:'Refresh credit report'}).evaluate(el=>{const start=performance.now();(el as HTMLButtonElement).click();return new Promise<number>(resolve=>requestAnimationFrame(()=>resolve(performance.now()-start)))}));await expect(credit).toHaveAttribute('aria-busy','false')}
 for(let i=0;i<30;i++){await page.getByLabel('Credit periods per page').fill(i%2?'99':'100');samples.apply.push(await page.getByRole('button',{name:'Apply filters'}).evaluate(el=>{const start=performance.now();(el as HTMLButtonElement).click();return new Promise<number>(resolve=>requestAnimationFrame(()=>resolve(performance.now()-start)))}));await expect(credit).toHaveAttribute('aria-busy','false')}
 const p95=Object.fromEntries(Object.entries(samples).map(([k,s])=>[k,[...s].sort((a,b)=>a-b)[Math.ceil(s.length*.95)-1]]))
 // Delay transport to measure visible acknowledgement independent of mock/server latency.
 await page.route('**/api/billing/reports/credit-activity*',async route=>{await new Promise(r=>setTimeout(r,1000));await route.fulfill({status:200,body:mock.response(new URL(route.request().url())),contentType:'application/json'})});const started=Date.now();await credit.getByRole('button',{name:'Refresh credit report'}).click();await expect(credit.getByRole('status',{name:'Loading credit activity…'})).toBeVisible();progressMs=Date.now()-started
 for(const [action,value] of Object.entries(p95))expect(value, `${action} acknowledgement p95`).toBeLessThanOrEqual(100)
 expect(progressMs, 'labelled pending feedback').toBeLessThanOrEqual(500)
 } finally {
  // Persist partial samples and build identity even when a budget or flow fails.
  const p95=Object.fromEntries(Object.entries(samples).map(([k,s])=>[k,s.length?[...s].sort((a,b)=>a-b)[Math.ceil(s.length*.95)-1]:null]))
  const scripts=await page.locator('script[src]').evaluateAll(elements=>elements.map(el=>el.getAttribute('src'))).catch(()=>[])
  await writeFile(info.outputPath('responsiveness.json'),JSON.stringify({
   evidence:'production build / mocked HTTP, local action to next animation frame; no backend latency claim',
   fixture:'story64-bounded-v1: 367 credit periods, 100 page size, 9900 expense groups lazily traversed; 100 rendered',
   project:info.project.name,appMode:info.project.metadata.appMode,scripts,
   browser:browser.version(),os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,
   budgets:{acknowledgementP95Ms:100,pendingFeedbackMs:500},samples,p95,progressMs,
  },null,2))
 }

})

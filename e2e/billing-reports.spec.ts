import {expect,test,type Route} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mockReports,installSession,reportsPath,CLIENT,CLIENT_B} from './reportMocks'
import {writeFile} from 'node:fs/promises'
test.beforeEach(async({page})=>{await installSession(page)})
test('separate exact domains, full-window evidence, table semantics and equivalent responsive data',async({page})=>{
 const mock=mockReports();mock.hostile();await mock.install(page);await page.goto(reportsPath());const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true}),expense=page.getByRole('region',{name:'Provider expense by currency',exact:true});await expect(credit.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();await expect(expense.getByText('5.0000 USD',{exact:true}).first()).toBeVisible();await expect(expense.getByText('7.0000 EUR',{exact:true}).first()).toBeVisible();await expect(expense.getByText('Not available — unknown currency').first()).toBeVisible();await expect(expense.getByText('0.0000 USD',{exact:true}).first()).toBeAttached();await expect(expense.locator('img')).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Usage & expense',exact:true})).toBeFocused();await expect(credit.getByText('0.40000000',{exact:true}).first()).toBeVisible();await expect(credit.getByRole('table',{name:/Credit activity by UTC period/}).getByRole('rowheader')).toHaveCount(20)
 await credit.getByText('Credit definitions',{exact:true}).click();await expect(credit.getByText(/not current balance/)).toBeVisible();await expense.getByText('Provider expense definitions',{exact:true}).click()
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();expect(axe.violations).toEqual([])
 await page.setViewportSize({width:320,height:700});await expect(credit.getByRole('table',{name:/Credit activity by UTC period/})).not.toBeVisible();await credit.getByLabel('Credit periods data view').selectOption('structured');await credit.locator('.report-structured-view').last().locator('summary').first().click();await expect(credit.locator('.report-structured-view').last().getByText('0.40000000',{exact:true}).first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 for(const url of mock.requests){expect(url.pathname).toMatch(/^\/api\/billing\/reports\/(credit-activity|provider-expenses)$/)}
 const stored=await page.evaluate(()=>Object.entries(localStorage));expect(stored.map(([k])=>k).sort()).toEqual(['backoffice-auth-persist','backoffice_access_token','backoffice_refresh_token']);expect(JSON.stringify(stored)).not.toMatch(/snapshot-|retainedEstimatedExpense|effectiveExpense/)
})
test('draft validation links errors; expense-only apply preserves the credit traversal',async({page})=>{
 const mock=mockReports();await mock.install(page);await page.goto(reportsPath());await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();const firstCredit=mock.requests.filter(q=>q.pathname.endsWith('credit-activity')).length
 await page.getByLabel('Provider (exact match)').fill('draft');await expect(page.getByText(/Unapplied changes/)).toBeVisible();await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();await page.getByLabel('From (inclusive UTC)').fill('2025-02-29T00:00:00Z');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByRole('alert')).toBeFocused();await page.getByRole('alert').getByRole('link').first().click();await expect(page.getByLabel('From (inclusive UTC)')).toBeFocused()
 await page.getByLabel('From (inclusive UTC)').fill(mock.requests[0].searchParams.get('from')!);await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByText('No recorded provider-cost observations match these filters.',{exact:false})).toBeVisible();expect(mock.requests.filter(q=>q.pathname.endsWith('credit-activity'))).toHaveLength(firstCredit)
})
for(const pageSize of [1,20,100])test(`cursor-only continuation freezes totals and explicit refresh replaces (${pageSize})`,async({page})=>{
 const mock=mockReports();await mock.install(page);await page.goto(reportsPath());await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();await page.getByLabel('From (inclusive UTC)').fill('2024-01-01T00:00:00Z');await page.getByLabel('To (exclusive UTC)').fill('2024-05-01T00:00:00Z');await page.getByLabel('Credit periods per page').fill(String(pageSize));await page.getByRole('button',{name:'Apply filters'}).click();const section=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await expect(section.getByRole('button',{name:'Load more',exact:true})).toBeVisible();mock.setVersion(2);await section.getByRole('button',{name:'Load more',exact:true}).click();await expect(section.locator('p[id]').filter({hasText:`${Math.min(pageSize*2,121)} periods loaded;`})).toBeVisible();expect(mock.requests.filter(q=>q.searchParams.has('cursor')).every(q=>[...q.searchParams.keys()].sort().join(',')==='clientId,cursor')).toBe(true);await expect(section.getByText('0.40000000',{exact:true}).first()).toBeVisible();await section.getByRole('button',{name:'Refresh credit report'}).click();await expect(section.getByText('0.20000000',{exact:true}).first()).toBeVisible()
})
for (const destination of ['B', 'new A'] as const) test(`late A successes/errors cannot enter ${destination}, refresh authority or clear a newer session`, async ({page}, info) => {
 const mock = mockReports()
 type Held = {route: Route; body: string; client: string; kind: string; generation: number; settled: boolean}
 const held: Held[] = []
 let generation = 0, hold = true
 await mock.install(page, async (route, url, body) => {
  if (!hold) return false
  held.push({route, body, client: url.searchParams.get('clientId')!, kind: url.pathname.split('/').pop()!, generation, settled: false})
  return true
 })
 const current = () => held.filter(r => r.generation === generation && !r.settled && !r.route.request().failure())
 const waitForCurrent = async (client: string) => {
  // StrictMode may cancel and replace requests. Require one live request of
  // each kind in this navigation generation, not a cumulative network count.
  await expect.poll(() => current().map(r => `${r.client}:${r.kind}`).sort()).toEqual([
   `${client}:credit-activity`, `${client}:provider-expenses`,
  ])
 }
 const navigate = async (client: string) => {
  generation++
  await page.evaluate(client => {history.pushState({}, '', `/billing/clients/${client}/reports`); dispatchEvent(new PopStateEvent('popstate'))}, client)
  await waitForCurrent(client)
  await expect.poll(() => held.filter(r => r.generation < generation).every(r => r.route.request().failure()?.errorText === 'net::ERR_ABORTED')).toBe(true)
 }
 try {
  await page.goto(reportsPath())
  await waitForCurrent(CLIENT)
  mock.setVersion(2)
  await navigate(CLIENT_B)
  if (destination === 'new A') await navigate(CLIENT)
  const client = destination === 'B' ? CLIENT_B : CLIENT
  // Every obsolete request (including a cancelled StrictMode predecessor)
  // must be aborted; no two live requests of the same kind are tolerated.
  const obsolete = held.filter(r => r.generation < generation || r.route.request().failure())
  for (const request of obsolete) {
   expect(request.route.request().failure()?.errorText).toBe('net::ERR_ABORTED')
   await request.route.fulfill({status: request.kind === 'credit-activity' ? 200 : 401,
    body: request.kind === 'credit-activity' ? request.body : 'private stale error', contentType: 'application/json'})
   request.settled = true
  }
  await expect(page.getByRole('heading', {name: 'Full-window credit totals'})).toHaveCount(0)
  await expect(page.getByRole('heading', {name: 'Full-window expense totals'})).toHaveCount(0)
  await expect(page.getByText('private stale error')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(client + '/reports$'))
  expect(await page.evaluate(() => localStorage.getItem('backoffice_access_token'))).toBe('test-token')
  await waitForCurrent(client)
  for (const request of current()) {
   await request.route.fulfill({status: 200, body: request.body, contentType: 'application/json'})
   request.settled = true
  }
  await expect(page.getByRole('heading', {name: 'Full-window credit totals'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Full-window expense totals'})).toBeVisible()
  await expect(page.getByText('0.20000000', {exact: true}).first()).toBeVisible()
  await expect(page.getByText('0.40000000', {exact: true})).toHaveCount(0)
  hold = false
  mock.setVersion(1)
  await page.evaluate(async () => {const waits: Promise<void>[] = []; dispatchEvent(new CustomEvent('auth:refreshed', {detail: {waitUntil: (p: Promise<void>) => waits.push(p)}})); await Promise.all(waits)})
  await expect(page.getByText('0.40000000', {exact: true}).first()).toBeVisible()
  await page.evaluate(() => dispatchEvent(new Event('auth:cleared')))
  await expect(page.getByRole('heading', {name: 'Usage & expense', exact: true})).not.toBeVisible()
 } finally {
  await writeFile(info.outputPath('request-lifetimes.json'), JSON.stringify(held.map(r => ({
   client: r.client, kind: r.kind, generation: r.generation, settled: r.settled, failure: r.route.request().failure(),
  })), null, 2))
 }
})
test('transient continuation uses the same cursor; invalid/contract failures never append a new snapshot',async({page})=>{
 const mock=mockReports();let status=503,fail=true;await mock.install(page,async(route,url)=>{if(url.searchParams.has('cursor')&&fail){await route.fulfill({status,body:'private transport/server body',headers:{'Retry-After':'1'}});return true}return false});await page.goto(reportsPath());const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await credit.getByRole('button',{name:'Load more',exact:true}).click();await expect(credit.getByText(/Partial load/)).toBeVisible();expect(mock.requests.filter(u=>u.searchParams.has('cursor'))).toHaveLength(1);fail=false;await credit.getByRole('button',{name:'Retry loading more'}).click();await expect(credit.locator('p[id]').filter({hasText:/30 periods loaded/})).toBeVisible();const calls=mock.requests.filter(u=>u.searchParams.has('cursor'));expect(calls[0].searchParams.get('cursor')).toBe(calls[1].searchParams.get('cursor'));await expect(credit.getByText('End of credit activity results.')).toBeFocused()
 await credit.getByRole('button',{name:'Refresh credit report'}).click();fail=true;status=400;await credit.getByRole('button',{name:'Load more',exact:true}).click();await expect(credit.getByText(/Stale snapshot/)).toBeVisible();await expect(credit.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);await expect(page.getByText('private transport/server body')).toHaveCount(0)
 await credit.getByRole('button',{name:'Refresh credit report'}).click();status=500;await credit.getByRole('button',{name:'Load more',exact:true}).click();await expect(credit.getByRole('heading',{name:'Full-window credit totals'})).toHaveCount(0);await expect(page.getByRole('region',{name:'Provider expense by currency',exact:true}).getByRole('heading',{name:'Full-window expense totals'})).toBeVisible()
})
test('server denial removes both report sections and direct unauthorized navigation makes no report request',async({page,browser})=>{
 const mock=mockReports();let denied=false;await mock.install(page,async(route)=>{if(denied){await route.fulfill({status:403,body:'{"error":"Insufficient permissions"}'});return true}return false});await page.goto(reportsPath());await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();denied=true;await page.getByRole('button',{name:'Refresh expense report'}).click();await expect(page.getByRole('heading',{name:'Access denied'})).toBeFocused();await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toHaveCount(0)
 const other=await browser.newPage();await installSession(other,'Viewer');let requests=0;await other.route('**/api/billing/reports/*',async r=>{requests++;await r.abort()});await other.goto(reportsPath());await expect(other.getByText('Current billing:view permission is required.')).toBeVisible();expect(requests).toBe(0);await other.close()
})


test('forced colours, reduced motion, text spacing and orientation reflow simulations',async({page})=>{
 const mock=mockReports();mock.hostile();await mock.install(page);await page.goto(reportsPath());await expect(page.getByRole('heading',{name:'Full-window credit totals'})).toBeVisible();await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await page.addStyleTag({content:'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'})
 for(const size of [{width:320,height:700},{width:700,height:320},{width:320,height:250}]){await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Apply filters'})).toBeVisible()}
 await page.screenshot({path:test.info().outputPath('forced-colour-reflow.png'),fullPage:true})
})

test('expense reconciliation changes only an explicitly refreshed traversal and its original capture period',async({page})=>{
 const mock=mockReports();await mock.install(page);await page.goto(reportsPath());const expense=page.getByRole('region',{name:'Provider expense by currency',exact:true});await page.getByLabel('Expense groups per page').fill('1');await page.getByRole('button',{name:'Apply filters'}).click();await expect(expense.getByText('5.0000 USD',{exact:true}).first()).toBeVisible();const provenance=await expense.locator('.report-provenance').textContent();mock.setVersion(2);await expense.getByRole('button',{name:'Load more',exact:true}).click();await expect(expense.locator('p[id]').filter({hasText:/2 groups loaded/})).toBeVisible();await expect(expense.getByText('5.0000 USD',{exact:true}).first()).toBeVisible();expect(await expense.locator('.report-provenance').textContent()).toBe(provenance);await expense.getByRole('button',{name:'Refresh expense report'}).click();await expect(expense.getByText('7.0000 USD',{exact:true}).first()).toBeVisible();await expect(expense.getByText('Not available — unknown currency')).toHaveCount(0);await expect(page.getByRole('region',{name:'Abstract-credit activity',exact:true}).getByText('0.40000000',{exact:true}).first()).toBeVisible()
})
test('empty, malformed and thirty-second transport timeout states recover without private-body disclosure',async({page})=>{
 const mock=mockReports();mock.empty();await mock.install(page);await page.goto(reportsPath());await expect(page.getByText(/No recorded credit activity in this period/)).toBeVisible();await expect(page.getByText(/No recorded provider-cost observations match/)).toBeVisible();const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await page.route('**/api/billing/reports/credit-activity*',async route=>{await route.fulfill({status:200,body:'{"private":"bad contract body"}',contentType:'application/json'})});await credit.getByRole('button',{name:'Refresh credit report'}).click();await expect(credit.getByText(/could not be verified/)).toBeVisible();await expect(credit.getByRole('heading',{name:'Full-window credit totals'})).toHaveCount(0);await expect(page.getByText('bad contract body')).toHaveCount(0)
 await page.clock.install();let held:Route|undefined;await page.route('**/api/billing/reports/credit-activity*',async route=>{held=route});await credit.getByRole('button',{name:'Refresh credit report'}).click();await expect(credit.getByRole('status',{name:'Loading credit activity…'})).toBeVisible();await page.clock.fastForward(30001);await expect(credit.getByText(/report could not be loaded/)).toBeVisible();await expect(credit.getByRole('button',{name:'Try again'})).toBeEnabled();await held?.fulfill({status:200,body:mock.response(new URL(held.request().url())),contentType:'application/json'}).catch(()=>{});await expect(credit.getByRole('heading',{name:'Full-window credit totals'})).toHaveCount(0)
})


test('native keyboard validation, definitions, continuation, refresh and denial focus',async({page})=>{
 const mock=mockReports();let deny=false;await mock.install(page,async route=>{if(deny){await route.fulfill({status:403,body:'{"error":"Insufficient permissions"}'});return true}return false});await page.goto(reportsPath());await expect(page.getByRole('heading',{name:'Usage & expense',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Reconciliation',exact:true}).last()).toBeFocused()
 await page.getByLabel('From (inclusive UTC)').focus();await page.keyboard.press('Control+A');await page.keyboard.type('bad');await page.getByRole('button',{name:'Apply filters'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('alert')).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Enter');await expect(page.getByLabel('From (inclusive UTC)')).toBeFocused();await page.keyboard.press('Control+A');await page.keyboard.type('2024-01-01T00:00:00Z');await page.getByLabel('To (exclusive UTC)').focus();await page.keyboard.press('Control+A');await page.keyboard.type('2024-01-03T00:00:00Z');await page.getByLabel('Credit periods per page').focus();await page.keyboard.press('Control+A');await page.keyboard.type('1');await page.getByRole('button',{name:'Apply filters'}).focus();await page.keyboard.press('Enter');const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeVisible();await credit.locator('summary').filter({hasText:'Credit definitions'}).focus();await page.keyboard.press('Enter');await expect(credit.getByText(/not current balance/)).toBeVisible();await credit.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await expect(credit.getByText('End of credit activity results.')).toBeFocused();await credit.getByRole('button',{name:'Refresh credit report'}).focus();await page.keyboard.press('Enter');await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeVisible();deny=true;await credit.getByRole('button',{name:'Refresh credit report'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Access denied'})).toBeFocused()
})

test('review fixes preserve keyboard recovery and accepted normalized draft identity',async({page})=>{
 const mock=mockReports();let failure:503|429|400|500|null=503;let delayed=false;let release:(()=>void)|undefined
 await mock.install(page,async(route,url)=>{
  if(!url.searchParams.has('cursor'))return false
  if(failure){await route.fulfill({status:failure,body:'safe unavailable',headers:{'Retry-After':'1'}});return true}
  if(delayed){await new Promise<void>(resolve=>{release=resolve})}
  return false
 });await page.goto(reportsPath());const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true})
 await page.getByLabel('From (inclusive UTC)').fill('2024-01-01T01:00:00+01:00');await page.getByLabel('To (exclusive UTC)').fill('2024-01-05T00:00:00Z');await page.getByLabel('Credit periods per page').fill('01');await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByText('Drafts match applied filters.')).toBeVisible();await expect(page.getByLabel('From (inclusive UTC)')).toHaveValue('2024-01-01T01:00:00+01:00')
 await credit.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await expect(credit.getByRole('button',{name:'Retry loading more'})).toBeFocused();failure=null;delayed=true;await page.keyboard.press('Enter');await expect(credit.getByRole('button',{name:'Loading more…'})).toBeFocused();await expect(credit.getByRole('button',{name:'Loading more…'})).toHaveAttribute('aria-disabled','true');await expect.poll(()=>Boolean(release)).toBe(true);release!();await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeFocused()
 failure=429;delayed=false;await page.keyboard.press('Enter');await expect(credit.getByRole('status',{name:'Credit report recovery'})).toBeFocused();await expect(credit.getByRole('button',{name:'Retry loading more'})).toHaveAttribute('aria-disabled','true');await expect(credit.getByRole('button',{name:'Retry loading more'})).toHaveAttribute('aria-disabled','false');failure=400;await credit.getByRole('button',{name:'Retry loading more'}).focus();await page.keyboard.press('Enter');await expect(credit.getByRole('status',{name:'Credit report recovery'})).toBeFocused();await page.keyboard.press('Tab');await expect(credit.getByRole('button',{name:'Refresh report',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(credit.getByRole('button',{name:'Refresh credit report'})).toBeFocused();await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeVisible()
 failure=500;await credit.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await expect(credit.getByRole('status',{name:'Credit report recovery'})).toBeFocused();await page.keyboard.press('Tab');await expect(credit.getByRole('button',{name:'Try again'})).toBeFocused();await page.keyboard.press('Enter');await expect(credit.getByRole('button',{name:'Refresh credit report'})).toBeFocused()
})

for(const pending of [false,true])test(`fixed expiry preserves focus on a named stale status (pending=${pending})`,async({page})=>{
 await page.clock.install({time:new Date()});const mock=mockReports();let hold=false,release:(()=>void)|undefined;await mock.install(page,async(_route,url)=>{if(hold&&url.searchParams.has('cursor'))await new Promise<void>(resolve=>{release=resolve});return false});await page.goto(reportsPath());await page.getByLabel('Credit periods per page').fill('1');await page.getByRole('button',{name:'Apply filters'}).click();const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeVisible();await page.clock.fastForward(14*60000+59000);await credit.getByRole('button',{name:'Load more',exact:true}).focus()
 if(pending){hold=true;await page.keyboard.press('Enter');await expect.poll(()=>Boolean(release)).toBe(true)}
 await page.clock.fastForward(2000);await expect(credit.getByRole('status',{name:'Credit report continuation unavailable'})).toBeFocused();if(pending){release!();await expect(credit).toHaveAttribute('aria-busy','false');await expect(credit.locator('p[id]').filter({hasText:/2 periods loaded/})).toBeVisible();await expect(credit.getByRole('status',{name:'Credit report continuation unavailable'})).toBeFocused()}
 await expect(credit.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0)
})

test('successful non-final keyboard continuation retains focus through later idle expiry',async({page})=>{
 await page.clock.install({time:new Date()});const mock=mockReports();await mock.install(page);await page.goto(reportsPath());await page.getByLabel('Credit periods per page').fill('1');await page.getByRole('button',{name:'Apply filters'}).click();const credit=page.getByRole('region',{name:'Abstract-credit activity',exact:true});await credit.getByRole('button',{name:'Load more',exact:true}).focus();await page.keyboard.press('Enter');await expect(credit.locator('p[id]').filter({hasText:/2 periods loaded/})).toBeVisible();await expect(credit.getByRole('button',{name:'Load more',exact:true})).toBeFocused();await page.clock.fastForward(16*60000);await expect(credit.getByRole('status',{name:'Credit report continuation unavailable'})).toBeFocused()
})

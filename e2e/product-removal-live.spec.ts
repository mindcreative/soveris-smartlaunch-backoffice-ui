import {test,expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
test('built UI performs real preview, blocked cancellation, removal and full-reload retained recovery',async({page,request},info)=>{
 const file=process.env.PRODUCT_REMOVAL_BROWSER_FIXTURE_FILE;if(!file)throw new Error('Use supported HTTP runner PRODUCT_REMOVAL_BROWSER_SMOKE=1')
 const f=JSON.parse(await readFile(file,'utf8')) as {actorId:string;clientId:string;productId:string;blockedProductId:string;email:string}
 const login=await request.post((process.env.PRODUCT_REMOVAL_API_URL??'http://127.0.0.1:15067')+'/api/backoffice/auth/login',{data:{email:f.email,password:'TestUser@123'}});expect(login.status()).toBe(200)
 const auth=await login.json() as {accessToken:string;refreshToken:string}
 await page.addInitScript(({f,auth})=>{

  localStorage.setItem('backoffice_access_token',auth.accessToken);localStorage.setItem('backoffice_refresh_token',auth.refreshToken)
  localStorage.setItem('backoffice-auth-persist',JSON.stringify({state:{accessToken:auth.accessToken,refreshTokenValue:auth.refreshToken},version:2}))
 },{f,auth})
 let deletes=0;const safeResponses:Array<{path:string;status:number;body:unknown}>=[]
 page.on('request',r=>{if(r.method()==='DELETE'&&new URL(r.url()).pathname.includes('/products/'))deletes++})
 page.on('response',async r=>{const path=new URL(r.url()).pathname;if(path.endsWith('/removal-preview')||path.includes('/product-removals')){try{safeResponses.push({path,status:r.status(),body:await r.json()})}catch{/* response may be aborted on navigation */}}})
 await page.goto('/products')
 await page.getByRole('button',{name:'Remove Blocked removal Product',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Delete product permanently'})
 await expect(dialog.getByText('funnel events present. Archive preserves these records.')).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Delete product permanently',exact:true})).toBeDisabled()
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(deletes).toBe(0)
 await page.getByRole('button',{name:'Remove Live removal Product',exact:true}).click();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
 await dialog.getByRole('button',{name:'Delete product permanently',exact:true}).click()
 await expect(dialog.getByRole('heading',{name:'Product deleted: Live removal Product'})).toBeVisible()
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('heading',{name:'Products',exact:true})).toBeFocused()
 await expect(page.getByRole('button',{name:'Remove Live removal Product',exact:true})).toHaveCount(0)
 await page.reload();await expect(page.getByRole('heading',{name:'Product deleted: Live removal Product'})).toBeVisible();expect(deletes).toBe(1)
 expect(safeResponses.some(r=>r.path.endsWith('/removal-preview')&&r.status===200)).toBe(true)
 await writeFile(info.outputPath('live-removal-summary.json'),JSON.stringify({result:'pass',profile:'built UI to real isolated API/PostgreSQL; no HTTP mocks',deleteRequests:deletes,checks:['analytics independently blocks','Cancel sends no DELETE','safe Cancel focus','physical removal result','stable list focus','row absent','full reload retained GET; no destructive replay'],safeResponses},null,2))
})

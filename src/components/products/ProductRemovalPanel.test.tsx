import { viewerFixturePermissions } from '../../test/authorityFixtures'
import { clientFixturePermissions } from '../../test/authorityFixtures'
import { useRef,useState } from 'react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach,expect,it,vi } from 'vitest'
import { ProductRemovalModal,ProductRemovalHistory } from './ProductRemovalPanel'
import { useAuthStore } from '../../stores/authStore'
import { productRemovalApi } from '../../api/productRemovalApi'
import { parseRemovalPreview,parseRemovalReceipt } from '../../api/productRemovalContracts'
import { client,product,preview,receipt } from '../../test/fixtures/productRemoval'
import { captureDomainScope } from '../../queries/domainScope'
import { clearRemovalMaterial } from '../../queries/productRemovalMaterial'
import type { Product } from '../../types/content'
const item={id:product,clientId:client,name:'Product',slug:'product',status:'active'} as Product
function wrapper(){const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});return function Wrapper({children}:{children:React.ReactNode}){return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>}}
function Host(){const heading=useRef<HTMLHeadingElement>(null),[open,setOpen]=useState(false);return <><h1 tabIndex={-1} ref={heading}>Products</h1><button onClick={()=>setOpen(true)}>Remove Product</button>{open&&<ProductRemovalModal clientId={client} product={item} onClose={()=>setOpen(false)} returnFocusRef={heading}/>}</>}
beforeEach(()=>{
 clearRemovalMaterial()
 window.history.replaceState({},'', '/products');vi.restoreAllMocks();useAuthStore.setState({user:{id:'01990000-0000-7000-8000-000000000005',clientId:client,role:'ClientAdmin', permissions: clientFixturePermissions, sessionId: '01990000-0000-7000-8000-000000000077',clientRoleId:'01990000-0000-7000-8000-000000000078',securityRevision:'1',email:'admin@example.test',displayName:'ClientAdmin',accessToken:'token',refreshToken:'refresh',expiresIn:3600},accessToken:'token',isAuthenticated:true,isInitialized:true,isLoading:false})
 vi.spyOn(productRemovalApi,'preview').mockResolvedValue(parseRemovalPreview(JSON.stringify(preview),client,product))
})
it('names consequences, initially focuses Cancel and returns focus to the stable list after deletion',async()=>{
 vi.spyOn(productRemovalApi,'remove').mockImplementation(async(_client,_product,command)=>({...parseRemovalReceipt(JSON.stringify(receipt),client),operationId:command.operationId}))
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'Cancel'})).toHaveFocus())
 expect(screen.getByText(/source repository is unaffected/)).toBeVisible()
 await user.click(screen.getByRole('button',{name:'Delete product permanently'}))
 expect(await screen.findByRole('heading',{name:'Product deleted: Product'})).toBeVisible()
 await user.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.getByRole('heading',{name:'Products'})).toHaveFocus())
 expect(productRemovalApi.remove).toHaveBeenCalledTimes(1)
})
it('keeps postcommit timezone errors ambiguous and never automatically resubmits',async()=>{
 vi.spyOn(productRemovalApi,'remove').mockRejectedValue({status:409,code:'time_zone_not_set',message:'Choose timezone'})
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}));await user.click(await screen.findByRole('button',{name:'Delete product permanently'}))
 expect(await screen.findByText(/Outcome unknown/)).toBeVisible();expect(screen.getByRole('button',{name:'Check retained status'})).toBeEnabled();expect(productRemovalApi.remove).toHaveBeenCalledTimes(1)
 window.dispatchEvent(new Event('auth:refreshed'));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(productRemovalApi.remove).toHaveBeenCalledTimes(1)
})
it('blocks either retained data dependency and offers truthful Archive guidance',async()=>{
 vi.spyOn(productRemovalApi,'preview').mockResolvedValue(parseRemovalPreview(JSON.stringify({...preview,hardDeleteAllowed:false,blockers:['funnel_events_present'],dependencies:{...preview.dependencies,funnelEvents:1}}),client,product))
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}));await screen.findByText(/funnel events present/)
 expect(screen.getByRole('button',{name:'Delete product permanently'})).toBeDisabled();expect(screen.getByText(/Archive unavailable/)).toBeVisible()
})
it('discovers retained history after unmount and full reload without issuing DELETE',async()=>{
 const remove=vi.spyOn(productRemovalApi,'remove')
 const list=vi.spyOn(productRemovalApi,'list').mockResolvedValue({items:[parseRemovalReceipt(JSON.stringify(receipt),client)],page:'1',pageSize:'20',totalCount:'1',totalPages:'1'})
 const first=render(<ProductRemovalHistory scope={captureDomainScope()}/>,{wrapper:wrapper()});expect(await screen.findByRole('heading',{name:'Product deleted: Product'})).toBeVisible();first.unmount()
 render(<ProductRemovalHistory scope={captureDomainScope()}/>,{wrapper:wrapper()});expect(await screen.findByRole('heading',{name:'Product deleted: Product'})).toBeVisible();expect(list).toHaveBeenCalledTimes(2);expect(remove).not.toHaveBeenCalled()
})

it('reopening an unknown operation after reload offers GET recovery without minting another command',async()=>{
 window.history.replaceState({},'',`/products?productRemoval=${receipt.operationId}&removedProduct=${product}`)
 const remove=vi.spyOn(productRemovalApi,'remove')
 vi.spyOn(productRemovalApi,'status').mockRejectedValue({status:404,code:'product_not_found'})
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}))
 expect(screen.queryByRole('button',{name:'Delete product permanently'})).not.toBeInTheDocument()
 await user.click(screen.getByRole('button',{name:'Check retained status'}));expect(await screen.findByText(/No visible committed result/)).toBeVisible();expect(remove).not.toHaveBeenCalled()
})

it.each(['logout','client','actor','role','token','history'] as const)('fences a late successful removal after %s changes without restoring private content',async(change)=>{
 let finish!:(value:ReturnType<typeof parseRemovalReceipt>)=>void
 const remove=vi.spyOn(productRemovalApi,'remove').mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}));await user.click(screen.getByRole('button',{name:'Delete product permanently'}));await waitFor(()=>expect(remove).toHaveBeenCalledTimes(1))
 const actor=useAuthStore.getState().user!
 if(change==='logout')useAuthStore.setState({user:null,accessToken:null,isAuthenticated:false})
 if(change==='client')useAuthStore.setState({user:{...actor,clientId:product}})
 if(change==='actor')useAuthStore.setState({user:{...actor,id:product}})
 if(change==='role')useAuthStore.setState({user:{...actor,role:'Viewer', permissions: viewerFixturePermissions}})
 if(change==='token')useAuthStore.setState({accessToken:'replacement-token'})
 if(change==='history')window.dispatchEvent(new PopStateEvent('popstate'))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 finish(parseRemovalReceipt(JSON.stringify(receipt),client));await new Promise(resolve=>setTimeout(resolve,0))
 expect(screen.queryByText(/Product deleted:/)).not.toBeInTheDocument();expect(screen.queryByText(/Outcome unknown/)).not.toBeInTheDocument();expect(remove).toHaveBeenCalledTimes(1)
})

it.each(['logout','client','role','refresh'] as const)('discards a late removal error after %s changes',async(change)=>{
 let fail!:(error:unknown)=>void
 const remove=vi.spyOn(productRemovalApi,'remove').mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject}))
 const user=userEvent.setup();render(<Host/>,{wrapper:wrapper()});await user.click(screen.getByRole('button',{name:'Remove Product'}));await user.click(screen.getByRole('button',{name:'Delete product permanently'}));await waitFor(()=>expect(remove).toHaveBeenCalledTimes(1))
 const actor=useAuthStore.getState().user!
 if(change==='logout')useAuthStore.setState({user:null,isAuthenticated:false})
 if(change==='client')useAuthStore.setState({user:{...actor,clientId:product}})
 if(change==='role')useAuthStore.setState({user:{...actor,role:'Viewer', permissions: viewerFixturePermissions}})
 if(change==='refresh')window.dispatchEvent(new Event('auth:refreshed'))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 fail({status:503,code:'dependency_unavailable',message:'Private old result'});await new Promise(resolve=>setTimeout(resolve,0))
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.queryByText(/Outcome unknown/)).not.toBeInTheDocument();expect(remove).toHaveBeenCalledTimes(1)
})

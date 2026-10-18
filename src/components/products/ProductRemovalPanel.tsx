import { useEffect,useId,useRef,useState,type RefObject } from 'react'
import { useQueries,useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { productRemovalApi } from '../../api/productRemovalApi'
import { removalPolicy,type RemovalCommand,type RemovalReceipt } from '../../api/productRemovalContracts'
import { clearRemovalLocator,readRemovalLocator,useRemovalLocators,writeRemovalLocator,removalOperationFromStatusUrl } from '../../queries/productRemovalLocator'
import { forgetRemovalMaterial,readRemovalMaterial,rememberRemovalMaterial } from '../../queries/productRemovalMaterial'
import { createUuidV7 } from '../../lib/uuidV7'
import type { Product } from '../../types/content'
import { useDomainScope,type DomainScope } from '../../queries/domainScope'
import { assertRemovalScope,blockRemovalScope,removalScopeCurrent,useRemovalAuthority,useRemovalHistory,useRemovalPreview } from '../../queries/productRemovalQueries'
import { productKeys } from '../../queries/productQueries'
import { hasRolePermission } from '../../auth/permissions'
import { useAuthStore } from '../../stores/authStore'
import { domainKeys } from '../../queries/domainQueries'
import { clientCapabilityKeys, clearPrivateClientScope } from '../../queries/billingQueries'
import { Modal } from '../shared/Modal'
import { SavedZoneTime } from '../../timezone/SavedZoneTime'
const button='min-h-11 rounded-md border border-control px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
function errorMessage(error:unknown){const e=error as ApiError;return e.code==='product_removal_blocked'?'Dependencies prevent deletion. Use Archive or resolve pending attachment work.':e.code==='stale_revision'||e.code==='removal_preview_stale'?'The Product or its dependencies changed. Refresh and review before confirming.':'The outcome could not be verified. Check retained removal status before retrying.'}
function Progress({receipt}:{receipt:RemovalReceipt}){
 const {assets,domains,assetState,domainState}=receipt.cleanup
 return <section aria-label="Product removal progress" className="space-y-3 rounded-md border border-control p-4">
  <h3 className="font-semibold">Product deleted: {receipt.productName}</h3>
  <p>Removed <SavedZoneTime value={receipt.removedAt}/>. Its page, saved content and drafts have been removed. Required operation, audit and financial history are retained.</p>
  <p role="status">Image cleanup: {assetState.replace(/_/g,' ')}. Domain cleanup: {domainState.replace(/_/g,' ')}.</p>
  <p>{assets.finalObjectsConfirmedAbsent} of {assets.finalObjectsTotal} final objects and {assets.stagingKeysConfirmedAbsent} of {assets.stagingKeysTotal} staging keys confirmed absent. {assets.bytesAwaitingAbsence} bytes remain counted.</p>
  <p>{domains.released} of {domains.total} domain obligations released. Hostnames remain reserved until their cleanup is confirmed. Product slots and deleted binding rows have been released separately.</p>
  {(assetState==='action_required'||domainState==='action_required')&&<p role="alert">Cleanup needs attention. Backend recovery may continue. Check status; no cancellation or cleanup Retry action is available.</p>}
 </section>
}
export function ProductRemovalHistory({ scope }: { scope: DomainScope }) {
 const [page, setPage] = useState(1)
 const query = useRemovalHistory(scope, page)
 const locators = useRemovalLocators()
 const recoveries = useQueries({ queries: locators.map(locator => ({
  queryKey: [...productKeys.client(scope.clientId), 'removal', scope.actorId, scope.generation, 'locator', locator.operationId],
  enabled: removalScopeCurrent(scope), retry: false, gcTime: 0,
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
   assertRemovalScope(scope, signal)
   const result = await productRemovalApi.status(scope.clientId, locator.operationId, signal)
   assertRemovalScope(scope, signal)
   if (result.productId !== locator.productId) throw new Error('Removal identity mismatch')
   return result
  },
 })) })
 const denied = [query.error, ...recoveries.map(recovery => recovery.error)]
  .some(error => [401, 403].includes((error as ApiError | null)?.status ?? 0))
 const queryClient = useQueryClient()
 useEffect(() => {
  if (denied) {
   blockRemovalScope(scope)
   void clearPrivateClientScope(queryClient, scope.clientId)
  }
 }, [denied, queryClient, scope.actorId, scope.clientId, scope.generation])
 if (denied || !removalScopeCurrent(scope)) return null
 const recovered = new Set(recoveries.flatMap(recovery => recovery.data ? [recovery.data.operationId] : []))
 return <section aria-labelledby="product-removal-history" className="space-y-3 rounded-lg border border-line bg-surface p-4">
  <h2 id="product-removal-history" className="text-lg font-semibold">Product removals</h2><p>Retained results are loaded from the server, including after a full reload. Product deletion and physical cleanup have separate outcomes.</p>
  <button className={button} onClick={() => void query.refetch()} disabled={query.isFetching}>Check removal status</button>
  {query.isLoading && <p role="status">Loading removal history…</p>}{query.error && <p role="alert">Removal history is unavailable. A missing Product does not prove removal or cleanup completed.</p>}
  {query.data?.items.length === 0 && <p>No visible committed removals at this read.</p>}
  {locators.map((locator, index) => {
   const recovery = recoveries[index]!
   return <div key={locator.operationId}>
    <h3 className="font-semibold">Recovery after navigation or reload</h3>
    {recovery.data ? <Progress receipt={recovery.data} /> : <p role="status">The earlier request outcome is unverified. A status 404 does not prove it cannot still commit.</p>}
    {recovery.data && recovery.error && <p role="alert">Deletion remains confirmed. Current cleanup status could not be refreshed; the last verified status is shown.</p>}
    <button className={button} disabled={recovery.isFetching} onClick={() => void recovery.refetch()}>Check earlier request</button>
   </div>
  })}
  {query.data?.items.filter(receipt => !recovered.has(receipt.operationId)).map(receipt => <Progress key={receipt.operationId} receipt={receipt} />)}
  {query.data && BigInt(query.data.totalPages) > 1n && <nav aria-label="Removal history pages"><button className={button} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous removals</button><span> Page {page} </span><button className={button} disabled={BigInt(page) >= BigInt(query.data.totalPages)} onClick={() => setPage(p => p + 1)}>Next removals</button></nav>}
 </section>
}
export function ProductRemovalModal({clientId,product,onClose,onArchive,returnFocusRef}:{clientId:string;product:Product;onClose:()=>void;onArchive?:(product:Product)=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 useRemovalAuthority()
 const scope=useDomainScope(),client=useQueryClient(),description=useId(),cancel=useRef<HTMLButtonElement>(null)
 const ownedScope=useRef(scope).current
 const authorized=removalScopeCurrent(ownedScope)&&ownedScope.generation===scope.generation&&removalScopeCurrent(scope)&&scope.clientId===clientId&&product.clientId===clientId
 const initialLocator=useRef(readRemovalLocator(product.id)).current
 const resuming=initialLocator?.productId===product.id
 const recoveryOperation=useRef(resuming?initialLocator?.operationId:undefined)
 const preview=useRemovalPreview(scope,product.id,authorized&&!resuming)
 const [receipt,setReceipt]=useState<RemovalReceipt|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[unknown,setUnknown]=useState(Boolean(resuming))
 const inFlight=useRef(false),command=useRef<RemovalCommand|null>(resuming&&initialLocator?readRemovalMaterial(clientId,product.id,initialLocator.operationId):null),controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 const previewError = preview.error as ApiError | null
 const previewRecovery = previewError?.code === 'product_removed' && previewError.status === 409
  ? removalOperationFromStatusUrl(clientId, previewError.problemDetails?.statusUrl) : null
 useEffect(() => {
  if (!authorized || !previewRecovery) return
  recoveryOperation.current = previewRecovery
  command.current = null
  writeRemovalLocator(previewRecovery, product.id)
  setUnknown(true)
  setError('This Product was removed. Check its retained removal status to verify the result and current cleanup.')
 }, [authorized, previewRecovery, product.id])
 function deny(){blockRemovalScope(scope);void clearPrivateClientScope(client,scope.clientId);onClose()}
 async function accept(result:RemovalReceipt){
  assertRemovalScope(scope)
  if (command.current) forgetRemovalMaterial(clientId, product.id, command.current.operationId)
  forgetRemovalMaterial(clientId, product.id, result.operationId)
  command.current = null
  recoveryOperation.current = result.operationId
  setReceipt(result);setUnknown(false);setError(null)
  client.removeQueries({queryKey:productKeys.detail(clientId,product.id)});client.removeQueries({queryKey:productKeys.content(clientId,product.id)})
  await Promise.all([client.invalidateQueries({queryKey:productKeys.listRoot(clientId)}),client.invalidateQueries({queryKey:[...productKeys.client(clientId),'removal']}),client.invalidateQueries({queryKey:clientCapabilityKeys.client(clientId)}),...(hasRolePermission(useAuthStore.getState().user?.role,'domains:view')?[client.invalidateQueries({queryKey:domainKeys.scope(scope)})]:[])])
 }
 async function check(){
  const operation=recoveryOperation.current??command.current?.operationId
  if(inFlight.current||!operation)return
  inFlight.current=true;setPending(true);controller.current=new AbortController()
  try{const result=await productRemovalApi.status(clientId,operation,controller.current.signal);assertRemovalScope(scope);if(result.productId!==product.id)throw new Error('Removal identity mismatch');await accept(result)}
  catch (e) {
   if (!removalScopeCurrent(scope)) return
   const api = e as ApiError
   if (api.status === 401 || api.status === 403) { deny(); return }
   if (receipt) {
    setError('Deletion remains confirmed. Current cleanup status could not be refreshed; the last verified status is shown.')
   } else {
    setUnknown(true)
    setError('No visible committed result is available at this read. The original request may still commit. Check again or retry the exact same request.')
   }
  }
  finally{inFlight.current=false;if(removalScopeCurrent(scope))setPending(false)}
 }
 async function remove(exactRetry=false){
  if(inFlight.current||!authorized)return
  if(!exactRetry){if(!preview.data?.hardDeleteAllowed||preview.isFetching)return;command.current={operationId:createUuidV7(),expectedRevision:preview.data.revision,policyVersion:removalPolicy,previewFingerprint:preview.data.previewFingerprint}}
  if(!command.current)return
  rememberRemovalMaterial(clientId,product.id,command.current)
  recoveryOperation.current=command.current.operationId
  writeRemovalLocator(command.current.operationId,product.id)
  inFlight.current=true;setPending(true);setError(null);controller.current=new AbortController()
  try{const result=await productRemovalApi.remove(clientId,product.id,command.current,controller.current.signal);assertRemovalScope(scope);if(result.productId!==product.id)throw new Error('Removal identity mismatch');await accept(result)}
  catch(e){
   if(!removalScopeCurrent(scope))return
   const api=e as ApiError
   if(api.status===401||api.status===403){deny();return}
   if(['stale_revision','removal_preview_stale','product_removal_blocked'].includes(api.code)){if(command.current){clearRemovalLocator(command.current.operationId);forgetRemovalMaterial(clientId,product.id,command.current.operationId)}command.current=null;recoveryOperation.current=undefined;setUnknown(false);setError(errorMessage(e));void preview.refetch()}
   else{
    const canonicalOperation = api.code === 'product_removed' && api.status === 409
     ? removalOperationFromStatusUrl(clientId, api.problemDetails?.statusUrl) : null
    if (canonicalOperation) {
     if (command.current) forgetRemovalMaterial(clientId, product.id, command.current.operationId)
     recoveryOperation.current = canonicalOperation
     command.current = null
     writeRemovalLocator(canonicalOperation, product.id)
    }
    setUnknown(true);setError(errorMessage(e))
   }
  }finally{inFlight.current=false;if(removalScopeCurrent(scope))setPending(false)}
 }
 if(!authorized||[401,403].includes((preview.error as ApiError|null)?.status??0))return null
 const d=preview.data?.dependencies
 return <Modal isOpen onClose={onClose} title="Delete product permanently" descriptionId={description} initialFocusRef={cancel} returnFocusRef={receipt?returnFocusRef:undefined} closeDisabled={pending} closeOnBackdropClick={false} footer={<div className="flex flex-wrap justify-end gap-3"><button ref={cancel} className={button} onClick={onClose} disabled={pending}>{receipt?'Close':'Cancel'}</button>{!receipt&&!unknown&&<button className={`${button} border-danger-line bg-danger-solid text-on-accent`} disabled={pending||preview.isFetching||!preview.data?.hardDeleteAllowed||Boolean(preview.error)} onClick={()=>void remove()}>Delete product permanently</button>}</div>}>
  <div className="space-y-4 text-sm text-foreground"><p id={description}>Selected Client: {clientId}. Product: {preview.data?.productName??product.name}. Archive is the normal reversible action. Permanent deletion cannot be undone; your source repository is unaffected.</p>
  {receipt?<><Progress receipt={receipt}/><button className={button} onClick={()=>void check()} disabled={pending}>Check cleanup status</button></>:<>
  {preview.isLoading&&<p role="status">Loading dependency preview…</p>}{preview.error&&!previewRecovery&&<p role="alert">The dependency preview could not be verified. Deletion is disabled.</p>}
  {d&&<><dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt>Submissions</dt><dd>{d.submissions}</dd></div><div><dt>Analytics/funnel records</dt><dd>{d.funnelEvents}</dd></div><div><dt>Product bindings (primary)</dt><dd>{d.productBindings} ({d.primaryProductBindings})</dd></div><div><dt>Independent domain obligations</dt><dd>{d.domainReleaseObligations}</dd></div><div><dt>Ordinary images</dt><dd>{(BigInt(d.ordinaryAssets.finalizing)+BigInt(d.ordinaryAssets.ready)+BigInt(d.ordinaryAssets.deleting)+BigInt(d.ordinaryAssets.failed)+BigInt(d.ordinaryAssets.deleted)).toString()}</dd></div><div><dt>Adopted generated images</dt><dd>{(BigInt(d.generatedAssets.finalizing)+BigInt(d.generatedAssets.ready)+BigInt(d.generatedAssets.deleting)+BigInt(d.generatedAssets.failed)+BigInt(d.generatedAssets.deleted)).toString()}</dd></div></dl>
  {preview.data?.hardDeleteAllowed?<p>This Product has no submissions or analytics records. Its page, saved content and drafts will be removed and stop serving. Its Product domain bindings will be released and owned images scheduled for physical deletion. Domain cleanup can remain pending; stored bytes remain counted until absence is confirmed. Required history, accepted AI work and credits are unchanged.</p>:<div><p>Deletion is blocked:</p><ul className="list-inside list-disc">{preview.data?.blockers.map(reason=><li key={reason}>{reason.replace(/_/g,' ')}{reason.includes('present')?'. Archive preserves these records.':'. Let existing upload/adoption recovery finish, then refresh.'}</li>)}</ul></div>}
  <p>Ordinary image lifecycle: {d.ordinaryAssets.finalizing} finalizing, {d.ordinaryAssets.ready} ready, {d.ordinaryAssets.deleting} deleting, {d.ordinaryAssets.failed} failed, {d.ordinaryAssets.deleted} deleted; {d.ordinaryAssets.bytesAwaitingAbsence} bytes awaiting absence. Generated image lifecycle: {d.generatedAssets.finalizing} finalizing, {d.generatedAssets.ready} ready, {d.generatedAssets.deleting} deleting, {d.generatedAssets.failed} failed, {d.generatedAssets.deleted} deleted; {d.generatedAssets.bytesAwaitingAbsence} bytes awaiting absence.</p>
  <p>Uploads in flight: {d.uploads.inFlight}. Adoptions in flight: {d.adoptions.inFlight}. Staging keys to verify: {d.stagingKeysToVerify.ordinary} ordinary, {d.stagingKeysToVerify.generated} generated. Existing cleanup jobs: {d.existingAssetCleanupJobs.pending} pending, {d.existingAssetCleanupJobs.leased} leased, {d.existingAssetCleanupJobs.retry} retrying, {d.existingAssetCleanupJobs.completed} completed, {d.existingAssetCleanupJobs.cancelled} cancelled, {d.existingAssetCleanupJobs.deadLetter} dead letter. Job cancellation alone does not confirm physical absence.</p>
  <p>Policy {removalPolicy} · Product revision {preview.data?.revision}</p></>}
  {!unknown&&<div className="flex flex-wrap gap-3"><button className={button} disabled={pending||preview.isFetching} onClick={()=>{setError(null);void preview.refetch()}}>Refresh preview</button>{onArchive?<button className={button} disabled={pending} onClick={()=>{onClose();onArchive(product)}}>Open Archive options</button>:<p>Archive unavailable: products:update permission is required.</p>}</div>}
  </>}
  {pending&&<p role="status">{command.current?'Checking or removing Product…':'Checking current status…'}</p>}{error&&<p role="alert">{error}</p>}
  {unknown&&<div><p>Outcome unknown. A normal Product 404 is not proof of success.</p><div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={pending} onClick={()=>void check()}>Check retained status</button>{command.current&&<button className={button} disabled={pending} onClick={()=>void remove(true)}>Retry exact same request</button>}</div></div>}
  </div>
 </Modal>
}

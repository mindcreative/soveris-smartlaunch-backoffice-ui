import { SupportWorkspaceReturn } from './SupportWorkspaceReturn'
import { SupportReceiptRecovery } from './SupportReceiptRecovery'
import { usePendingSupportCommand } from './pendingCommands'
import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { canonicalizeGuid } from '../lib/guid'
import { useAuthStore } from '../stores/authStore'
import { supportAuthority, supportScopeKey } from './authority'
import { supportApi } from './client'
import { endSupportRequest } from './commands'
import { SUPPORT, SUPPORT_BUTTON_CLASS } from './constants'
import { SupportAccessError } from './errors'
import { adoptSupportContext, locallyExited } from './lifetime'
import { productLabel, requestLabel, supportReadLabel, supportText } from './labels'
import { SupportStatus, useSupportRetry } from './SupportStatus'
import { SupportTime } from './SupportTime'
import { useSupportAction, useSupportSnapshot } from './useSupportAction'

export function SupportAudiencePage() {
  const pendingCommand = usePendingSupportCommand()
  const route = useParams()
  const grant = canonicalizeGuid(route.grantId)
  const navigate = useNavigate()
  const actor = useAuthStore(state => state.user)
  const snapshot = useSupportSnapshot()
  const action = useSupportAction()
  const retry = useSupportRetry()
  const context = snapshot.context?.id === grant && actor && snapshot.scopeKey === supportScopeKey(snapshot.context, actor) ? snapshot.context : null
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const recoveryHeading = useRef<HTMLHeadingElement>(null)
  const resultRegion = useRef<HTMLElement>(null)
  const privateRegion = useRef<HTMLDivElement>(null)
  const resultFocused = useRef(false)
  const recoveryFocus = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const closed = !!grant && (locallyExited(grant) || snapshot.notice?.code === 'support_expired')
  useEffect(() => {
    if (context) {
      heading.current?.focus()
    }
  }, [context?.id, context?.revision])

  useEffect(() => {
    const track = () => { resultFocused.current = !!privateRegion.current?.contains(document.activeElement) }
    const resume = () => {
      if (recoveryFocus.current) {
        recoveryHeading.current?.focus()
        recoveryFocus.current = false
      }
    }
    document.addEventListener('focusin', track)
    window.addEventListener('focus', resume)
    return () => { document.removeEventListener('focusin', track); window.removeEventListener('focus', resume) }
  }, [])
  useEffect(() => {
    if (snapshot.projection && context) {
      resultHeading.current?.focus()
    } else if (resultFocused.current) {
      recoveryFocus.current = true

      if (document.hasFocus()) {
        recoveryHeading.current?.focus()
        recoveryFocus.current = false
      }
    }
  }, [snapshot.projection, context])

  function verify(): void {
    if (!grant || !actor || closed) {
      return
    }

    void action.run(async (signal, current) => {
      const verified = await supportApi.context(grant, signal)

      if (current()) {
        adoptSupportContext(verified, actor)
      }
    })
  }

  function read(product: string, draft: boolean): void {
    if (!context) {
      return
    }

    const generation = snapshot.generation
    void action.run(async (signal, current) => {
      const result = draft ? await supportApi.draft(context.id, product, signal) : await supportApi.identity(context.id, product, signal)

      if (current() && (result.productId !== product || !supportAuthority.retain(result, generation))) {
        throw new SupportAccessError(503)
      }
    })
  }

  function exit(): void {
    if (!context) {
      return
    }

    endSupportRequest(context.id, context.revision, () => navigate('/platform/support', { replace: true }))
  }

  const projection = context ? snapshot.projection : null
  return <section className="min-w-0 max-w-5xl space-y-6 break-words">
    <h1 className="text-2xl font-bold">Temporary support view</h1>
    <SupportReceiptRecovery refresh={() => navigate('/platform/support')} />
    <SupportStatus pending={action.pending} />
    {!context ? <div className="space-y-4">
      <h2 ref={recoveryHeading} tabIndex={-1} className="font-semibold">{snapshot.notice?.code === 'support_expired' ? 'Support access ended — Expired' : closed ? 'Support ended locally — verify its outcome' : 'Support context requires verification'}</h2>
      <SupportWorkspaceReturn />
      <p>Verify the active grant with the server before displaying any customer content.</p>
      {closed ? <p>Support was ended locally. If the server outcome is uncertain, ask the customer to revoke access or follow the support outage procedure. Confirm its state from your requests.</p>
        : <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={!grant || !actor || action.pending || retry > 0 || !!pendingCommand} onClick={verify}>Verify support context</button>}
      <Link to="/platform/support" className="block min-h-11 text-primary underline">Return to support requests</Link>
    </div> : <div ref={privateRegion} className="space-y-6">
      <section aria-label="Current support context" className="sticky top-0 z-30 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-line bg-warning-soft p-3 text-warning lg:top-20">
        <div className="min-w-0 flex-1 text-sm"><p className="font-bold">Read-only support</p>
          <p className="truncate" title={supportText(context.operatorName)}>Operator: {supportText(context.operatorName)}</p>
          <p className="truncate" title={supportText(context.targetClientName)}>Customer: {supportText(context.targetClientName)}</p>
</div>
        <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={!!pendingCommand} onClick={exit}>Exit support</button>
      </section>
      <section role="region" aria-label="Temporary support access" className="space-y-3 rounded-lg border-2 border-warning-line bg-warning-soft p-4 text-warning">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">Support access — {supportText(context.targetClientName)}</h2>
        <p>Operator: {supportText(context.operatorName)}</p>
        <p>Customer: {supportText(context.targetClientName)}</p>
        <p className="break-all">Your original workspace: {supportText(context.originalWorkspaceName)}</p>
        <p>{requestLabel(context)}</p>
        <p>Allowed operations: {context.operations.map(supportReadLabel).join(', ')}</p>
        <p>Access ends at <SupportTime value={context.expiresAt} /></p>
        <p>Server time decides access. References are displayed as text and do not permit downloads or navigation.</p>
      </section>
      <section aria-label="Selected products" className="space-y-3">
        <h2 className="text-xl font-semibold">Selected products</h2>
        <ul className="space-y-4">{context.products.map(product => <li key={product.id} className="space-y-2 rounded-lg border border-line p-3">
          <p>{productLabel(product)}</p>
          <div className="flex flex-wrap gap-3">
            {context.operations.includes(SUPPORT.identityRead) && <button className={SUPPORT_BUTTON_CLASS} disabled={action.pending} onClick={() => read(product.id, false)}>Read identity for {productLabel(product)}</button>}
            {context.operations.includes(SUPPORT.draftRead) && <button className={SUPPORT_BUTTON_CLASS} disabled={action.pending} onClick={() => read(product.id, true)}>Read draft for {productLabel(product)}</button>}
          </div>
        </li>)}</ul>
      </section>
      {projection && <section ref={resultRegion} aria-label="Authorized read result" className="space-y-3">
        <p role="status">{projection.kind === 'draft' ? 'Draft' : 'Identity'} loaded for {context.products.find(product => product.id === projection.productId) ? productLabel(context.products.find(product => product.id === projection.productId)!) : 'selected product'}</p>
        <h2 ref={resultHeading} tabIndex={-1} className="text-xl font-semibold">{projection.kind === 'draft' ? 'Draft JSON' : 'Product identity'} — {context.products.find(product => product.id === projection.productId) ? productLabel(context.products.find(product => product.id === projection.productId)!) : 'selected product'}</h2>
        <p>Product: {context.products.find(product => product.id === projection.productId) ? productLabel(context.products.find(product => product.id === projection.productId)!) : 'Label unavailable'} · draft revision {projection.draftRevision}</p>
        <p>Presentation only: identifiers in displayed text are hidden. The canonical response is unchanged.</p>
        {projection.kind === 'draft' ? <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface p-4 text-foreground">{supportText(projection.draftJson)}</pre>
          : <dl className="space-y-2 break-words"><dt>Name</dt><dd>{supportText(projection.name)}</dd><dt>Slug</dt><dd>{supportText(projection.slug)}</dd>
            <dt>Status</dt><dd>{projection.status}</dd><dt>Revision</dt><dd>{projection.revision}</dd>
            <dt>Draft schema version</dt><dd>{projection.draftSchemaVersion ?? 'No draft'}</dd></dl>}
      </section>}
    </div>}
  </section>
}

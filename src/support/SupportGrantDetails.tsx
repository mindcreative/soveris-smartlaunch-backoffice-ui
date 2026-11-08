import { SupportWorkspaceReturn } from './SupportWorkspaceReturn'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SUPPORT_BUTTON_CLASS } from './constants'
import { productLabel, requestLabel, supportReadLabel, supportText } from './labels'
import { locallyExited } from './lifetime'
import type { SupportMetadata } from './models'
import { SupportActivation } from './SupportActivation'
import { SupportCountdown, SupportTime } from './SupportTime'

export function SupportGrantDetails({ grant, operatorDisplayName, owner, pending, blocked, revokeBlocked = false, focusOnOpen = false, approve, revoke, exit, refresh }: {
  grant: SupportMetadata; operatorDisplayName?: string; owner: boolean; pending: boolean; blocked: boolean; revokeBlocked?: boolean; focusOnOpen?: boolean
  approve: () => void; revoke: () => void; exit: () => void; refresh: () => void
}) {
  const guidance = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnOpen) {
      heading.current?.focus()
    }
  }, [grant.id])
  useEffect(() => {
    if (!owner && (grant.state === 'active' || grant.state === 'ended')) {
      heading.current?.focus()
    }
  }, [owner, grant.state])
  const reviewBinding = JSON.stringify([grant.id, grant.revision, grant.labelReviewHash, operatorDisplayName])
  const [consentState, setConsent] = useState({ binding: reviewBinding, checked: false })
  const consent = consentState.binding === reviewBinding && consentState.checked
  const readableScope = grant.products.length === grant.productIds.length && !!grant.operatorName && !!grant.targetClientName
  const reviewable = readableScope && !!grant.labelReviewHash && !!grant.currentLabels

  function submitConsent(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (consent && reviewable && !blocked) {
      approve()
    }
  }

  return <section aria-label="Exact support request" className="space-y-4 rounded-lg border border-line p-4">
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">Exact requested scope</h2>
    <p>{requestLabel(grant)}</p>
    {grant.labelsChanged && <p role="status">Names changed. Review the current labels before giving consent. After approval, the approved names remain shown separately from current names.</p>}
    {grant.labelsChanged && !grant.currentLabels && <p>Current names are unavailable. The approved scope is unchanged; ending access remains available.</p>}
    {!grant.requestLabels && <p>Historical label unavailable.</p>}
    {!readableScope && <p role="status">Scope labels are unavailable. Verify them before approval. Ending access remains available.</p>}
    <dl className="space-y-2 break-words"><dt>Operator</dt><dd>{operatorDisplayName ?? supportText(grant.operatorName)}</dd>
      <dt>Customer</dt><dd>{supportText(grant.targetClientName)}</dd><dt>State</dt><dd>{grant.state}</dd>
      <dt>Reason</dt><dd>{supportText(grant.reason)}</dd><dt>Case reference</dt><dd>{supportText(grant.supportCaseReference)}</dd>
      <dt>Duration</dt><dd>{grant.durationMinutes} minutes from activation, capped by the original session</dd>
      <dt>Revision</dt><dd>{grant.revision}</dd></dl>
    <h3 className="font-semibold">Selected products</h3><ul className="list-inside list-disc break-all">{grant.products.map(product => <li key={product.id}>{productLabel(product)}</li>)}</ul>
    {grant.approvedAt && grant.labelsChanged && grant.currentLabels && <div aria-label="Current names"><p>Current names (approved scope unchanged): {supportText(grant.currentLabels.targetClientName)} · {supportText(grant.currentLabels.operatorName)}</p><ul>{grant.currentLabels.products.map(product => <li key={product.id}>{productLabel(product)}</li>)}</ul></div>}
    <h3 className="font-semibold">Allowed reads</h3><ul className="list-inside list-disc">{grant.operations.map(operation => <li key={operation}>{supportReadLabel(operation)}</li>)}</ul>
    <p>No live content, submissions, contacts, assets, downloads, exports, writes or background access is granted.</p>
    <p>Request expires at <SupportTime value={grant.requestExpiresAt} /></p>
    {grant.activationDeadline && <p>Activate before <SupportTime value={grant.activationDeadline} /></p>}
    {grant.startsAt && <p>Activated at <SupportTime value={grant.startsAt} /></p>}
    <SupportCountdown grant={grant} refresh={refresh} />
    {grant.expiresAt && <p>Access ends at <SupportTime value={grant.expiresAt} /></p>}
    {grant.endedAt && <p>Ended: {grant.terminalReason} · <SupportTime value={grant.endedAt} /></p>}
    {grant.state === 'requested' && <p>Waiting for customer approval. Next: the customer owner reviews this exact scope.</p>}
    {grant.state === 'approved' && <p>Approved, not activated. Duration starts at activation. Next: the operator completes grant-bound verification and explicitly activates.</p>}
    {grant.state === 'ended' && !owner && <SupportWorkspaceReturn />}
    {owner && grant.state === 'requested' && <form className="space-y-3" onSubmit={submitConsent}>
      <p id={guidance}>Approval is tied to your current ClientOwner session and authority. Signing out invalidates it.</p>
      <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={consent} onChange={event => setConsent({ binding: reviewBinding, checked: event.target.checked })} className="mt-1" />
        I approve this exact operator, selected products, read operations and duration.</label>
      <button type="submit" className={SUPPORT_BUTTON_CLASS} aria-describedby={guidance} disabled={!consent || !reviewable || pending || blocked}>Approve exact scope</button>
    </form>}
    {owner && grant.state !== 'ended' && <button className={SUPPORT_BUTTON_CLASS} disabled={pending || revokeBlocked} onClick={revoke}>{grant.state === 'requested' ? 'Reject request' : 'Revoke support access'}</button>}
    {!owner && grant.state === 'approved' && <SupportActivation grant={grant} refresh={refresh} />}
    {!owner && grant.state !== 'ended' && <div className="flex flex-wrap items-center gap-3">
      {grant.state === 'active' && !locallyExited(grant.id) && <Link to={'/support/' + grant.id} className="inline-flex min-h-11 items-center text-primary underline">Enter temporary support view</Link>}
      <button className={SUPPORT_BUTTON_CLASS} disabled={blocked || pending} onClick={exit}>{grant.state === 'active' ? 'Exit support' : 'Cancel own request'}</button>
    </div>}
  </section>
}

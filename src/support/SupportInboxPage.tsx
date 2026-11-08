import { useEffect, useRef } from 'react'
import { SupportWorkspaceReturn } from './SupportWorkspaceReturn'
import { SupportReceiptRecovery } from './SupportReceiptRecovery'
import { executeSupportCommand, usePendingSupportCommand } from './pendingCommands'
import { supportText } from './labels'
import { useNavigate } from 'react-router-dom'
import { createUuidV7 } from '../lib/uuidV7'
import { useAuthStore } from '../stores/authStore'
import { operatorLabel, requestLabel } from './labels'
import { resetSupportDraft } from './draft'
import { endSupportRequest } from './commands'
import { SUPPORT, SUPPORT_BUTTON_CLASS } from './constants'
import { SupportAccessError } from './errors'
import { notifySupportPeers } from './lifetime'
import type { SupportRequest } from './models'
import { SupportGrantDetails } from './SupportGrantDetails'
import { SupportRequestForm } from './SupportRequestForm'
import { SupportTime } from './SupportTime'
import { SupportStatus, useSupportRetry } from './SupportStatus'
import { useSupportMetadata } from './useSupportMetadata'
import { useSupportSnapshot } from './useSupportAction'
import { useSupportAction } from './useSupportAction'

export function SupportInboxPage({ mode }: { mode: 'operator' | 'owner' }) {
  const pageHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { pageHeading.current?.focus() }, [mode])
  const pendingCommand = usePendingSupportCommand()
  const focusDetail = useRef(false)
  const owner = mode === 'owner'
  const actor = useAuthStore(state => state.user)
  const authenticated = useAuthStore(state => state.isAuthenticated)
  const allowed = authenticated && !!actor && (owner ? actor.role === 'ClientOwner' : !!actor.platformPermissions?.includes(SUPPORT.permission))
  const action = useSupportAction()
  const retry = useSupportRetry()
  const { notice } = useSupportSnapshot()
  const navigate = useNavigate()
  const metadata = useSupportMetadata(owner, allowed)
  const { visible, detail } = metadata

  function load(before?: string, selected?: string): void {
    void metadata.refresh(selected, before)
  }

  function select(grant: string): void {
    focusDetail.current = true
    void metadata.refresh(grant)
  }
  function create(input: SupportRequest): void {
    void action.run(async (signal, current) => {
      const created = await executeSupportCommand('request', input, undefined, signal)

      if (current()) {
        resetSupportDraft()
        await metadata.refresh(created.id)
      }
    })
  }
  function command(approve: boolean): void {
    if (!detail) {
      return
    }

    void action.run(async (signal, current) => {
      const input = { operationId: createUuidV7(), expectedRevision: detail.revision, ...(approve ? { scopeHash: detail.scopeHash, labelReviewHash: detail.labelReviewHash ?? undefined } : {}) }
      const result = approve ? await executeSupportCommand('approve', input, detail.id, signal) : await executeSupportCommand('revoke', input, detail.id, signal)

      if (result.state !== (approve ? 'approved' : 'ended')) {
        throw new SupportAccessError(503)
      }

      if (!approve) {
        notifySupportPeers()
      }

      if (current()) {
        await metadata.reconcile(result)
      }
    })
  }
  function exit(): void {
    if (detail) {
      endSupportRequest(detail.id, detail.revision, () => { focusDetail.current = true; load(undefined, detail.id); navigate('/platform/support', { replace: true }) })
    }
  }

  if (!allowed) {
    return <section role="alert"><h1>Access denied</h1><p>Your current session does not permit this support operation.</p></section>
  }

  return <section className="max-w-5xl space-y-6 break-words">
    <h1 ref={pageHeading} tabIndex={-1} className="text-2xl font-bold">{owner ? 'Customer support access approvals' : 'Temporary support requests'}</h1>
    <p>{owner ? 'Review only support requests for your own Client. Approval is optional and limited to the exact displayed scope.'
      : 'Use your own identity and original workspace. Customer content requires explicit approval and a separately activated support view.'}</p>
    <p>Signed in as {supportText(actor?.displayName)} · Workspace: {supportText(actor?.workspaceName)} · Workspace role: {actor?.role}</p>
    {!owner && <p>Platform role: SupportOperator</p>}
    <SupportReceiptRecovery refresh={grant => { focusDetail.current = true; load(undefined, grant) }} />
    <SupportStatus focusError={!owner} pending={action.pending || metadata.pending} />
    {owner && visible && <p role="status">Last verified: <SupportTime value={visible.checkedAt} />{metadata.stale ? ' · Lifecycle metadata is stale or unavailable. Verify before approving.' : ' · Current lifecycle metadata verified.'}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {!owner && <SupportWorkspaceReturn />}
      <button className={SUPPORT_BUTTON_CLASS} disabled={action.pending || retry > 0} onClick={() => load()}>Reload current requests</button>
    </div>
    {!owner && <div>
      <SupportRequestForm pending={action.pending || !!pendingCommand} fieldNotice={notice} blocked={!visible || metadata.stale || metadata.pending || retry > 0} create={create}
        verify={() => load()} verificationPending={metadata.pending} retrySeconds={retry}
        lookupMessage={actor?.stepUpRequired ? 'Verify your authenticator to continue, then verify access.' : notice?.status === 403 ? 'This action is not currently permitted. Check current access and request status.'
          : notice?.status === 429 ? 'Lookup rate limit reached. Wait before verifying access again.'
          : notice?.status === 401 ? 'Your original session is no longer current. Sign in again.'
          : notice?.status === 503 ? 'Lookup unavailable. Check the connection and retry verification.' : undefined} />
      {actor?.stepUpRequired && <a href="/account/security" className="inline-flex min-h-11 items-center text-primary underline">Verify your authenticator</a>}
    </div>}
    {visible && <>
      <section aria-label="Current support requests" className="space-y-3"><h2 className="text-xl font-semibold">{owner ? 'Incoming requests' : 'Your requests'}</h2>
        {visible.page.items.length === 0 ? <p>No requests on this page.</p> : <ul className="space-y-3">{visible.page.items.map((item, index) => <li key={item.id}>
          <button className="min-h-11 max-w-full break-words text-left text-primary underline" aria-label={'Review request ' + requestLabel(item) + ' · request ' + (index + 1)} disabled={action.pending || retry > 0} onClick={() => select(item.id)}>
            {requestLabel(item)} · {operatorLabel(item, visible.page.items)} · {item.state}
          </button>
        </li>)}</ul>}
        {visible.page.nextCursor && <button className={SUPPORT_BUTTON_CLASS} disabled={action.pending || retry > 0} onClick={() => load(visible.page.nextCursor!)}>Older requests</button>}
      </section>
      {detail && <SupportGrantDetails key={detail.id} grant={detail} operatorDisplayName={operatorLabel(detail, visible.page.items)} owner={owner} focusOnOpen={focusDetail.current} pending={action.pending || !!pendingCommand} blocked={retry > 0 || metadata.stale || metadata.pending} revokeBlocked={retry > 0}
        approve={() => command(true)} revoke={() => command(false)} exit={exit} refresh={() => load(undefined, detail.id)} />}
    </>}
  </section>
}

import { useEffect, useId, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { pendingCommandPath, supportRequestHash } from './commandIdentity'
import { retireSupport } from './lifetime'
import { supportApi } from './client'
import { SUPPORT_BUTTON_CLASS } from './constants'
import { confirmSupportReceipt, usePendingSupportCommand } from './pendingCommands'
import { useSupportAction } from './useSupportAction'
import { SupportAccessError } from './errors'
import { useSupportRetry } from './SupportStatus'

export function SupportReceiptRecovery({ refresh }: { refresh: (grant: string) => void }) {
  const retry = useSupportRetry()
  const id = useId()
  const pending = usePendingSupportCommand()
  const action = useSupportAction()
  const [feedback, setFeedback] = useState<{ operation: string; message: string } | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  if (!pending) {
    return null
  }

  function inspect(): void {
    if (!pending) {
      return
    }

    void action.run(async (signal, current) => {
      try {
        const receipt = await supportApi.receipt(pending.body.operationId, signal)

        if (!current()) {
          return
        }

        if (receipt.command !== pending.kind) {
          throw new SupportAccessError(503)
        }

        if ('status' in receipt.outcome) {
          const hash = await supportRequestHash(pendingCommandPath(pending), JSON.stringify(pending.body))

          if (receipt.outcome.requestHash !== hash) {
            throw new SupportAccessError(503)
          }

          if (current()) {
            confirmSupportReceipt(receipt.operationId)
            retireSupport(new SupportAccessError(429, receipt.outcome.retryAfter, receipt.outcome.code, undefined, receipt.operationId).notice)
          }

          return
        }

        if (pending.grant && receipt.outcome.id !== pending.grant) {
          throw new SupportAccessError(503)
        }

        setFeedback({ operation: pending.body.operationId, message: `Original ${receipt.command} outcome confirmed. Verifying the current request next.` })
        await supportApi.detail(receipt.outcome.id, receipt.command === 'approve' || receipt.command === 'revoke', signal)

        if (current()) {
          confirmSupportReceipt(receipt.operationId)

          if (receipt.command === 'activate') {
            // Match normal activation: settle the new MFA projection before
            // returning to requests. A different login must not inherit this continuation.
            const original = useAuthStore.getState()
            const identity = (state: typeof original) => JSON.stringify([state.accessToken, state.refreshTokenValue,
              state.isAuthenticated, state.authorityUnavailable, state.user?.id, state.user?.clientId,
              state.user?.clientRoleId, state.user?.sessionId, state.user?.securityRevision, state.user?.role,
              state.user?.permissions, state.user?.platformPermissions, state.user?.mfaState, state.user?.stepUpRequired])
            const originalIdentity = identity(original)
            let unchanged = true
            const release = useAuthStore.subscribe(state => { unchanged = unchanged && identity(state) === originalIdentity })

            try {
              await original.revalidateAuthority()
            } finally {
              release()
            }

            const verified = useAuthStore.getState()

            if (!mounted.current || !unchanged || identity(verified) !== originalIdentity || verified.user === original.user && !current()) {
              return
            }
          }

          refresh(receipt.outcome.id)
        }
      } catch (error) {
        setFeedback({ operation: pending.body.operationId, message: error instanceof SupportAccessError && error.status === 404 ? 'No confirmed outcome is available. This does not prove rollback. Do not send a replacement command.'
          : 'Outcome remains unconfirmed. Check current access before inspecting this receipt again.' })
      }
    })
  }
  return <section aria-label="Unconfirmed command" className="space-y-3 rounded-lg border border-warning-line p-4">
    <h2 className="font-semibold">Outcome not confirmed. Check current request.</h2>
    <p>A command is pending confirmation. Another command cannot replace it; no command will be replayed.</p>
    {feedback?.operation === pending.body.operationId && <p role="status">{feedback.message}</p>}
    <p id={id}>{retry > 0 ? 'Wait for the current verification cooldown before inspecting the receipt.' : 'Inspecting reads the original outcome; current grant state is checked next.'}</p>
    <button type="button" aria-describedby={id} className={SUPPORT_BUTTON_CLASS} disabled={action.pending || retry > 0} onClick={inspect}>Inspect exact command receipt</button>
  </section>
}

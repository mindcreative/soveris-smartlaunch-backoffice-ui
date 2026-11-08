import { useSyncExternalStore } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supportApi } from './client'
import { SupportAccessError, SupportScopeChangedError } from './errors'
import { SUPPORT_PRE_EFFECT_CONFLICTS, SUPPORT_RATE_REJECTED } from './constants'
import type { PendingSupportCommand, SupportCommand, SupportCommandKind, SupportRequest } from './models'

let pending: PendingSupportCommand | null = null
const listeners = new Set<() => void>()
function key(): string | null {
  const state = useAuthStore.getState()
  const actor = state.user
  return state.accessToken && actor ? JSON.stringify([actor.id, actor.clientId, actor.clientRoleId, actor.sessionId, actor.securityRevision,
    actor.platformPermissions, actor.permissions, actor.mfaState, actor.stepUpRequired, actor.assuranceGeneration]) : null
}
let binding = key()
function publish(value: PendingSupportCommand | null): void {
  pending = value
  listeners.forEach(listener => listener())
}
useAuthStore.subscribe(state => {
  // A provisional loss of the verified projection is not a changed login.
  // Keep uncertainty while credentials survive; no positive authority is retained.
  if (!state.user && state.authorityUnavailable && state.accessToken && state.refreshTokenValue) {
    return
  }

  const next = key()

  if (next !== binding) {
    binding = next
    publish(null)
  }
})

/** Memory-only identity is recorded before send; an uncertain command is never replayed. */
export async function executeSupportCommand(kind: SupportCommandKind, body: SupportRequest | SupportCommand, grant?: string, signal?: AbortSignal) {
  if (pending) {
    throw new SupportAccessError(409)
  }

  const original = key()

  if (original === null) {
    throw new SupportScopeChangedError()
  }

  const command = { kind, body: structuredClone(body), grant }
  publish(command)

  try {
    const outcome = kind === 'request' ? await supportApi.create(command.body as SupportRequest, signal)
      : await supportApi[kind](grant!, command.body as SupportCommand, signal)

    if (original === key() && pending === command) {
      publish(null)
    }

    return outcome
  } catch (error) {
    // Only these finite server conflicts reject this command before effects.
    // Other lost/denied responses can follow a commit and remain uncertain.
    const rejectedBeforeEffect = error instanceof SupportAccessError && (
      error.status === 409 && SUPPORT_PRE_EFFECT_CONFLICTS.some(code => error.safeCode === code)
      || error.status === 429 && error.safeCode === SUPPORT_RATE_REJECTED && error.rejectedOperationId === command.body.operationId)


    if (rejectedBeforeEffect && pending === command) {
      publish(null)
    }

    throw error
  }
}

export function confirmSupportReceipt(operationId: string): void {
  if (pending?.body.operationId === operationId) {
    publish(null)
  }
}
export function usePendingSupportCommand() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => pending)
}

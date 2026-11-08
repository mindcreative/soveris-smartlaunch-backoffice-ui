import { useSyncExternalStore } from 'react'
import { useAuthStore } from '../stores/authStore'
import type { AuthUser } from '../types/auth'
import { SUPPORT } from './constants'
import type { SupportRequestDraft } from './models'

const empty = (): SupportRequestDraft => ({ customerGeneration: 0, target: '', products: '', minutes: '60', reason: '', reference: '', operations: [SUPPORT.identityRead] })
let draft = empty()
let binding: string | null = null
const listeners = new Set<() => void>()

function authorityKey(actor: AuthUser): string {
  return JSON.stringify([actor.id, actor.clientId, actor.clientRoleId, actor.sessionId, actor.securityRevision,
    actor.permissions, actor.platformPermissions, actor.mfaState, actor.stepUpRequired, actor.assuranceGeneration])
}

export function resetSupportDraft(): void {
  draft = empty()
  listeners.forEach(listener => listener())
}

// A transient presentation retirement has no authority to discard unsent input.
// Confirmed identity/security changes and logout do; nothing is persisted.
useAuthStore.subscribe(state => {
  if (!state.accessToken || !state.refreshTokenValue) {
    binding = null
    resetSupportDraft()
    return
  }

  if (state.user) {
    const next = authorityKey(state.user)

    if (binding !== next) {
      binding = next
      resetSupportDraft()
    }
  }
})

export function useSupportDraft() {
  const current = useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => draft)

  function update(value: Partial<SupportRequestDraft>): void {
    draft = { ...draft, ...value }
    listeners.forEach(listener => listener())
  }

  return { draft: current, update }
}

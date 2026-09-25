import type { CreditAdjustmentReversalAttempt } from '../types/billing'

export interface CreditAdjustmentReversalRecoveryRecord
  extends CreditAdjustmentReversalAttempt {
  quarantined: boolean
}

const scopeKey = (actorUserId: string, clientId: string, originalAdjustmentId: string) =>
  `${actorUserId}\u0000${clientId}\u0000${originalAdjustmentId}`
const scopePrefix = (actorUserId: string, clientId: string) =>
  `${actorUserId}\u0000${clientId}\u0000`

function freezeAttempt(
  attempt: CreditAdjustmentReversalAttempt,
  quarantined: boolean
): CreditAdjustmentReversalRecoveryRecord {
  const request = Object.freeze({ ...attempt.request })
  const account = Object.freeze({ ...attempt.account })
  const original = Object.freeze({ ...attempt.original })
  return Object.freeze({ ...attempt, request, account, original, quarantined })
}

class CreditAdjustmentReversalRecoveryStore {
  private readonly records = new Map<string, CreditAdjustmentReversalRecoveryRecord>()
  private listening = false

  private readonly warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.records.size === 0) return
    event.preventDefault()
    event.returnValue = ''
  }

  private syncUnloadWarning(): void {
    if (typeof window === 'undefined') return
    const shouldListen = this.records.size > 0
    if (shouldListen === this.listening) return
    if (shouldListen) window.addEventListener('beforeunload', this.warnBeforeUnload)
    else window.removeEventListener('beforeunload', this.warnBeforeUnload)
    this.listening = shouldListen
  }

  retain(attempt: CreditAdjustmentReversalAttempt): CreditAdjustmentReversalRecoveryRecord {
    const key = scopeKey(attempt.actorUserId, attempt.clientId, attempt.originalAdjustmentId)
    const existing = this.records.get(key)
    if (existing) {
      if (existing.operationId !== attempt.operationId ||
          existing.route !== attempt.route ||
          existing.serializedBody !== attempt.serializedBody ||
          existing.semanticFingerprint !== attempt.semanticFingerprint)
        throw new Error('An unresolved reversal already owns this actor, Client and original scope')
      return existing
    }
    const record = freezeAttempt(attempt, false)
    this.records.set(key, record)
    this.syncUnloadWarning()
    return record
  }

  peek(actorUserId: string, clientId: string,
    originalAdjustmentId: string): CreditAdjustmentReversalRecoveryRecord | null {
    return this.records.get(scopeKey(actorUserId, clientId, originalAdjustmentId)) ?? null
  }

  first(actorUserId: string, clientId: string): CreditAdjustmentReversalRecoveryRecord | null {
    const prefix = scopePrefix(actorUserId, clientId)
    return [...this.records.entries()].find(([key]) => key.startsWith(prefix))?.[1] ?? null
  }

  quarantine(actorUserId: string, clientId: string,
    originalAdjustmentId: string): CreditAdjustmentReversalRecoveryRecord | null {
    const key = scopeKey(actorUserId, clientId, originalAdjustmentId)
    const existing = this.records.get(key)
    if (!existing) return null
    const next = freezeAttempt(existing, true)
    this.records.set(key, next)
    return next
  }

  quarantineScope(actorUserId: string, clientId: string): void {
    const prefix = scopePrefix(actorUserId, clientId)
    for (const [key, record] of this.records) {
      if (key.startsWith(prefix)) this.records.set(key, freezeAttempt(record, true))
    }
  }

  adopt(actorUserId: string, clientId: string,
    originalAdjustmentId: string): CreditAdjustmentReversalRecoveryRecord | null {
    const key = scopeKey(actorUserId, clientId, originalAdjustmentId)
    const existing = this.records.get(key)
    if (!existing) return null
    if (!existing.quarantined) return existing
    const next = freezeAttempt(existing, false)
    this.records.set(key, next)
    return next
  }

  adoptFirst(actorUserId: string, clientId: string): CreditAdjustmentReversalRecoveryRecord | null {
    const existing = this.first(actorUserId, clientId)
    return existing
      ? this.adopt(actorUserId, clientId, existing.originalAdjustmentId)
      : null
  }

  retire(actorUserId: string, clientId: string, originalAdjustmentId: string,
    operationId: string): boolean {
    const key = scopeKey(actorUserId, clientId, originalAdjustmentId)
    const existing = this.records.get(key)
    if (!existing || existing.operationId !== operationId) return false
    const removed = this.records.delete(key)
    this.syncUnloadWarning()
    return removed
  }

  clearScope(actorUserId: string, clientId: string): void {
    const prefix = scopePrefix(actorUserId, clientId)
    for (const key of [...this.records.keys()]) {
      if (key.startsWith(prefix)) this.records.delete(key)
    }
    this.syncUnloadWarning()
  }

  clearForTests(): void {
    this.records.clear()
    this.syncUnloadWarning()
  }
}

export const creditAdjustmentReversalRecoveryStore =
  new CreditAdjustmentReversalRecoveryStore()

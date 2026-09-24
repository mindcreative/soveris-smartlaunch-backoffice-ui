import type { CreditAdjustmentAttempt } from '../types/billing'

export interface CreditAdjustmentRecoveryRecord extends CreditAdjustmentAttempt {
  quarantined: boolean
}

const scopeKey = (actorUserId: string, clientId: string) => `${actorUserId}\u0000${clientId}`

class CreditAdjustmentRecoveryStore {
  private readonly records = new Map<string, CreditAdjustmentRecoveryRecord>()
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

  retain(attempt: CreditAdjustmentAttempt): CreditAdjustmentRecoveryRecord {
    const key = scopeKey(attempt.actorUserId, attempt.clientId)
    const existing = this.records.get(key)
    if (existing) {
      if (existing.operationId !== attempt.operationId ||
          existing.serializedBody !== attempt.serializedBody ||
          existing.semanticFingerprint !== attempt.semanticFingerprint) {
        throw new Error('An unresolved credit adjustment already owns this actor and Client scope')
      }
      return existing
    }
    const request = Object.freeze({ ...attempt.request })
    const record = Object.freeze({ ...attempt, request, quarantined: false })
    this.records.set(key, record)
    this.syncUnloadWarning()
    return record
  }

  peek(actorUserId: string, clientId: string): CreditAdjustmentRecoveryRecord | null {
    return this.records.get(scopeKey(actorUserId, clientId)) ?? null
  }

  quarantine(actorUserId: string, clientId: string): CreditAdjustmentRecoveryRecord | null {
    const key = scopeKey(actorUserId, clientId)
    const existing = this.records.get(key)
    if (!existing) return null
    const quarantined = Object.freeze({ ...existing, quarantined: true })
    this.records.set(key, quarantined)
    return quarantined
  }

  adopt(actorUserId: string, clientId: string): CreditAdjustmentRecoveryRecord | null {
    const key = scopeKey(actorUserId, clientId)
    const existing = this.records.get(key)
    if (!existing) return null
    if (!existing.quarantined) return existing
    const adopted = Object.freeze({ ...existing, quarantined: false })
    this.records.set(key, adopted)
    return adopted
  }

  retire(actorUserId: string, clientId: string, operationId: string): boolean {
    const key = scopeKey(actorUserId, clientId)
    const existing = this.records.get(key)
    if (!existing || existing.operationId !== operationId) return false
    const removed = this.records.delete(key)
    this.syncUnloadWarning()
    return removed
  }

  clearForTests(): void {
    this.records.clear()
    this.syncUnloadWarning()
  }
}

export const creditAdjustmentRecoveryStore = new CreditAdjustmentRecoveryStore()

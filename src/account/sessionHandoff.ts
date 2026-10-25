import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { useAuthStore } from '../stores/authStore'
import type { FirstProductHandoffDependencies, IFirstProductHandoff } from './models/accountLifecycle'

class FirstProductHandoff implements IFirstProductHandoff {
  private _intent: { sessionId: string; epoch: number } | null = null
  private readonly _dependencies: FirstProductHandoffDependencies

  constructor(dependencies: FirstProductHandoffDependencies) {
    this._dependencies = dependencies
  }

  offer(nextAction: string): void {
    const current = this._dependencies.currentSession()
    this._intent = null

    if (nextAction !== 'create_first_product' || !current?.sessionId || !current.canCreate) {
      return
    }

    this._intent = { sessionId: current.sessionId, epoch: current.epoch }
  }

  consume(): boolean {
    const offered = this._intent
    this._intent = null
    const current = this._dependencies.currentSession()

    if (!offered || !current?.canCreate) {
      return false
    }

    return offered.epoch === current.epoch && offered.sessionId === current.sessionId
  }
}

// The instance carries a nonsecret presentation intent. It never survives a
// document reload, a different authority generation, or its first consumption.
export const firstProductHandoff: IFirstProductHandoff = new FirstProductHandoff({
  currentSession: () => {
    const { user, isAuthenticated } = useAuthStore.getState()

    if (!user || !isAuthenticated) {
      return null
    }

    return { sessionId: user.sessionId, epoch: currentAuthorityEpoch(),
      canCreate: !!user.permissions?.includes('products:view') && user.permissions.includes('products:create') }
  },
})

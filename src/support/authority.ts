import type { AuthUser } from '../types/auth'
import { supportClockNow } from './clock'
import { SUPPORT, SUPPORT_REVISION, SUPPORT_UUID_V7 } from './constants'
import type { SupportAuthorityStore, SupportContext, SupportNotice, SupportProjection, SupportSnapshot } from './models'

export function supportScopeKey(context: SupportContext, actor: AuthUser): string {
  return JSON.stringify([actor.id, actor.clientId, actor.sessionId, actor.securityRevision, 'support', context.targetClientId,
    context.id, context.revision, context.scopeHash, actor.assuranceGeneration ?? null])
}

/** Memory only. The server authorizes every operation independently. */
export function createSupportAuthority(): SupportAuthorityStore {
  let current: SupportSnapshot = { generation: 0, scopeKey: null, context: null, projection: null, notice: null }
  const listeners = new Set<() => void>()
  const controllers = new Set<AbortController>()
  const emit = () => listeners.forEach(listener => listener())
  const retire = (notice?: SupportNotice) => {
    // Publish the new epoch and empty state before cancelling can yield.
    current = { generation: current.generation + 1, scopeKey: null, context: null, projection: null, notice: notice ?? null }
    emit()
    const retiring = [...controllers]
    controllers.clear()
    retiring.forEach(controller => controller.abort())
  }
  return {
    clearNotice: generation => {
      if (generation === current.generation && current.notice) {
        current = { ...current, notice: null }
        emit()
      }
    },
    snapshot: () => current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    retire,
    bind: (context: SupportContext, actor: AuthUser) => {
      retire()

      if (context.operatorId !== actor.id || context.targetClientId === actor.clientId || !actor.sessionId || !SUPPORT_UUID_V7.test(actor.sessionId) ||
        !actor.securityRevision || !SUPPORT_REVISION.test(actor.securityRevision) || actor.securityRevision === '0' ||
        !actor.platformPermissions?.includes(SUPPORT.permission) || Date.parse(context.expiresAt) <= supportClockNow(context.clock)) {
        throw new Error('Verify the current operator and support context before continuing.')
      }

      const scopeKey = supportScopeKey(context, actor)
      current = { ...current, context, scopeKey }
      emit()
    },
    capture: () => {
      const generation = current.generation
      return { generation, isCurrent: () => generation === current.generation && (!current.context || Date.parse(current.context.expiresAt) > supportClockNow(current.context.clock)) }
    },
    retain: (projection: SupportProjection, generation: number) => {
      const context = current.context
      const permission = projection.kind === 'draft' ? SUPPORT.draftRead : SUPPORT.identityRead

      if (!context || current.generation !== generation || Date.parse(context.expiresAt) <= supportClockNow(context.clock) ||
        !context.productIds.includes(projection.productId) || !context.operations.includes(permission) ||
        projection.kind === 'identity' && projection.clientId !== context.targetClientId) {
        return false
      }

      current = { ...current, projection }
      emit()
      return true
    },
    own: controller => {
      controllers.add(controller)
      return () => { controllers.delete(controller) }
    },
  }
}

export const supportAuthority = createSupportAuthority()

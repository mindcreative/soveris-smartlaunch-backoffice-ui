import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { ACCOUNT_LIMITS } from './constants/accountLifecycle'
import type { AccountFlow, AccountFlowDependencies, CapturedAccountProof, PendingAccount } from './models/accountLifecycle'

export function createAccountFlow(dependencies: AccountFlowDependencies): AccountFlow {
  let pending: PendingAccount | null = null
  let captured: CapturedAccountProof | null = null
  let generation = 0
  let navigationGeneration = 0
  let controller: AbortController | null = null

  function cancel(): void {
    generation++
    controller?.abort()
    controller = null
  }

  return {
    pending: () => {
      if (pending && pending.expiresAt <= dependencies.now()) {
        pending = null
      }

      return pending
    },
    setPending: (receipt, email, requestStartedAt = dependencies.now()) => {
      pending = { pendingToken: receipt.pendingToken, email,
        expiresAt: Math.min(dependencies.now(), requestStartedAt) + receipt.expiresIn * 1000,
        nextRequestAt: dependencies.now() + ACCOUNT_LIMITS.resendPacingSeconds * 1000 }
    },
    pacePending: seconds => {
      if (pending) {
        pending = { ...pending, nextRequestAt: dependencies.now() + seconds * 1000 }
      }
    },
    setProof: proof => { captured = proof },
    proof: kind => {
      if (captured && captured.expiresAt <= dependencies.now()) {
        captured = null
      }

      return captured?.kind === kind ? captured.proof : null
    },
    releaseProof: kind => {
      const proof = captured?.kind === kind && captured.expiresAt > dependencies.now() ? captured : null
      captured = null
      pending = null
      cancel()

      return proof
    },
    begin: () => {
      cancel()
      controller = new AbortController()
      const currentGeneration = generation
      const currentNavigation = navigationGeneration
      const epoch = dependencies.epoch()
      const session = dependencies.session()

      return { signal: controller.signal, isCurrent: () => generation === currentGeneration &&
        epoch === dependencies.epoch() && session === dependencies.session(),
        pageIsCurrent: () => navigationGeneration === currentNavigation }
    },
    cancel,
    clear: () => {
      cancel()
      pending = null
      captured = null
    },
    leavePage: preservePending => {
      navigationGeneration++
      cancel()
      captured = null

      if (!preservePending) {
        pending = null
      }
    },
  }
}

function storedSession(): string {
  try {
    return JSON.stringify([localStorage.getItem('backoffice_access_token'), localStorage.getItem('backoffice_refresh_token')])
  } catch {
    return ''
  }
}

export const accountFlow = createAccountFlow({ now: Date.now, epoch: currentAuthorityEpoch, session: storedSession })

const proofWindow = window as Window & { __takeAccountProof?: () => CapturedAccountProof | null }
const takeProof = proofWindow.__takeAccountProof
{
  const initialProof = takeProof?.()

  if (initialProof) {
    accountFlow.setProof(initialProof)
  }
}

delete proofWindow.__takeAccountProof
window.addEventListener('account:proof-entry', () => {
  const proof = takeProof?.()
  accountFlow.leavePage()

  if (proof) {
    accountFlow.setProof(proof)
  }
})
window.addEventListener('pagehide', () => accountFlow.leavePage())

import { parseMfaRequired } from './mfaParsing'
import { googleAccountApi } from './googleAccountApi'
import { MFA } from './constants/mfa'
import type { MfaBoundChallenge, MfaOperation } from './models/mfa'

const protocol = MFA.recoveryPopupProtocol

/** The original recovery continuation never leaves the owning document. */
export function refreshGoogleRecoveryPrimary(operation: MfaOperation, expiresAt: string): Promise<MfaBoundChallenge> {
  const popup = window.open('about:blank', '_blank', 'popup,width=520,height=720')

  if (!popup) {
    return Promise.reject({ status: 400, code: 'invalid_mfa_flow' })
  }

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')

  return new Promise((resolve, reject) => {
    let settled = false
    const end = Math.min(Date.parse(expiresAt), Date.now() + MFA.challengeMilliseconds)

    function finish(value?: MfaBoundChallenge): void {
      if (settled) {
        return
      }

      settled = true
      window.removeEventListener('message', receive)
      operation.signal.removeEventListener('abort', abort)
      clearInterval(timer)
      popup!.close()

      if (value) {
        resolve(value)
      } else {
        reject({ status: 400, code: 'invalid_mfa_flow' })
      }
    }

    function abort(): void {
      finish()
    }

    function receive(event: MessageEvent): void {
      if (event.origin !== window.location.origin || event.source !== popup || !operation.isCurrent()
        || !operation.pageIsCurrent() || Date.now() >= end) {
        return
      }

      const data = event.data

      if (!data || data.protocol !== protocol) {
        return
      }

      if (data.kind === 'ready' && Object.keys(data).length === 2) {
        popup!.postMessage({ protocol, kind: 'bind', nonce }, window.location.origin)
      } else if (data.kind === 'primary' && data.nonce === nonce && Object.keys(data).length === 4) {
        try {
          const result = parseMfaRequired(data.result)
          popup!.postMessage({ protocol, kind: 'accepted', nonce }, window.location.origin)
          finish({ challenge: result.challenge, csrfToken: result.csrfToken })
        } catch {
          finish()
        }
      }
    }

    const timer = setInterval(() => {
      if (popup.closed || !operation.isCurrent() || !operation.pageIsCurrent() || Date.now() >= end) {
        finish()
      }
    }, MFA.recoveryPopupPollMilliseconds)
    window.addEventListener('message', receive)
    operation.signal.addEventListener('abort', abort, { once: true })

    if (operation.signal.aborted || !Number.isFinite(end) || Date.now() >= end) {
      finish()

      return
    }

    void googleAccountApi.start('login', undefined, operation.signal).then(start => {
      if (!settled && operation.isCurrent() && operation.pageIsCurrent()) {
        popup.location.replace(start.authorizationUrl)
      } else {
        finish()
      }
    }, () => finish())
  })
}

/** Exact opener/origin and a per-window handshake; no storage, URL or broadcast transport. */
export function listenForRecoveryParent(onBound: (send: (result: unknown) => void) => void): () => void {
  const parent = window.opener as Window | null

  if (!parent) {
    return () => undefined
  }

  let nonce: string | null = null
  let active = true

  function receive(event: MessageEvent): void {
    if (event.origin !== window.location.origin || event.source !== parent || !event.data || event.data.protocol !== protocol) {
      return
    }

    const data = event.data

    if (data.kind === 'bind' && nonce === null && typeof data.nonce === 'string' && /^[0-9a-f]{64}$/.test(data.nonce)
      && Object.keys(data).length === 3) {
      nonce = data.nonce
      clearInterval(timer)
      onBound(result => {
        if (active && nonce !== null) {
          parent!.postMessage({ protocol, kind: 'primary', nonce, result }, window.location.origin)
        }
      })
    } else if (data.kind === 'accepted' && nonce !== null && data.nonce === nonce && Object.keys(data).length === 3) {
      nonce = null
      window.close()
    }
  }

  function ready(): void {
    parent!.postMessage({ protocol, kind: 'ready' }, window.location.origin)
  }

  const timer = setInterval(ready, MFA.recoveryPopupReadyMilliseconds)
  window.addEventListener('message', receive)
  ready()

  return () => {
    active = false
    nonce = null
    clearInterval(timer)
    window.removeEventListener('message', receive)
  }
}

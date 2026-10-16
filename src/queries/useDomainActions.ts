import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { domainsApi } from '../api/domainsApi'
import type { ApiError } from '../api/apiClient'
import { createUuidV7 } from '../lib/uuidV7'
import { domainKeys, assertDomainScope, invalidateDomainConsequences } from './domainQueries'
import { blockDomainAuthority, type DomainScope } from './domainScope'
import { clearPrivateClientScope } from './billingQueries'
import type { DomainTracker } from './domainTracker'

type Command = { action: 'verify' } | { action: 'release' } | { action: 'retry'; operationId: string } | { action: 'primary'; revision: string }
export function useDomainActions(scope: DomainScope, id: string, tracker: DomainTracker, productsAllowed: boolean) {
  const client = useQueryClient(), busy = useRef(false), alive = useRef(true)
  const controller = useRef<AbortController | null>(null), retryOperation = useRef<string | null>(null)
  const generation = useRef(0)
  const [message, setMessage] = useState(''), [unresolvedRetry, setUnresolvedRetry] = useState(false)
  const [embargoes, setEmbargoes] = useState({ verification: 0, primary: 0, release: 0 })
  const embargoRef = useRef(embargoes); embargoRef.current = embargoes
  useEffect(() => {
    alive.current = true
    const visibility = () => {
      if (document.visibilityState !== 'hidden' || !busy.current) return
      generation.current++; controller.current?.abort(); busy.current = false
      setUnresolvedRetry(retryOperation.current !== null)
      setMessage('Outcome unconfirmed after visibility changed. Check current status before another intent.')
    }
    document.addEventListener('visibilitychange', visibility)
    return () => { alive.current = false; generation.current++; controller.current?.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  const mutation = useMutation({
    mutationKey: domainKeys.command(scope, id, 'action'), retry: false,
    mutationFn: async (command: Command) => {
      assertDomainScope(scope); controller.current = new AbortController()
      const signal = controller.current.signal
      const value = command.action === 'verify' ? await domainsApi.verify(id, signal)
        : command.action === 'retry' ? await domainsApi.retry(id, command.operationId, signal)
        : command.action === 'release' ? await domainsApi.release(id, signal)
        : await domainsApi.primary(scope.clientId, id, command.revision, signal)
      assertDomainScope(scope, signal); return value
    },
  })
  const run = async (command: Command) => {
    const budget = command.action === 'verify' || command.action === 'retry' ? 'verification' : command.action
    if (busy.current || performance.now() < embargoRef.current[budget]) return false
    try { assertDomainScope(scope) } catch { return false }
    busy.current = true; const attempt = ++generation.current
    tracker.pause(false, 'A domain action is pending. Current serving status is being reconciled.')
    setMessage(command.action === 'verify' ? 'Requesting verification…' : command.action === 'retry' ? 'Requesting verification Retry…' : command.action === 'release' ? 'Releasing domain; awaiting acceptance…' : 'Changing primary…')
    try {
      const response = await mutation.mutateAsync(command)
      if (!alive.current || generation.current !== attempt) return false
      assertDomainScope(scope, controller.current?.signal)
      if (command.action === 'release' && 'releaseId' in response) tracker.acceptRelease(response)
      if (command.action === 'retry') { retryOperation.current = null; setUnresolvedRetry(false) }
      setMessage(command.action === 'release' ? 'Release accepted. Serving is disabled; cleanup confirmation is tracked separately.' : 'Action accepted. Loading current authoritative status; ownership verification alone does not mean Active.')
      void invalidateDomainConsequences(client, scope, productsAllowed)
      tracker.start(); return true
    } catch (error) {
      if (!alive.current || generation.current !== attempt || controller.current?.signal.aborted) return false
      try { assertDomainScope(scope) } catch { return false }
      const problem = error as ApiError
      if (problem.status === 401 || problem.status === 403 && problem.code !== 'feature_not_available') {
        retryOperation.current = null; setUnresolvedRetry(false); tracker.deny()
        void clearPrivateClientScope(client, scope.clientId); blockDomainAuthority(scope)
        if (problem.status === 401) window.dispatchEvent(new Event('auth:cleared'))
        return false
      }
      if (problem.retryAfterSeconds !== undefined) setEmbargoes(current => ({ ...current, [budget]: performance.now() + problem.retryAfterSeconds! * 1000 }))
      const uncertain = !problem.status || problem.status >= 500 || problem.code === 'time_zone_not_set'
      if (command.action === 'retry') setUnresolvedRetry(uncertain)
      if (!uncertain && command.action === 'retry') retryOperation.current = null
      setMessage(problem.code === 'time_zone_not_set'
        ? 'Ask an administrator to save your timezone, then Check status. This action may already have committed; retain the original Retry identity.'
        : uncertain ? 'Outcome unconfirmed. Authorized reads reconcile this immutable domain. An unresolved Retry reuses its original operation identity; review current primary before a new primary intent.'
        : problem.code === 'stale_revision' ? 'The revision or eligibility changed. Current status is being refreshed; review it before another primary intent.'
        : problem.message || 'The action could not be confirmed. Check current status.')
      tracker.start(); return false
    } finally { if (generation.current === attempt) busy.current = false }
  }
  return {
    message, unresolvedRetry, retryUntil: embargoes.verification, primaryUntil: embargoes.primary, releaseUntil: embargoes.release, pending: mutation.isPending,
    verify: () => run({ action: 'verify' }),
    retry: () => { retryOperation.current ??= createUuidV7(); return run({ action: 'retry', operationId: retryOperation.current }) },
    release: () => run({ action: 'release' }),
    primary: (revision: string) => run({ action: 'primary', revision }),
  }
}

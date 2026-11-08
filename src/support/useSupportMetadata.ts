import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supportApi } from './client'
import { supportAuthority } from './authority'
import { retireSupport } from './lifetime'
import { supportFailure } from './errors'
import { SUPPORT } from './constants'
import type { SupportInboxSnapshot, SupportMetadata, SupportOutcome } from './models'
import { useSupportSnapshot } from './useSupportAction'

function newer(previous: SupportMetadata | null, next: SupportMetadata | null): SupportMetadata | null {
  if (previous && next && previous.id === next.id && (BigInt(previous.revision) > BigInt(next.revision)
    || previous.state === 'ended' && next.state !== 'ended')) {
    throw new Error('Lifecycle verification returned an older state')
  }

  return next
}

/** Only authorized metadata reads; no activation, mutation or product reads. */
export function useSupportMetadata(owner: boolean, allowed: boolean) {
  const actor = useAuthStore(state => state.user)
  const { generation } = useSupportSnapshot()
  const scope = JSON.stringify([owner, actor?.id, actor?.clientId, actor?.clientRoleId, actor?.sessionId, actor?.securityRevision,
    actor?.permissions, actor?.platformPermissions, actor?.mfaState, actor?.assuranceGeneration])
  const authority = useRef(scope)
  authority.current = scope
  const selected = useRef<{ scope: string; id: string | null }>({ scope, id: null })
  const sequence = useRef(0)
  const active = useRef<{ selected: string | null; scope: string; before?: string; promise: Promise<void>; controller: AbortController } | null>(null)
  const mounted = useRef(true)
  const [inbox, setInbox] = useState<SupportInboxSnapshot | null>(null)
  const inboxRef = useRef<SupportInboxSnapshot | null>(null)
  const [pending, setPending] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const nextReadAt = useRef(0)
  const visible = inbox?.scope === scope && (owner || inbox.generation === generation) ? inbox : null
  const stale = unavailable || !visible || visible.generation !== generation

  // A callback retained across an authority change must not cancel newer work.
  // Response fencing alone cannot protect ownership of an in-flight refresh.
  const scopeIsCurrent = () => mounted.current && authority.current === scope

  function refresh(selection?: string | null, before?: string, automatic = false): Promise<void> {
    if (!allowed || !scopeIsCurrent() || automatic && Date.now() < nextReadAt.current) {
      return Promise.resolve()
    }

    const selectedId = selection === undefined ? selected.current.scope === scope ? selected.current.id : null : selection
    selected.current = { scope, id: selectedId }
    const running = active.current

    if (running?.before === before && running?.scope === scope && running.selected === selectedId && !running.controller.signal.aborted) {
      return running.promise
    }

    running?.controller.abort()
    const request = ++sequence.current
    const controller = new AbortController()
    const release = supportAuthority.own(controller)
    const original = supportAuthority.capture()
    const current = () => mounted.current && !controller.signal.aborted && sequence.current === request
      && authority.current === scope && original.isCurrent()
    setPending(true)
    const promise = (async () => {
      try {
        const page = await supportApi.list(owner, before, controller.signal)
        const detail = selectedId ? await supportApi.detail(selectedId, owner, controller.signal) : null

        if (current()) {
          supportAuthority.clearNotice(original.generation)
          const previous = inboxRef.current
          const accepted = newer(previous?.scope === scope ? previous.detail : null, detail)
          const next = { scope, generation: original.generation, page: { ...page, items: page.items.map(item => item.id === accepted?.id ? accepted : item) },
            detail: accepted, checkedAt: new Date().toISOString() }
          inboxRef.current = next
          setInbox(next)
          setUnavailable(false)
          nextReadAt.current = 0
        }
      } catch (error) {
        if (original.isCurrent() && !controller.signal.aborted) {
          retireSupport(supportFailure(error).notice)
        }

        if (mounted.current && authority.current === scope && sequence.current === request) {
          setUnavailable(true)
          nextReadAt.current = Math.max(Date.now() + SUPPORT.ownerRefreshMilliseconds, supportAuthority.snapshot().notice?.retryAt ?? 0)
        }
      } finally {
        release()

        if (sequence.current === request) {
          active.current = null

          if (mounted.current) {
            setPending(false)
          }
        }
      }
    })()
    active.current = { selected: selectedId, scope, before, promise, controller }
    return promise
  }

  useEffect(() => {
    mounted.current = true
    nextReadAt.current = 0
    selected.current = { scope, id: null }

    if (allowed) {
      void refresh(null)
    }

    return () => {
      mounted.current = false
      sequence.current++
      active.current?.controller.abort()
      active.current = null
    }
  }, [scope, allowed])

  useEffect(() => {
    if (!owner || !allowed) {
      return
    }

    const resume = () => {
      if (!scopeIsCurrent()) {
        return
      }

      if (document.visibilityState === 'visible') {
        setUnavailable(true)
        void refresh(undefined, undefined, true)
      } else {
        active.current?.controller.abort()
      }
    }
    const timer = window.setInterval(resume, SUPPORT.ownerRefreshMilliseconds)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [scope, allowed, owner])

  async function reconcile(outcome: SupportOutcome): Promise<void> {
    if (!allowed || !scopeIsCurrent()) {
      return
    }

    sequence.current++
    active.current?.controller.abort()
    active.current = null
    const previous = inboxRef.current

    if (previous?.scope === scope && previous.detail?.id === outcome.id && BigInt(outcome.revision) >= BigInt(previous.detail.revision)) {
      const detail = { ...previous.detail, ...outcome }
      const next = { ...previous, detail, page: { ...previous.page, items: previous.page.items.map(item => item.id === detail.id ? detail : item) } }
      inboxRef.current = next
      setInbox(next)
    }

    setUnavailable(true)
    nextReadAt.current = 0
    await refresh(outcome.id)
  }

  return { reconcile, visible, detail: visible?.detail ?? null, pending, stale, refresh }
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supportAuthority } from './authority'
import { supportFailure, SupportScopeChangedError } from './errors'
import { retireSupport } from './lifetime'

export function useSupportSnapshot() {
  return useSyncExternalStore(supportAuthority.subscribe, supportAuthority.snapshot)
}

export function useSupportAction() {
  const snapshot = useSupportSnapshot()
  const [pending, setPending] = useState(false)
  const active = useRef(false)
  const mounted = useRef(true)
  const owned = useRef(new Set<AbortController>())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      owned.current.forEach(controller => controller.abort())
      owned.current.clear()
    }
  }, [])
  useEffect(() => { active.current = false; setPending(false) }, [snapshot.generation])
  async function run(action: (signal: AbortSignal, current: () => boolean) => Promise<void>): Promise<void> {
    if (!mounted.current || active.current || snapshot.notice && snapshot.notice.retryAt > Date.now()) {
      return
    }

    const original = supportAuthority.capture()
    const controller = new AbortController()
    owned.current.add(controller)
    const release = supportAuthority.own(controller)
    active.current = true
    setPending(true)

    try {
      await action(controller.signal, () => mounted.current && original.isCurrent() && !controller.signal.aborted)
    } catch (error) {
      if (mounted.current && original.isCurrent() && !controller.signal.aborted && !(error instanceof SupportScopeChangedError)) {
        retireSupport(supportFailure(error).notice)
      }
    } finally {
      release()
      owned.current.delete(controller)

      if (mounted.current && original.isCurrent()) {
        active.current = false
        setPending(false)
      }
    }
  }
  return { pending, run }
}

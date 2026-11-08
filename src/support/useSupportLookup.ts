import { useEffect, useRef, useState } from 'react'
import { supportAuthority } from './authority'
import { supportApi } from './client'
import { useSupportRetry } from './SupportStatus'
import { supportFailure } from './errors'
import type { SupportCustomerLabel, SupportLookupPage, SupportNotice, SupportProductLabel } from './models'
import { useSupportSnapshot } from './useSupportAction'

/** Keep one bounded page. Each context/open/request transition fences late completions. */
export function useSupportLookup(customer: string | null, context: number, enabled: boolean) {
  const { generation } = useSupportSnapshot()
  const parameters = JSON.stringify([generation, customer, context, enabled])
  const sequence = useRef({ parameters, value: 0 })

  if (sequence.current.parameters !== parameters) {
    sequence.current = { parameters, value: sequence.current.value + 1 }
  }

  const key = sequence.current.value
  const [result, setResult] = useState<{ key: number; page: SupportLookupPage<SupportCustomerLabel | SupportProductLabel>; number: number } | null>(null)
  const [failure, setFailure] = useState<{ key: number; notice: SupportNotice } | null>(null)
  const [loading, setLoading] = useState<number | null>(null)
  const running = useRef<AbortController | null>(null)
  const requestSequence = useRef(0)
  const open = useRef(false)
  const page = result?.key === key ? result.page : null
  const number = result?.key === key ? result.number : 1
  const currentFailure = failure?.key === key ? failure.notice : null
  const retrySeconds = useSupportRetry(currentFailure)

  async function load(cursor?: string, pageNumber = 1): Promise<void> {
    if (sequence.current.value !== key || !enabled || customer === '' || !open.current
        || Date.now() < (failure?.key === key ? failure.notice.retryAt : 0) || running.current) {
      return
    }

    const controller = new AbortController()
    const request = ++requestSequence.current
    running.current = controller
    const release = supportAuthority.own(controller)
    setResult(null)
    setFailure(null)
    setLoading(key)

    try {
      const next = customer === null ? await supportApi.customers(cursor, controller.signal)
        : await supportApi.products(customer, cursor, controller.signal)

      if (!controller.signal.aborted && sequence.current.value === key && requestSequence.current === request) {
        setResult({ key, page: next, number: pageNumber })
      }
    } catch (error) {
      if (!controller.signal.aborted && sequence.current.value === key && requestSequence.current === request) {
        setFailure({ key, notice: supportFailure(error).notice })
      }
    } finally {
      release()

      if (running.current === controller) {
        running.current = null
        setLoading(null)
      }
    }
  }

  function abort(): void {
    ++requestSequence.current
    running.current?.abort()
    running.current = null
    setLoading(null)
  }

  useEffect(() => {
    abort()

    if (open.current && enabled) {
      void load()
    }

    return abort
  }, [key])

  return { page, number, failure: currentFailure, retrySeconds, loading: loading === key,
    more: () => {
      if (page?.nextCursor) {
        void load(page.nextCursor, number + 1)
      }
    },
    start: () => { void load() },
    retry: () => { void load() },
    dismiss: () => { open.current = false; abort() },
    resume: () => { open.current = true; void load() } }
}

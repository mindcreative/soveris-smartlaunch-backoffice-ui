import { useEffect, useRef, useState } from 'react'
import type { SupportNotice } from './models'
import { useSupportSnapshot } from './useSupportAction'

export function useSupportRetry(lookupNotice?: SupportNotice | null): number {
  const snapshot = useSupportSnapshot()
  const notice = lookupNotice === undefined ? snapshot.notice : lookupNotice
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())

    if (!notice || notice.retryAt <= Date.now()) {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [notice])
  return notice ? Math.max(0, Math.ceil((notice.retryAt - now) / 1000)) : 0
}

export function SupportStatus({ pending = false, focusError = true }: { pending?: boolean; focusError?: boolean }) {
  const { notice } = useSupportSnapshot()
  const remaining = useSupportRetry()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusError && notice && notice.status >= 400) {
      if (!document.activeElement?.closest('[aria-label="Exact support request"]')) {
        heading.current?.focus()
      }
    }
  }, [notice, focusError])
  return <>
    {notice && <section role={notice.status >= 400 ? 'alert' : 'status'} className="rounded-lg border border-line bg-subtle p-4">
      <h2 ref={heading} tabIndex={-1} className="font-semibold">{notice.status >= 400 ? 'Current support access withheld' : 'Support access status'}</h2>
      <p>{notice.message}</p>
      {remaining > 0 && <p aria-live="off">Try again in {remaining} seconds.</p>}
      {notice.status === 429 && <p role="status">{remaining > 0 ? 'Wait before retrying.' : 'You can retry when ready.'}</p>}
    </section>}
    {pending && <p role="status">Verifying the current server state…</p>}
  </>
}

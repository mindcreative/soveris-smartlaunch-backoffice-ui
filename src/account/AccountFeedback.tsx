import { useEffect, useRef } from 'react'
import type { AccountFeedbackProps } from './models/accountPresentation'

export function AccountFeedback({ error, pending }: AccountFeedbackProps) {
  const summary = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) {
      summary.current?.focus()
    }
  }, [error])

  return <>
    {pending && <p role="status" className="text-sm text-muted">Submitting your request…</p>}
    {error && <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger focus-visible:ring-2 focus-visible:ring-focus">
      <p>{error.message}</p>
      {error.retryAfterSeconds !== undefined && <p>Wait at least {error.retryAfterSeconds} seconds before trying again.</p>}
      {error.correlationId && <p className="mt-2 break-all text-xs">Support reference: {error.correlationId}</p>}
    </div>}
  </>
}

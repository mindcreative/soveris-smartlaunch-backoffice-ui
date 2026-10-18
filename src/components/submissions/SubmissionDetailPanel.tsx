import { X } from 'lucide-react'
import { useEffect, useCallback } from 'react'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { ErrorDisplay } from '../shared/ErrorDisplay'
import { Badge } from '../shared/Badge'
import type { Submission } from '@/types'
import { LocalInstant } from '@/timezone/LocalInstant'
import type { LocalInstantValue } from '@/timezone/LocalInstant'

interface SubmissionDetailPanelProps {
  submission: Submission | null
  isLoading: boolean
  error: Error | null
  isOpen: boolean
  onClose: () => void
}

export function SubmissionDetailPanel({
  submission,
  isLoading,
  error,
  isOpen,
  onClose,
}: SubmissionDetailPanelProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  const getStatusInfo = () => {
    if (submission == null) return { label: 'Unknown', variant: 'neutral' as const }
    const typedStatus = (submission as unknown as Record<string, unknown>).status as string | undefined
    if (typedStatus && ['pending', 'verified', 'invalid'].includes(typedStatus)) {
      const variants: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
        verified: 'success',
        pending: 'warning',
        invalid: 'error',
      }
      return { label: typedStatus.charAt(0).toUpperCase() + typedStatus.slice(1), variant: variants[typedStatus] }
    }
    const isVerified = (submission as unknown as Record<string, unknown>).isVerified as boolean | undefined
    if (isVerified === true) return { label: 'Verified', variant: 'success' as const }
    if (isVerified === false) return { label: 'Pending', variant: 'warning' as const }
    return { label: 'Unknown', variant: 'neutral' as const }
  }

  const statusInfo = getStatusInfo()

  const formatDate = (value: LocalInstantValue | undefined | null) =>
    value ? <LocalInstant value={value} /> : '\u2014'

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-overlay/40 transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-surface shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Submission details"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Submission Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 p-1.5 text-muted hover:text-muted rounded-md hover:bg-subtle transition-colors"
            aria-label="Close panel" title="Close panel"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="px-6 py-8">
              <ErrorDisplay message={error.message || 'Failed to load submission'} onRetry={onClose} />
            </div>
          ) : submission ? (
            <div className="px-6 py-5 space-y-6">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Identity</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-muted">ID</dt>
                    <dd className="text-sm font-mono text-foreground break-all mt-0.5">{submission.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Email</dt>
                    <dd className="text-sm text-foreground mt-0.5">{submission.email}</dd>
                  </div>
                  {submission.name && (
                    <div>
                      <dt className="text-sm text-muted">Name</dt>
                      <dd className="text-sm text-foreground mt-0.5">{submission.name}</dd>
                    </div>
                  )}
                  {(submission as unknown as Record<string, unknown>).productName ? (
                    <div>
                      <dt className="text-sm text-muted">Product</dt>
                      <dd className="text-sm text-foreground mt-0.5">{(submission as unknown as Record<string, unknown>).productName as string}</dd>
                    </div>
                  ) : submission.product ? (
                    <div>
                      <dt className="text-sm text-muted">Product</dt>
                      <dd className="text-sm text-foreground mt-0.5">{submission.product}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Status</h3>
                <Badge variant={statusInfo.variant} size="md">{statusInfo.label}</Badge>
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Timestamps</h3>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-muted">Submitted</dt>
                    <dd className="text-sm text-foreground mt-0.5">{formatDate(submission.createdAt)}</dd>
                  </div>
                  {submission.updatedAt && (
                    <div>
                      <dt className="text-sm text-muted">Last Updated</dt>
                      <dd className="text-sm text-foreground mt-0.5">{formatDate(submission.updatedAt)}</dd>
                    </div>
                  )}
                  {submission.expiresAt && (
                    <div>
                      <dt className="text-sm text-muted">Expires At</dt>
                      <dd className="text-sm text-foreground mt-0.5">{formatDate(submission.expiresAt)}</dd>
                    </div>
                  )}
                </dl>
              </section>
              {submission.formData && Object.keys(submission.formData).length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Form Data</h3>
                  <div className="border border-line rounded-lg overflow-hidden">
                    <table className="text-sm w-full">
                      <thead className="bg-subtle">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-muted border-b border-line">Field</th>
                          <th className="text-left px-4 py-2 font-medium text-muted border-b border-line">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {Object.entries(submission.formData).map(([key, value]) => (
                          <tr key={key}>
                            <td className="px-4 py-2 font-mono text-xs text-muted bg-subtle/50 border-r border-line">{key}</td>
                            <td className="px-4 py-2 text-foreground break-all max-w-xs">
                              {value === null || value === undefined
                                ? '\u2014'
                                : typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : String(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {(submission as unknown as Record<string, unknown>).isVerified !== undefined && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Backend Field</h3>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-sm text-muted">isVerified</dt>
                      <dd className="text-sm font-mono text-foreground mt-0.5">
                        {String((submission as unknown as Record<string, unknown>).isVerified)}
                      </dd>
                    </div>
                  </dl>
                </section>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}

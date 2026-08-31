import { useEffect, useCallback } from 'react'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { ErrorDisplay } from '../shared/ErrorDisplay'
import { Badge } from '../shared/Badge'
import type { Submission } from '@/types'

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

  const formatDate = (value: string | undefined | null) => {
    if (!value) return '\u2014'
    try {
      return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return value
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Submission details"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Submission Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Identity</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-gray-500">ID</dt>
                    <dd className="text-sm font-mono text-gray-900 break-all mt-0.5">{submission.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Email</dt>
                    <dd className="text-sm text-gray-900 mt-0.5">{submission.email}</dd>
                  </div>
                  {submission.name && (
                    <div>
                      <dt className="text-sm text-gray-500">Name</dt>
                      <dd className="text-sm text-gray-900 mt-0.5">{submission.name}</dd>
                    </div>
                  )}
                  {(submission as unknown as Record<string, unknown>).productName ? (
                    <div>
                      <dt className="text-sm text-gray-500">Product</dt>
                      <dd className="text-sm text-gray-900 mt-0.5">{(submission as unknown as Record<string, unknown>).productName as string}</dd>
                    </div>
                  ) : submission.product ? (
                    <div>
                      <dt className="text-sm text-gray-500">Product</dt>
                      <dd className="text-sm text-gray-900 mt-0.5">{submission.product}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Status</h3>
                <Badge variant={statusInfo.variant} size="md">{statusInfo.label}</Badge>
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Timestamps</h3>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-gray-500">Submitted</dt>
                    <dd className="text-sm text-gray-900 mt-0.5">{formatDate(submission.createdAt)}</dd>
                  </div>
                  {submission.updatedAt && (
                    <div>
                      <dt className="text-sm text-gray-500">Last Updated</dt>
                      <dd className="text-sm text-gray-900 mt-0.5">{formatDate(submission.updatedAt)}</dd>
                    </div>
                  )}
                </dl>
              </section>
              {submission.formData && Object.keys(submission.formData).length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Form Data</h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="text-sm w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-gray-600 border-b border-gray-200">Field</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-600 border-b border-gray-200">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {Object.entries(submission.formData).map(([key, value]) => (
                          <tr key={key}>
                            <td className="px-4 py-2 font-mono text-xs text-gray-600 bg-gray-50/50 border-r border-gray-100">{key}</td>
                            <td className="px-4 py-2 text-gray-900 break-all max-w-xs">
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
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Backend Field</h3>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-sm text-gray-500">isVerified</dt>
                      <dd className="text-sm font-mono text-gray-900 mt-0.5">
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

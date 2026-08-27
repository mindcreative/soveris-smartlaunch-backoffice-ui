import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError, AuthRefreshLifecycleDetail } from '../../api/apiClient'
import { billingApi, BillingLedgerExportContractError, normalizeLedgerExportFilters } from '../../api/billingApi'
import { Modal } from '../shared/Modal'
import {
  billingExportKeys,
  cancelAndRemoveBillingExport,
  clearPrivateBillingQueries,
} from '../../queries/billingQueries'
import type {
  BillingLedgerExportAccepted,
  BillingLedgerExportAttempt,
  BillingLedgerExportFilters,
  BillingLedgerExportStatusMetadata,
  BillingLedgerFilters,
} from '../../types/billing'

export const LEDGER_EXPORT_POLL_INTERVAL_MS = 2_000
export const LEDGER_EXPORT_POLL_WINDOW_MS = 60_000

const FILTER_LABELS: Array<[keyof BillingLedgerExportFilters, string]> = [
  ['creditAccountId', 'Credit account ID'], ['from', 'From (inclusive)'], ['to', 'To (exclusive)'],
  ['transactionType', 'Transaction type'], ['actorUserId', 'Actor user ID'], ['jobId', 'Job ID'],
  ['reservationId', 'Reservation ID'],
]

type CommandState =
  | 'ready' | 'validation' | 'ambiguous' | 'denied' | 'transient' | 'contract'

function apiStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status : undefined
}

function exportSourceFilters(filters: BillingLedgerFilters): BillingLedgerFilters {
  const { pageSize: _pageSize, ...exportFilters } = filters
  return exportFilters
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))
}

function FilterScope({ filters }: { filters: BillingLedgerExportFilters }) {
  return (
    <dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
      {FILTER_LABELS.map(([key, label]) => (
        <div key={key} className="min-w-0 rounded-md bg-gray-50 p-2">
          <dt className="font-semibold text-gray-800">{label}</dt>
          <dd className="break-all text-gray-700">{filters[key] ?? 'Unfiltered'}</dd>
        </div>
      ))}
    </dl>
  )
}

function acceptedMetadata(accepted: BillingLedgerExportAccepted): BillingLedgerExportStatusMetadata {
  return {
    ...accepted, rowCount: null, byteSize: null, artifactExpiresAt: null, failureCode: null,
  }
}

export function LedgerExportPanel({
  clientId,
  filters,
  onPermissionDenied,
}: {
  clientId: string
  filters: BillingLedgerFilters
  onPermissionDenied: () => void
}) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogFilters, setDialogFilters] = useState<BillingLedgerFilters>({})
  const [attempt, setAttempt] = useState<BillingLedgerExportAttempt | null>(null)
  const [accepted, setAccepted] = useState<BillingLedgerExportAccepted | null>(null)
  const [automaticPolling, setAutomaticPolling] = useState(false)
  const [pollingPaused, setPollingPaused] = useState(false)
  const [commandState, setCommandState] = useState<CommandState>('ready')
  const [feedback, setFeedback] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [eligibilityTick, setEligibilityTick] = useState(0)
  const confirmInFlight = useRef(false)
  const downloadInFlight = useRef(false)
  const commandController = useRef<AbortController | null>(null)
  const downloadController = useRef<AbortController | null>(null)
  const scopeEpoch = useRef(0)
  const scopeClient = useRef(clientId)
  const attemptRef = useRef<BillingLedgerExportAttempt | null>(null)
  const deadline = useRef<number | null>(null)
  const previousStatus = useRef<string | null>(null)
  const statusHeadingRef = useRef<HTMLHeadingElement>(null)
  attemptRef.current = attempt

  useLayoutEffect(() => {
    if (scopeClient.current === clientId) return
    const formerClient = scopeClient.current
    scopeClient.current = clientId
    scopeEpoch.current += 1
    commandController.current?.abort()
    downloadController.current?.abort()
    confirmInFlight.current = false
    downloadInFlight.current = false
    setAttempt(null)
    setAccepted(null)
    setAutomaticPolling(false)
    setPollingPaused(false)
    setDialogOpen(false)
    setFeedback('')
    setCommandState('ready')
    void cancelAndRemoveBillingExport(queryClient, formerClient)
  }, [clientId, queryClient])

  const mutation = useMutation({
    mutationKey: billingExportKeys.request(clientId),
    mutationFn: ({ source, signal }: { source: BillingLedgerFilters; signal: AbortSignal }) =>
      billingApi.requestLedgerExport(clientId, source, signal),
    retry: false,
  })

  const statusQuery = useQuery({
    queryKey: attempt
      ? billingExportKeys.detail(clientId, attempt.exportId)
      : billingExportKeys.detail(clientId, 'no-active-export'),
    queryFn: async ({ signal }) => {
      if (!attempt) throw new BillingLedgerExportContractError('no accepted export is active')
      const result = await billingApi.getLedgerExportStatus(attempt, signal)
      return result.metadata
    },
    enabled: Boolean(attempt && automaticPolling),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return automaticPolling && (status === undefined || status === 'pending' || status === 'processing')
        ? LEDGER_EXPORT_POLL_INTERVAL_MS : false
    },
  })

  const disposePrivateWork = useCallback(async () => {
    scopeEpoch.current += 1
    commandController.current?.abort()
    downloadController.current?.abort()
    commandController.current = null
    downloadController.current = null
    confirmInFlight.current = false
    downloadInFlight.current = false
    setAutomaticPolling(false)
    setDialogOpen(false)
    const activeAttempt = attemptRef.current
    if (activeAttempt) await cancelAndRemoveBillingExport(queryClient, clientId, activeAttempt.exportId)
    else await cancelAndRemoveBillingExport(queryClient, clientId)
  }, [clientId, queryClient])

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<AuthRefreshLifecycleDetail>).detail
      const cleanup = disposePrivateWork().then(() => { setAttempt(null); setAccepted(null) })
      detail?.waitUntil(cleanup)
    }
    const handleClear = () => {
      setAttempt(null)
      setAccepted(null)
      void disposePrivateWork()
    }
    window.addEventListener('auth:refreshed', handleRefresh)
    window.addEventListener('auth:cleared', handleClear)
    return () => {
      window.removeEventListener('auth:refreshed', handleRefresh)
      window.removeEventListener('auth:cleared', handleClear)
    }
  }, [disposePrivateWork])

  useEffect(() => () => { void disposePrivateWork() }, [disposePrivateWork])

  useEffect(() => {
    if (!attempt || !automaticPolling || deadline.current === null) return
    const remaining = Math.max(0, deadline.current - Date.now())
    const timer = window.setTimeout(() => {
      setAutomaticPolling(false)
      setPollingPaused(true)
      void queryClient.cancelQueries({ queryKey: billingExportKeys.detail(clientId, attempt.exportId), exact: true })
      setAnnouncement('Automatic export status checks stopped. Generation may still continue.')
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [attempt, automaticPolling, clientId, queryClient])

  useEffect(() => {
    const data = statusQuery.data
    if (!data) return
    if (previousStatus.current !== data.status) {
      const wording = data.status === 'pending' ? 'Export is queued.'
        : data.status === 'processing' ? 'Export generation is in progress.'
          : data.status === 'completed' ? 'Export completed and is eligible for a private download.'
            : data.status === 'failed' ? 'Export generation failed. No partial file is available.'
              : 'Export expired. A new point-in-time export is required.'
      setAnnouncement(wording)
      previousStatus.current = data.status
    }
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'expired') {
      setAutomaticPolling(false)
      setPollingPaused(false)
    }
  }, [statusQuery.data])

  useLayoutEffect(() => {
    const error = statusQuery.error
    if (!error) return
    setAutomaticPolling(false)
    const status = apiStatus(error)
    if (status === 401 || status === 403) {
      setAttempt(null); setAccepted(null); setDialogOpen(false); setCommandState('denied')
      void clearPrivateBillingQueries(queryClient)
      if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
      else onPermissionDenied()
    } else if (error instanceof BillingLedgerExportContractError) {
      setAttempt(null); setAccepted(null); setCommandState('contract')
      if (attempt) void cancelAndRemoveBillingExport(queryClient, clientId, attempt.exportId)
    } else {
      setPollingPaused(true); setCommandState('transient')
      setFeedback('Automatic status checks paused after a temporary problem. The accepted export may still continue.')
    }
  }, [attempt, clientId, onPermissionDenied, queryClient, statusQuery.error])

  const openConfirmation = () => {
    setDialogFilters(exportSourceFilters(filters))
    setFeedback('')
    setDialogOpen(true)
  }

  const confirm = async () => {
    if (confirmInFlight.current) return
    confirmInFlight.current = true
    const epoch = scopeEpoch.current
    const controller = new AbortController()
    commandController.current = controller
    setFeedback('Submitting one ledger CSV export request…')
    try {
      const result = await mutation.mutateAsync({ source: dialogFilters, signal: controller.signal })
      if (epoch !== scopeEpoch.current || controller.signal.aborted) return
      if (attempt) await cancelAndRemoveBillingExport(queryClient, clientId, attempt.exportId, false)
      setAttempt(result)
      setAccepted(result)
      previousStatus.current = 'pending'
      deadline.current = Date.now() + LEDGER_EXPORT_POLL_WINDOW_MS
      setCommandState('ready')
      setPollingPaused(false)
      setAutomaticPolling(true)
      setDialogOpen(false)
      setFeedback('')
      setAnnouncement(`Ledger CSV export accepted. Export ID ${result.exportId}.`)
      requestAnimationFrame(() => requestAnimationFrame(() => statusHeadingRef.current?.focus()))
    } catch (error) {
      if (epoch !== scopeEpoch.current || controller.signal.aborted) return
      const status = apiStatus(error)
      if (status === 400) {
        setCommandState('validation')
        setFeedback('The server rejected the export scope. Review the applied filters before requesting again.')
      } else if (status === 401 || status === 403) {
        setDialogOpen(false); setAttempt(null); setAccepted(null); setCommandState('denied')
        if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        else onPermissionDenied()
        await clearPrivateBillingQueries(queryClient)
      } else {
        setDialogOpen(false)
        setCommandState('ambiguous')
        setFeedback('The request outcome is unknown. The server may have accepted an export, but no Export ID is available. A replacement could create another export.')
      }
    } finally {
      if (commandController.current === controller) commandController.current = null
      confirmInFlight.current = false
    }
  }

  const manualRefresh = async () => {
    if (!attempt || statusQuery.isFetching) return
    setFeedback('Refreshing export status without creating a new export…')
    const result = await statusQuery.refetch({ cancelRefetch: false })
    if (result.isSuccess) {
      setCommandState('ready')
      setFeedback(`Export status refreshed: ${result.data.status}.`)
      setAnnouncement(`Manual export status refresh returned ${result.data.status}.`)
    }
  }

  const download = async () => {
    if (!attempt || downloadInFlight.current) return
    downloadInFlight.current = true
    setDownloadBusy(true)
    setFeedback('Obtaining a fresh authorized reference and preparing the private CSV download…')
    const controller = new AbortController()
    downloadController.current = controller
    const epoch = scopeEpoch.current
    try {
      const result = await billingApi.getLedgerExportStatus(attempt, controller.signal)
      if (epoch !== scopeEpoch.current || controller.signal.aborted) return
      if (result.metadata.status !== 'completed' || !result.reference ||
          Date.parse(result.reference.expiresAt) <= Date.now() ||
          !result.metadata.artifactExpiresAt || Date.parse(result.metadata.artifactExpiresAt) <= Date.now()) {
        setFeedback('A fresh download reference is unavailable or expired. The completed export is retained; choose Download again to request a new reference.')
        return
      }
      const blob = await billingApi.redeemLedgerExport(attempt, result.reference, controller.signal)
      if (epoch !== scopeEpoch.current || controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `ledger-export-${attempt.exportId}.csv`
        anchor.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      setFeedback('Private ledger CSV download started. No reusable download reference was retained.')
      setAnnouncement('Private ledger CSV download started.')
    } catch (error) {
      if (epoch !== scopeEpoch.current || controller.signal.aborted) return
      const status = apiStatus(error)
      if (status === 401 || status === 403) {
        setAttempt(null); setAccepted(null)
        if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        else onPermissionDenied()
        await clearPrivateBillingQueries(queryClient)
      } else if (error instanceof BillingLedgerExportContractError) {
        setFeedback('The download response did not match the private export contract. No file was opened.')
      } else {
        setFeedback('The private download could not be completed. No partial file was opened. Choose Download to obtain a fresh reference.')
      }
    } finally {
      if (downloadController.current === controller) downloadController.current = null
      downloadInFlight.current = false
      setDownloadBusy(false)
    }
  }

  const unsafeStatusError = apiStatus(statusQuery.error) === 401 || apiStatus(statusQuery.error) === 403 ||
    statusQuery.error instanceof BillingLedgerExportContractError
  const metadata = unsafeStatusError ? null : statusQuery.data ?? (accepted ? acceptedMetadata(accepted) : null)
  const terminal = metadata?.status === 'failed' || metadata?.status === 'expired'
  const newRequestWarning = Boolean(
    attempt || commandState === 'ambiguous' || commandState === 'contract' || terminal
  )
  const requestActionAllowed = !metadata || metadata.status === 'completed' || terminal || commandState === 'ambiguous'
  const artifactEligible = metadata?.status === 'completed' && Boolean(
    metadata.artifactExpiresAt && Date.parse(metadata.artifactExpiresAt) > Date.now()
  )

  useEffect(() => {
    if (metadata?.status !== 'completed' || !metadata.artifactExpiresAt) return
    const remaining = Date.parse(metadata.artifactExpiresAt) - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(
      () => setEligibilityTick((current) => current + 1),
      Math.min(remaining + 1, 2_147_483_647)
    )
    return () => window.clearTimeout(timer)
  }, [eligibilityTick, metadata?.artifactExpiresAt, metadata?.status])

  return (
    <section aria-labelledby="ledger-export-title" className="state-indicator mb-6 min-w-0 rounded-lg border border-gray-300 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ledger-export-title" className="text-lg font-semibold text-gray-950">Ledger CSV export</h2>
          <p className="mt-1 text-sm text-gray-700">Request an asynchronous private CSV from the currently applied Client and filters.</p>
        </div>
        {requestActionAllowed && <button type="button" onClick={openConfirmation} disabled={mutation.isPending}
          className="min-h-11 rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">
          {mutation.isPending ? 'Requesting ledger CSV export…' : newRequestWarning || metadata ? 'Request a new CSV export' : 'Request ledger CSV export'}
        </button>}
      </div>

      {commandState === 'ambiguous' && <div role="alert" className="state-indicator mt-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Export acceptance is unknown</p><p className="mt-1">{feedback}</p></div>}
      {commandState === 'validation' && <div role="alert" className="state-indicator mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">{feedback}</div>}
      {commandState === 'contract' && <div role="alert" className="state-indicator mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">The export status response did not match the private Billing contract. Export controls were cleared.</div>}
      {commandState === 'transient' && <div role="status" className="state-indicator mt-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{feedback}</div>}

      {metadata && (
        <div className="state-indicator mt-4 min-w-0 rounded-md border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950">
          <h3 ref={statusHeadingRef} tabIndex={-1} className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Export status: {metadata.status}</h3>
          <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            <div><dt className="font-semibold">Export ID</dt><dd className="break-all">{metadata.exportId}</dd></div>
            <div><dt className="font-semibold">Client ID</dt><dd className="break-all">{metadata.clientId}</dd></div>
            <div><dt className="font-semibold">Requested</dt><dd><time dateTime={metadata.requestedAt}>{formatInstant(metadata.requestedAt)}</time></dd></div>
            <div><dt className="font-semibold">Export snapshot as of</dt><dd><time dateTime={metadata.asOf}>{formatInstant(metadata.asOf)}</time></dd></div>
            {metadata.rowCount !== null && <div><dt className="font-semibold">CSV rows</dt><dd>{metadata.rowCount}</dd></div>}
            {metadata.byteSize !== null && <div><dt className="font-semibold">CSV size</dt><dd>{metadata.byteSize} bytes</dd></div>}
            {metadata.artifactExpiresAt && <div><dt className="font-semibold">Artifact expires</dt><dd><time dateTime={metadata.artifactExpiresAt}>{formatInstant(metadata.artifactExpiresAt)}</time></dd></div>}
          </dl>
          <h4 className="mt-4 font-semibold">Immutable export filters</h4>
          <FilterScope filters={metadata.filters} />
          {metadata.status === 'pending' && <p className="mt-3 font-medium">Queued for generation. Ledger review remains available.</p>}
          {metadata.status === 'processing' && <p className="mt-3 font-medium">Generation is in progress. No percentage is available.</p>}
          {metadata.status === 'failed' && <p className="mt-3 font-medium">The server could not create the complete CSV. No partial data is available.</p>}
          {metadata.status === 'expired' && <p className="mt-3 font-medium">This private artifact expired. Request a new point-in-time export.</p>}
          {metadata.status === 'completed' && !artifactEligible && <p className="mt-3 font-medium">This completed export is no longer download-eligible. Request a new point-in-time export.</p>}
          {pollingPaused && (metadata.status === 'pending' || metadata.status === 'processing') && <p className="mt-3 font-medium">Automatic status checks stopped. Generation may still continue on the server.</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            {pollingPaused && (metadata.status === 'pending' || metadata.status === 'processing') && (
              <button type="button" onClick={() => void manualRefresh()} disabled={statusQuery.isFetching}
                className="min-h-11 rounded-md border border-blue-800 px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">
                {statusQuery.isFetching ? 'Refreshing export status…' : 'Refresh export status'}
              </button>
            )}
            {artifactEligible && (
              <button type="button" onClick={() => void download()} disabled={downloadBusy}
                className="min-h-11 rounded-md bg-indigo-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">
                {downloadBusy ? 'Preparing private CSV download…' : 'Download ledger CSV'}
              </button>
            )}
          </div>
          {feedback && commandState === 'ready' && <p role="status" className="mt-3 font-medium">{feedback}</p>}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

      <Modal isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title="Confirm ledger CSV export"
        descriptionId="ledger-export-dialog-description" closeDisabled={mutation.isPending} closeLabel="Close export confirmation"
        footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" data-modal-initial-focus onClick={() => setDialogOpen(false)} disabled={mutation.isPending} className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60">Cancel</button><button type="button" onClick={() => void confirm()} disabled={mutation.isPending} className="min-h-11 rounded-md bg-indigo-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{mutation.isPending ? 'Requesting one export…' : 'Confirm CSV export'}</button></div>}>
        <div id="ledger-export-dialog-description" className="min-w-0 text-sm text-gray-700">
          {newRequestWarning && <p className="state-indicator mb-3 rounded-md border border-amber-400 bg-amber-50 p-3 font-medium text-amber-950">This is a deliberate new export. Another export may already exist; confirming sends exactly one new request.</p>}
          <p>The server will fix a new point-in-time export snapshot when it accepts this request. It will not reuse the ledger view’s current snapshot time.</p>
          <p className="mt-2">Page size, loaded pages, cursors, and the currently visible row subset do not limit the CSV.</p>
          <p className="mt-3 font-semibold text-gray-900">Selected Client ID</p>
          <p className="break-all">{clientId}</p>
          <h3 className="mt-4 font-semibold text-gray-900">Applied export filters</h3>
          <FilterScope filters={normalizeLedgerExportFilters(dialogFilters)} />
          {feedback && mutation.isPending && <p role="status" className="mt-3 font-medium">{feedback}</p>}
        </div>
      </Modal>
    </section>
  )
}

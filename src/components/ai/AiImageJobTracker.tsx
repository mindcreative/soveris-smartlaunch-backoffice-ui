import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAiImageJobTracker } from '../../queries/aiImageQueries'
import type { AiImageJob } from '../../types/aiImages'
import { Breadcrumbs } from '../shared/Breadcrumbs'

function AbsoluteTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toISOString()} (UTC)</time>
}

export function imageJobStatusLabel(job: Pick<AiImageJob, 'status'>): string {
  if (job.status === 'pending') return 'Waiting for processing'
  if (job.status === 'processing') return 'Processing'
  if (job.status === 'retrying') return 'Automatic safe retry in progress'
  if (job.status === 'dlq') return 'Recovery is being finalized'
  if (job.status === 'execution_unknown') return 'Outcome needs reconciliation'
  return job.status === 'completed' ? 'Completed' : 'Failed safely'
}

export function AiImageJobTracker({ clientId, jobId }: { clientId: string; jobId: string }) {
  const { user, hasAnyPermission } = useAuth()
  const authorized = hasAnyPermission(['ai:view', 'audit:view'])
  const tracker = useAiImageJobTracker({ actorId: user?.id ?? '', clientId, jobId, authorized })
  const { state } = tracker
  const [, setRetryClock] = useState(0)
  const job = authorized ? state.job : null
  const retryBlocked = state.retryAfterUntil !== null && Date.now() < state.retryAfterUntil
  const canCheck = ['paused', 'timeout', 'unavailable'].includes(state.phase)
  const canView = state.phase === 'completed' && job?.status === 'completed' && Boolean(job.result) && state.previewPhase === 'idle'

  useEffect(() => {
    if (state.retryAfterUntil === null) return
    const remaining = state.retryAfterUntil - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRetryClock((value) => value + 1), remaining + 10)
    return () => window.clearTimeout(timer)
  }, [state.retryAfterUntil])

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-5">
      <Breadcrumbs items={[{ label: 'AI Tools', href: '/ai' }, { label: 'Image Job' }]} />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-950">Image Job</h1>
          <p className="mt-1 break-all font-mono text-sm text-gray-700">{jobId}</p>
        </div>
        <Link to="/ai" className="inline-flex min-h-11 items-center rounded-md border border-gray-400 px-4 py-2 text-sm font-medium text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Back to AI Tools</Link>
      </div>

      <div role={['permission_lost', 'not_found', 'contract_invalid'].includes(state.phase) ? 'alert' : 'status'} aria-live="polite" className="state-indicator rounded-md border border-gray-400 bg-white p-4 text-sm text-gray-900">
        <p className="font-semibold">{job ? imageJobStatusLabel(job) : state.phase === 'loading' ? 'Loading Job' : 'Job status unavailable'}</p>
        <p className="mt-1">{authorized ? state.message : 'Current image tracking permission is unavailable.'}</p>
      </div>

      {job && (
        <section aria-labelledby="ai-image-job-summary" className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 id="ai-image-job-summary" className="text-lg font-semibold text-gray-950">Verified Job summary</h2>
          <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
            <dt className="font-medium">Job ID</dt><dd className="break-all font-mono">{job.jobId}</dd>
            <dt className="font-medium">State</dt><dd>{imageJobStatusLabel(job)}</dd>
            <dt className="font-medium">Target role</dt><dd>{job.targetRole}</dd>
            <dt className="font-medium">Attempt count</dt><dd>{job.attemptCount}</dd>
            <dt className="font-medium">Last updated</dt><dd><AbsoluteTime value={job.updatedAt} /></dd>
            <dt className="font-medium">Quoted credits</dt><dd>{job.quote.credits} abstract credits</dd>
            <dt className="font-medium">Reserved credits</dt><dd>{job.reservation.estimatedCredits} abstract credits</dd>
            {job.reservation.actualCredits !== null && <><dt className="font-medium">Actual credits</dt><dd>{job.reservation.actualCredits} abstract credits</dd></>}
            <dt className="font-medium">Reservation</dt><dd>{job.reservation.state}</dd>
            {job.result && <>
              <dt className="font-medium">Private result</dt><dd>{job.result.width} × {job.result.height} WebP, {job.result.byteSize.toLocaleString()} bytes</dd>
              <dt className="font-medium">Result expires</dt><dd><AbsoluteTime value={job.result.expiresAt} /></dd>
            </>}
          </dl>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        {canCheck && <button type="button" disabled={retryBlocked} onClick={() => tracker.checkStatus()} className="min-h-11 min-w-11 rounded-md border border-indigo-700 px-4 py-2 text-sm font-medium text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{retryBlocked ? 'Check status later' : 'Check status'}</button>}
        {canView && <button type="button" onClick={() => tracker.viewResult()} className="min-h-11 min-w-11 rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2">View result</button>}
      </div>

      {authorized && state.previewPhase === 'loading' && <p role="status" className="text-sm font-medium">Loading private preview…</p>}
      {authorized && state.previewPhase === 'expired' && <div role="alert" className="rounded-md border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950"><p>The completed private result is expired or unavailable.</p><button type="button" onClick={() => tracker.checkStatus()} className="mt-2 min-h-11 rounded-md border border-amber-800 px-4 py-2 font-medium">Refresh Job status</button></div>}
      {state.previewUrl && job?.result && (
        <figure className="min-w-0 space-y-2 rounded-lg border border-gray-300 bg-white p-4">
          <img src={state.previewUrl} width={job.result.width} height={job.result.height} alt={`Private generated ${job.targetRole} image preview`} className="h-auto max-w-full rounded border border-gray-300" />
          <figcaption className="text-sm text-gray-700">Private temporary preview. It is not attached to a product and cannot be saved from this story.</figcaption>
        </figure>
      )}
    </div>
  )
}

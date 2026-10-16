import type { DomainRelease } from '../../types/domains'
import { Badge } from '../shared/Badge'
import { DomainTime } from './DomainInstructions'
export function DomainReleasePanel({ receipt }: { receipt: DomainRelease }) {
  const released = receipt.state === 'released'
  return <section aria-labelledby="domain-release-heading" className="min-w-0 space-y-4 rounded-lg border border-gray-300 bg-white p-4 sm:p-6">
    <h2 id="domain-release-heading" className="text-lg font-semibold">Domain release</h2>
    <Badge variant={released ? 'success' : receipt.state === 'action_required' ? 'warning' : 'info'}>Cleanup {receipt.state.replace(/_/g, ' ')}</Badge>
    <p className="text-sm text-gray-950">{released ? 'Cleanup confirmed for this immutable domain identity. Authorized capacity and canonical URLs are being refreshed; use their current server results.' : 'Serving is disabled for this domain identity. Cleanup is not yet confirmed: the hostname remains reserved and applicable hostname capacity remains consumed.'}</p>
    {receipt.state === 'action_required' && <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">Cleanup needs attention. Backend recovery may continue under the same release identity. Automatic foreground checks stopped. Use Check status; no cleanup Retry or cancellation endpoint is available.</p>}
    <p className="text-sm text-gray-700">This retained receipt belongs only to the original claim. A fresh same-host claim needs a new immutable domain identity and proof. This receipt never authorizes or controls a later claim.</p>
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div className="min-w-0"><dt className="font-medium">Domain identity</dt><dd className="break-all font-mono">{receipt.domainId}</dd></div>
      <div className="min-w-0"><dt className="font-medium">Release identity</dt><dd className="break-all font-mono">{receipt.releaseId}</dd></div>
      <div><dt className="font-medium">Original proof generation</dt><dd>{receipt.generation}</dd></div>
      <DomainTime label="Release requested" value={receipt.requestedAt} /><DomainTime label="Next cleanup attempt (server schedule)" value={receipt.nextAttemptAt} /><DomainTime label="Cleanup completed" value={receipt.completedAt} />
    </dl>
    {receipt.lastErrorCode && <p className="text-sm text-gray-700">Cleanup diagnosis: {receipt.lastErrorCode.replace(/_/g, ' ')}. Cleanup remains unconfirmed until the server reports released.</p>}
    <p className="text-sm text-gray-700">Next-attempt time is display context in your saved timezone. Status lookup reads the durable receipt; it does not execute cleanup.</p>
  </section>
}

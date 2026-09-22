import type { ResourceAccessConsequence } from '../../types/billing'
import { BillingSubscriptionContractError } from '../../api/billingApi'

function hidesPrivateEvidence(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error
    ? (error as { status?: unknown }).status : undefined
  return status === 401 || status === 403 || status === 404 ||
    error instanceof BillingSubscriptionContractError
}

export function ResourceAccessConsequenceTimeline({
  consequences, isLoading, error, onRetry,
}: {
  consequences?: ResourceAccessConsequence[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  const visibleConsequences = hidesPrivateEvidence(error) ? undefined : consequences
  return <section aria-labelledby="resource-consequences-heading" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6"><h2 id="resource-consequences-heading" className="text-lg font-semibold text-gray-950">Resource-access consequences</h2><p className="mt-1 text-sm text-gray-700">Bounded persisted access-impact history. Fired access reminders and persisted consequences appear here.</p>{isLoading && <p role="status" className="state-indicator mt-3 text-sm">Loading consequence history…</p>}{Boolean(error) && <div role="alert" className="state-indicator mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">Consequence history could not be validated.<button type="button" onClick={onRetry} className="ml-2 min-h-11 min-w-11 font-semibold underline">Retry</button></div>}{visibleConsequences?.length === 0 && <p className="mt-3 text-sm text-gray-600">No persisted consequence events are present.</p>}{visibleConsequences && visibleConsequences.length > 0 && <ol className="mt-3 space-y-3">{visibleConsequences.map((item) => <li key={item.consequenceId} className="rounded-md border border-gray-200 p-3 text-sm"><p className="break-words font-semibold">{copyFor(item)}</p><dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2"><div><dt className="font-medium text-gray-600">Recorded</dt><dd className="break-all">{item.recordedAt}</dd></div><div><dt className="font-medium text-gray-600">Projection revision</dt><dd className="font-mono">{item.projectionRevision}</dd></div><div><dt className="font-medium text-gray-600">Resources retained</dt><dd>{item.retainedCount} of {item.totalCount}</dd></div><div><dt className="font-medium text-gray-600">Grace / suspended</dt><dd>{item.graceCount} / {item.suspendedCount}</dd></div><div className="sm:col-span-2"><dt className="font-medium text-gray-600">Preservation facts</dt><dd>{Object.keys(item.preservationFacts).map(readableFact).join(', ') || 'No preservation facts recorded'}</dd></div></dl>{item.reminders.length > 0 && <ul className="mt-3 space-y-2 border-t border-gray-200 pt-3">{item.reminders.map((reminder) => <li key={reminder.reminderKind} className="rounded-md bg-amber-50 p-2"><p className="break-words font-medium">{reminderCopy(reminder, item.accessUntil)}</p><p className="mt-1 text-gray-600">Recorded {reminder.recordedAt}</p></li>)}</ul>}</li>)}</ol>}</section>
}

function readableFact(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
}

function affectedResources(count: number): string {
  return `${count} affected ${count === 1 ? 'resource' : 'resources'}`
}

function copyFor(item: ResourceAccessConsequence): string {
  if (item.consequenceKind === 'scheduled') {
    return `An access change was scheduled for ${item.lossAt ?? 'the recorded boundary'}.`
  }
  if (item.consequenceKind === 'grace_started') {
    const proofCopy = item.earliestProofExpiry
      ? ` Earliest known ownership or TLS proof expiry for an affected domain binding was ${item.earliestProofExpiry}; that binding could stop serving then unless proof was renewed. The policy grace deadline did not change.`
      : ''
    if (item.lossAt && item.accessUntil && item.deadlineGroups.length === 1 &&
        !item.deadlineGroupsTruncated && item.deadlineGroups[0].graceCount === item.graceCount &&
        item.deadlineGroups[0].accessUntil === item.accessUntil) {
      return `Your access policy changed at ${item.lossAt}. New paid work is unavailable. The policy grace deadline for ${affectedResources(item.graceCount)} is ${item.accessUntil}. They could remain available until then while ownership, TLS, and routing evidence stayed current.${proofCopy}`
    }
    const groups = item.deadlineGroups.map((group) => group.accessUntil
      ? `the policy grace deadline for ${affectedResources(group.graceCount)} is ${group.accessUntil}`
      : `${affectedResources(group.graceCount)} in grace ${group.graceCount === 1 ? 'has' : 'have'} no recorded deadline`)
    if (item.unlistedGraceCount > 0)
      groups.push(`${affectedResources(item.unlistedGraceCount)} in grace ${item.unlistedGraceCount === 1 ? 'has' : 'have'} additional deadlines`)
    return `Your access policy changed at ${item.lossAt ?? 'the recorded boundary'}. New paid work is unavailable. ${groups.join('; ')}. Availability until each policy deadline depended on current ownership, TLS, and routing evidence.${proofCopy}`
  }
  if (item.consequenceKind === 'suspended') {
    const reasonText: Record<ResourceAccessConsequence['suspensionGroups'][number]['reason'], string> = {
      finite_limit: 'because current policy limits were exceeded',
      product_inactive: 'because the product is inactive',
      product_unpublished: 'because the product is unpublished',
      routing_inactive: 'because routing is inactive',
      ownership_unverified: 'because ownership needs verification',
      tls_unavailable: 'because TLS evidence is unavailable',
      target_product_not_retained: 'because the linked product is unavailable',
      client_disabled: 'because the Client is disabled',
      policy_unavailable: 'because policy evidence is unavailable',
      hard_denial: 'because access was denied by the current policy',
    }
    const groups = item.suspensionGroups.map((group) => group.accessUntil
      ? `${affectedResources(group.suspendedCount)} ${group.suspendedCount === 1 ? 'was' : 'were'} suspended at ${group.accessUntil} ${reasonText[group.reason]}`
      : `${affectedResources(group.suspendedCount)} ${group.suspendedCount === 1 ? 'was' : 'were'} suspended ${reasonText[group.reason]}`)
    if (item.unlistedSuspendedCount > 0)
      groups.push(`${affectedResources(item.unlistedSuspendedCount)} ${item.unlistedSuspendedCount === 1 ? 'was' : 'were'} suspended at additional deadlines`)
    if (groups.length === 0)
      return `A suspension consequence was recorded. ${affectedResources(item.suspendedCount)} ${item.suspendedCount === 1 ? 'was' : 'were'} suspended in this projection. Content, assets, domain claims, and financial history were preserved.`
    return `${groups.join('; ')}. Content, assets, domain claims, and financial history were preserved.`
  }
  if (item.consequenceKind === 'cancelled') {
    if (item.causeIdentity.startsWith('subscription_tier_cancelled:'))
      return 'The pending tier change was cancelled.'
    if (item.causeIdentity.startsWith('subscription_tier_replaced:'))
      return 'The pending tier change was replaced.'
    return 'The scheduled access consequence was cancelled.'
  }
  if (item.restoredCount !== null && item.restoredAt)
    return `${affectedResources(item.restoredCount)} regained eligibility at ${item.restoredAt}. Resources with current ownership, TLS, and routing evidence were restored; remaining resources still require action.`
  return 'Affected resource access was restored.'
}

function reminderCopy(
  reminder: ResourceAccessConsequence['reminders'][number], deadline: string | null
): string {
  if (!deadline) return 'An access reminder was recorded; its deadline is unavailable.'
  const proofCopy = reminder.earliestProofExpiry
    ? ` Earliest known ownership or TLS proof expiry for an affected domain binding is ${reminder.earliestProofExpiry}; that binding may stop serving earlier unless proof is renewed.`
    : ''
  return `The policy grace deadline is ${deadline} for ${reminder.graceCount} over-limit affected ${reminder.graceCount === 1 ? 'resource' : 'resources'}. They may stop serving earlier if ownership, TLS, or routing evidence becomes invalid. Reduce usage, reactivate, or upgrade to retain access.${proofCopy}`
}

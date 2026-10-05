import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { findFreshReconciliationCase, normalizeReconciliationReason, queryReconciliation, reconciliationOutcome, ReconciliationContractError, resolutionProof, resolveReconciliation, validateResolutionCommand, type ReconciliationFilters, type ReconciliationOutcome, type ResolutionCommand } from '../api/reconciliationApi'
import type { ReconciliationAction, ReconciliationCase, ReconciliationPage, ReconciliationResolution } from '../types/reconciliation'
import { createUuidV7 } from '../lib/uuidV7'
export const ACTION_LABELS: Record<ReconciliationAction, string> = {
  commit_confirmed_execution: 'Commit confirmed execution',
  release_confirmed_non_execution: 'Release confirmed non-execution',
  authorize_safe_reexecution: 'Authorize safe re-execution',
}
export function financialEffect(item: ReconciliationCase, action: ReconciliationAction): string {
  const held = item.reservation.estimatedCredits
  if (!held) throw new ReconciliationContractError()
  if (action === 'commit_confirmed_execution') {
    if (!item.usage) throw new ReconciliationContractError()
    return `Release the ${held} abstract Soveris credit hold and consume ${item.usage.chargedCredits} abstract Soveris credits once. Preserve accepted usage and provider expense evidence.`
  }
  if (action === 'release_confirmed_non_execution') return `Return the ${held} abstract Soveris credit hold to available balance. No consumption debit; record confirmed non-execution.`
  return `Keep the ${held} abstract Soveris credit hold active and authorize one guarded image retry. No immediate debit; eventual proven execution may consume the accepted reservation.`
}
// A new token/evaluation timestamp alone is not a state change. Everything reviewed is.
export function reviewedCaseState(item: ReconciliationCase): string {
  const { caseVersion: _caseVersion, finding, ...rest } = item
  const { ageSeconds: _ageSeconds, ...facts } = finding
  return JSON.stringify({ ...rest, finding: facts }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value)
}
interface Confirmation { item: ReconciliationCase; action: ReconciliationAction; proofId: string | null; effect: string }
export function useReconciliationWorkspace(clientId: string) {
  // Private QueryClient belongs to this mounted authority scope; no evidence survives navigation.
  const [queries] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } }))
  const [items, setItems] = useState<ReconciliationCase[]>([])
  const [page, setPage] = useState<ReconciliationPage | null>(null)
  const [selected, setSelected] = useState<ReconciliationCase | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState(false)
  const [outcome, setOutcome] = useState<ReconciliationOutcome | 'success' | null>(null)
  const [receipt, setReceipt] = useState<ReconciliationResolution | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [reason, setReason] = useState('')
  const alive = useRef(false)
  const lock = useRef(false)
  const current = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const filters = useRef<ReconciliationFilters>({ pageSize: 20 })
  const retained = useRef<string | null>(null)
  const usedCursors = useRef(new Set<string>())
  useLayoutEffect(() => {
    alive.current = true
    return () => { alive.current = false; current.current?.abort(); current.current = null; lock.current = false; retained.current = null; void queries.cancelQueries(); queries.clear() }
  }, [queries])
  const clearPrivate = () => {
    setDenied(true); setItems([]); setPage(null); setSelected(null); setConfirmation(null); setReason(''); retained.current = null; setUncertain(false); queries.clear()
  }
  const begin = () => {
    if (lock.current || !alive.current || denied) return null
    lock.current = true; setBusy(true); current.current = new AbortController()
    return current.current
  }
  const finish = (controller: AbortController) => { if (current.current !== controller) return; lock.current = false; if (alive.current) setBusy(false) }
  const read = (query: ReconciliationFilters | { cursor: string }, signal: AbortSignal) => queries.fetchQuery({
    queryKey: ['reconciliation', clientId, ++sequence.current], queryFn: ({ signal: querySignal }) => {
      // Both owner cancellation and TanStack cancellation reach the transport.
      signal.addEventListener('abort', () => void queries.cancelQueries(), { once: true })
      return queryReconciliation(clientId, query, querySignal)
    },
  })
  const load = async (nextFilters?: ReconciliationFilters, more = false) => {
    const controller = begin(); if (!controller) return
    const cursor = more ? page?.nextCursor : undefined
    if (more && !cursor) { finish(controller); return }
    try {
      setError(false)
      if (!more) { filters.current = nextFilters ?? filters.current; usedCursors.current.clear(); setSelected(null); setConfirmation(null) }
      const fresh = await read(cursor ? { cursor } : filters.current, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      if (more && (fresh.asOf !== page?.asOf || usedCursors.current.has(cursor!))) throw new ReconciliationContractError()
      if (more && fresh.items.some(item => items.some(old => old.finding.findingId === item.finding.findingId))) throw new ReconciliationContractError()
      if (more) usedCursors.current.add(cursor!)
      setPage(fresh)
      setItems(previous => more ? [...previous, ...fresh.items] : fresh.items)
      if (!more) setSelected(null)
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return
      if (reconciliationOutcome(failure) === 'denied') clearPrivate()
      else { setError(true); if (failure instanceof ReconciliationContractError && !more) { setItems([]); setPage(null); setSelected(null); setConfirmation(null) } }
    } finally { finish(controller) }
  }
  useEffect(() => { void load() }, []) // Scope is remounted by the route boundary.
  const review = async (item: ReconciliationCase, action: ReconciliationAction) => {
    if (retained.current) return
    const controller = begin(); if (!controller) return
    setOutcome(null); setReceipt(null)
    try {
      const fresh = await findFreshReconciliationCase(clientId, item.finding.findingId, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      const proofId = resolutionProof(fresh.item, action, fresh.evaluatedAt)
      const effect = financialEffect(fresh.item, action)
      setSelected(fresh.item); setConfirmation({ item: fresh.item, action, proofId, effect })
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return
      const category = reconciliationOutcome(failure)
      setOutcome(category === 'unknown' ? 'error' : category)
      if (category === 'denied') clearPrivate()
    } finally { finish(controller) }
  }
  const send = async (body: string, controller: AbortController) => {
    try {
      const result = await resolveReconciliation(body, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      retained.current = null; setUncertain(false); setOutcome('success'); setReceipt(result); setConfirmation(null)
      // Old snapshot and action projection are stale after success; clear their actions.
      setItems([]); setPage(null); setSelected(null); setReason('')
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return
      const category = reconciliationOutcome(failure); setOutcome(category)
      if (category === 'unknown') { setUncertain(true); return }
      retained.current = null; setUncertain(false)
      if (category === 'denied') clearPrivate()
      else if (category === 'stale') { setConfirmation(null); setSelected(null) }
    }
  }
  const submit = async (rawReason: string) => {
    if (!confirmation || retained.current) return
    const normalizedReason = normalizeReconciliationReason(rawReason)
    const controller = begin(); if (!controller) return
    try {
      const fresh = await findFreshReconciliationCase(clientId, confirmation.item.finding.findingId, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      const proof = resolutionProof(fresh.item, confirmation.action, fresh.evaluatedAt)
      if (reviewedCaseState(fresh.item) !== reviewedCaseState(confirmation.item) || fresh.item.job.jobId !== confirmation.item.job.jobId || fresh.item.reservation.reservationId !== confirmation.item.reservation.reservationId || proof !== confirmation.proofId || financialEffect(fresh.item, confirmation.action) !== confirmation.effect) throw { status: 409 }
      const command: ResolutionCommand = {
        operationId: createUuidV7(), clientId, findingId: fresh.item.finding.findingId,
        jobId: fresh.item.job.jobId!, reservationId: fresh.item.reservation.reservationId!, action: confirmation.action,
        reason: normalizedReason, expectedCaseVersion: fresh.item.caseVersion, evidenceFingerprint: fresh.item.evidenceFingerprint, providerProofId: proof,
      }
      const body = JSON.stringify(command)
      validateResolutionCommand(body)
      retained.current = body
      await send(retained.current, controller)
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return
      const category = reconciliationOutcome(failure); setOutcome(category === 'unknown' ? 'error' : category)
      if (category === 'denied') clearPrivate()
      else if (category === 'stale') { setConfirmation(null); setSelected(null) }
    } finally { finish(controller) }
  }
  const replay = async () => {
    if (!retained.current) return
    const controller = begin(); if (!controller) return
    try { await send(retained.current, controller) } finally { finish(controller) }
  }
  return { items, page, selected, select: setSelected, confirmation, busy, denied, error, outcome, receipt, uncertain, reason, setReason, load, review, submit, replay,
    closeConfirmation: () => { if (!lock.current) setConfirmation(null) },
  }
}

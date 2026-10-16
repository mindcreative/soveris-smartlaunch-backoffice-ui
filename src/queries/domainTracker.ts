import type { ApiError } from '../api/apiClient'
import { DomainContractError } from '../api/domainContracts'
import type { DomainLookup, DomainRelease } from '../types/domains'

export interface DomainTrackerState {
  phase: 'idle' | 'loading' | 'tracking' | 'paused' | 'timeout' | 'unavailable' | 'denied' | 'not_found' | 'contract_error'
  value: DomainLookup | null
  attempts: number
  receivedAt: number | null
  freshUntil: number
  cooldownUntil: number
  embargoUntil: number
  message: string
}
export function domainIsActive(state: DomainTrackerState, now: number): boolean {
  return state.value?.kind === 'domain' && state.value.domain.authority?.active === true && now < state.freshUntil
}
export class DomainTracker {
  private state: DomainTrackerState = { phase: 'idle', value: null, attempts: 0, receivedAt: null, freshUntil: 0, cooldownUntil: 0, embargoUntil: 0, message: '' }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private controller: AbortController | null = null
  private next: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private startedAt = 0
  private running = false
  private receipt: { releaseId: string; generation: number } | null = null
  constructor(private readonly deps: {
    read: (signal: AbortSignal, additionalRequest: () => boolean) => Promise<DomainLookup>
    current: () => boolean
    now?: () => number
    cache?: (value: DomainLookup) => void
    clear?: () => void
    denied?: () => void
  }) {}
  private now = () => (this.deps.now ?? (() => performance.now()))()
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DomainTrackerState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private cancel() {
    this.generation++; this.running = false
    this.controller?.abort(); this.controller = null
    if (this.next !== null) clearTimeout(this.next)
    if (this.deadline !== null) clearTimeout(this.deadline)
    this.next = null; this.deadline = null
  }
  pause(clear = false, message = 'Automatic checks paused. Backend work continues; use Check status.') {
    this.cancel()
    if (clear) { this.receipt = null; this.deps.clear?.() }
    this.update({ phase: clear ? 'denied' : 'paused', freshUntil: 0, message, ...(clear && { value: null, receivedAt: null, cooldownUntil: 0 }) })
  }
  deny() { this.pause(true, 'Current domain permission is unavailable. Protected state was cleared.'); this.deps.denied?.() }
  embargo(seconds: number) {
    this.update({ embargoUntil: Math.max(this.state.embargoUntil, this.now() + Math.max(0, seconds) * 1000) })
  }
  acceptRelease(release: DomainRelease): boolean {
    if (!this.deps.current()) { this.deny(); return false }
    if (this.receipt && (release.releaseId !== this.receipt.releaseId || release.generation !== this.receipt.generation)) return false
    this.cancel(); this.receipt = { releaseId: release.releaseId, generation: release.generation }
    const value: DomainLookup = { kind: 'release', release }
    this.deps.cache?.(value)
    this.update({ value, phase: 'idle', freshUntil: 0, cooldownUntil: 0, receivedAt: this.now(), message: `Cleanup ${release.state.replace(/_/g, ' ')}.` })
    return true
  }
  start = (): boolean => {
    if (!this.deps.current()) { this.deny(); return false }
    if (this.running || this.now() < this.state.embargoUntil) return false
    this.cancel(); this.running = true; this.startedAt = this.now()
    const generation = this.generation
    this.update({ attempts: 0, phase: 'loading', freshUntil: 0, message: 'Checking current domain status…' })
    this.deadline = setTimeout(() => this.exhaust(), 300000)
    void this.read(generation)
    return true
  }
  private exhaust() { this.cancel(); this.update({ phase: 'timeout', freshUntil: 0, message: 'Automatic checks stopped at the attempt or five-minute limit. Backend work may continue. Use Check status to start another bounded lookup.' }) }
  private valid(generation: number) { return generation === this.generation && this.running }
  private schedule(generation: number, delay: number) {
    if (this.state.attempts >= 60 || this.now() - this.startedAt + delay >= 300000) { this.exhaust(); return }
    this.next = setTimeout(() => { this.next = null; void this.read(generation) }, delay)
  }
  private async read(generation: number) {
    if (!this.valid(generation)) return
    if (!this.deps.current()) { this.deny(); return }
    if (this.state.attempts >= 60 || this.now() - this.startedAt >= 300000) { this.exhaust(); return }
    const started = this.now(), controller = new AbortController()
    this.controller = controller
    this.update({ attempts: this.state.attempts + 1 })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const request = this.deps.read(controller.signal, () => {
        if (!this.valid(generation) || this.state.attempts >= 60 || this.now() - this.startedAt >= 300000) { this.exhaust(); return false }
        this.update({ attempts: this.state.attempts + 1 }); return true
      })
      const value = await Promise.race([request, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject({ code: 'REQUEST_TIMEOUT', message: 'The status request timed out. Check status when ready.' }) }, 15000)
      })])
      if (!this.valid(generation) || controller.signal.aborted) return
      if (!this.deps.current()) { this.deny(); return }
      if (value.kind === 'release') {
        if (this.receipt && (value.release.releaseId !== this.receipt.releaseId || value.release.generation !== this.receipt.generation)) throw new DomainContractError()
        this.receipt = { releaseId: value.release.releaseId, generation: value.release.generation }
      }
      const receivedAt = this.now(), elapsed = Math.max(0, receivedAt - started)
      const authority = value.kind === 'domain' ? value.domain.authority : null
      const fresh = authority ? Math.max(0, Math.min(authority.freshForSeconds * 1000, (authority.boundaryRemainingSeconds ?? Infinity) * 1000) - elapsed) : 0
      const poll = value.kind === 'release' ? value.release.state === 'pending' || value.release.state === 'retrying'
        : value.domain.ownership.status === 'pending' || value.domain.routing.status === 'provisioning' || value.domain.ownership.status === 'verified' && value.domain.tls.status === 'pending' || value.domain.edge?.state === 'pending' || value.domain.edge?.state === 'leased'
      this.deps.cache?.(value)
      this.update({ value, receivedAt, freshUntil: receivedAt + fresh,
        // Waiting a full server-relative cooldown after receipt is conservative.
        // Saved-zone wall timestamps never participate in timer arithmetic.
        cooldownUntil: receivedAt + (authority?.cooldownRemainingSeconds ?? 0) * 1000,
        phase: poll ? 'tracking' : 'idle', message: value.kind === 'release' ? `Cleanup ${value.release.state.replace(/_/g, ' ')}.` : 'Current domain status loaded.' })
      if (poll) this.schedule(generation, 5000)
      else { this.running = false; if (this.deadline !== null) clearTimeout(this.deadline); this.deadline = null }
    } catch (error) {
      if (!this.valid(generation)) return
      if (!this.deps.current()) { this.deny(); return }
      const problem = error as ApiError
      if (problem.status === 401 || problem.status === 403) { this.deny(); return }
      if (problem.status === 404 || error instanceof DomainContractError) {
        this.cancel(); this.deps.clear?.()
        this.update({ phase: problem.status === 404 ? 'not_found' : 'contract_error', value: null, freshUntil: 0,
          message: problem.status === 404 ? 'This identity is unavailable in the active Client. Absence does not confirm cleanup.' : problem.message })
        return
      }
      if (problem.retryAfterSeconds !== undefined) this.embargo(problem.retryAfterSeconds)
      this.update({ phase: 'unavailable', freshUntil: 0, message: problem.message || 'The status could not be confirmed. Backend work may continue.' })
      if (problem.status === 429 || problem.status === 503) this.schedule(generation, Math.max(5000, this.state.embargoUntil - this.now()))
      else { this.cancel() }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      if (this.controller === controller) this.controller = null
    }
  }
}

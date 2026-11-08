import { SUPPORT } from './constants'
import type { SupportClockObservation } from './models'

/** Use an upper bound: HTTP Date has second precision and the body may arrive later. */
export function observeSupportClock(response: Response, started: number): SupportClockObservation {
  const now = performance.now()
  const server = Date.parse(response.headers.get('Date') ?? '')
  return { serverMilliseconds: server + SUPPORT.httpDatePrecisionMilliseconds + Math.max(0, now - started), monotonicMilliseconds: now }
}

export function supportClockNow(clock: SupportClockObservation): number {
  const now = performance.now()

  if (!clock || !Number.isFinite(clock.serverMilliseconds) || !Number.isFinite(clock.monotonicMilliseconds)
      || now < clock.monotonicMilliseconds) {
    return Number.POSITIVE_INFINITY
  }

  return clock.serverMilliseconds + now - clock.monotonicMilliseconds
}

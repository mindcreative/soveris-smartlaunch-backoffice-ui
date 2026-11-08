import { useEffect, useRef, useState } from 'react'
import type { SupportMetadata } from './models'
import { retireSupport, notifySupportPeers } from './lifetime'
import { useAuthStore } from '../stores/authStore'

export function SupportTime({ value }: { value: string }) {
  const saved = useAuthStore(state => state.user?.timeZoneId)
  let zone = saved || 'UTC'
  let label: string

  try {
    label = new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value))
  } catch {
    zone = 'UTC'
    label = new Date(value).toISOString()
  }

  return <span><time dateTime={value}>{label} ({zone})</time><span className="block break-all text-sm text-muted">UTC: {value}</span></span>
}

export function remainingSupportSeconds(grant: SupportMetadata, monotonicNow: number): number | null {
  if (!grant.expiresAt || !grant.clock) {
    return null
  }

  const serverNow = grant.clock.serverMilliseconds + Math.max(0, monotonicNow - grant.clock.monotonicMilliseconds)
  return Math.max(0, Math.ceil((Date.parse(grant.expiresAt) - serverNow) / 1000))
}

export function SupportCountdown({ grant, refresh }: { grant: SupportMetadata; refresh: () => void }) {
  const [now, setNow] = useState(performance.now())
  const handled = useRef('')
  const seconds = remainingSupportSeconds(grant, now)
  const callback = useRef(refresh)
  callback.current = refresh
  useEffect(() => {
    setNow(performance.now())

    if (grant.state !== 'active') {
      return
    }

    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [grant.state, grant.expiresAt, grant.clock])
  useEffect(() => {
    const key = grant.id + ':' + grant.expiresAt

    if (grant.state === 'active' && seconds === 0 && handled.current !== key) {
      handled.current = key
      retireSupport({ status: 0, message: 'The absolute access deadline was reached. Verifying terminal metadata.', retryAt: 0 })
      notifySupportPeers()
      callback.current()
    }
  }, [seconds, grant.id, grant.state, grant.expiresAt])

  if (grant.state !== 'active') {
    return <p>Remaining time: {grant.state === 'ended' ? 'Access ended' : 'Not activated'}</p>
  }

  return <p>Remaining time: {seconds === null ? 'Server clock unavailable — verify current metadata' : seconds === 0 ? 'Time limit reached; awaiting terminal verification' : `${Math.floor(seconds / 60)}m ${seconds % 60}s from the last server observation`}</p>
}

import { useEffect, useState } from 'react'
import { onlineManager, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { readPlatformHealth, currentHealth } from '../../api/platformHealthApi'
import type { HealthReceipt } from '../../api/platformHealthApi'
import { PlatformHealthComponents } from '../../components/platform/PlatformHealthComponents'
import { privateExperienceKey } from '../../auth/experienceKey'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { HEALTH_REFRESH_INTERVAL_MS } from './constants/health'

class OfflineHealthError extends Error {}

export function PlatformHealthPage() {
  const {user,hasPermission}=useAuth()
  const allowed=hasPermission('platform:health:view')
  const [manualRefreshPending, setManualRefreshPending] = useState(false)
  const query=useQuery<HealthReceipt>({queryKey:['backoffice','private','platform','health',user?.id,user?.sessionId,user?.securityRevision,...privateExperienceKey()],
    enabled:allowed,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,staleTime:0,gcTime:0,
    // Refresh successful observations only. Errors still require explicit recovery.
    refetchInterval: healthQuery => healthQuery.state.status === 'success' ? HEALTH_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    // Fail an offline attempt instead of queuing a paused request that resumes
    // without the operator explicitly choosing to recover.
    networkMode:'always',queryFn:({signal})=>{
      if(!onlineManager.isOnline()) throw new OfflineHealthError()
      return readPlatformHealth(signal)
    }})
  const [now,setNow]=useState(()=>performance.now())
  useEffect(()=>{
    if(!allowed || !query.data || query.isError)return
    const timer=window.setInterval(()=>setNow(performance.now()),1000)
    return ()=>window.clearInterval(timer)
  },[allowed,query.data,query.isError])

  async function refreshHealth(): Promise<void> {
    setManualRefreshPending(true)

    try {
      await query.refetch()
    } finally {
      setManualRefreshPending(false)
    }
  }

  if(!allowed) return <section role="alert"><h1>Access denied</h1></section>
  const status=(query.error as {status?:number}|null)?.status
  const offline=query.error instanceof OfflineHealthError
  return <section className="space-y-4"><h1 className="text-2xl font-bold">Platform System Health</h1>
    <p>Sanitized observations for this installation. Observation freshness does not establish session authority.</p>
    <p>Updates every {HEALTH_REFRESH_INTERVAL_MS / 1000} seconds while this tab is active. Updates stop on errors; select Refresh health to retry.</p>
    <button className="min-h-11 rounded border border-control px-4" disabled={query.isFetching} onClick={()=>void refreshHealth()}>Refresh health</button>
    {query.isFetching && (!query.data || manualRefreshPending) && <LoadingSpinner message={query.data ? 'Refreshing health observations…' : 'Loading health observations…'}/>}
    {query.isError && <div role="alert"><h2>{offline?'Health offline':status===401?'Session ended':status===403?'Health access denied':'Health unavailable'}</h2><p>{offline?'No previous observations are displayed. Reconnect, then select Refresh health to retry.':'No previous observations are displayed. Verify current access before retrying.'}</p></div>}
    {!query.isError && !manualRefreshPending && query.data && <div aria-busy={query.isFetching}><PlatformHealthComponents summary={currentHealth(query.data,Math.max(now,performance.now()))}/></div>}
  </section>
}

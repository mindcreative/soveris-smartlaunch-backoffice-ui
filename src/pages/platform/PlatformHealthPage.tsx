import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { readPlatformHealth, currentHealth } from '../../api/platformHealthApi'
import { PlatformHealthComponents } from '../../components/platform/PlatformHealthComponents'
import { privateExperienceKey } from '../../auth/experienceKey'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
export function PlatformHealthPage() {
  const {user,hasPermission}=useAuth()
  const allowed=hasPermission('platform:health:view')
  const query=useQuery({queryKey:['backoffice','private','platform','health',user?.id,user?.sessionId,user?.securityRevision,...privateExperienceKey()],
    enabled:allowed,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,staleTime:0,gcTime:0,queryFn:({signal})=>readPlatformHealth(signal)})
  const [now,setNow]=useState(()=>performance.now())
  useEffect(()=>{
    if(!allowed || !query.data || query.isError)return
    const timer=window.setInterval(()=>setNow(performance.now()),1000)
    return ()=>window.clearInterval(timer)
  },[allowed,query.data,query.isError])
  if(!allowed) return <section role="alert"><h1>Access denied</h1></section>
  const status=(query.error as {status?:number}|null)?.status
  return <section className="space-y-4"><h1 className="text-2xl font-bold">Platform System Health</h1>
    <p>Sanitized observations for this installation. Observation freshness does not establish session authority.</p>
    <button className="min-h-11 rounded border border-control px-4" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh health</button>
    {query.isPending && <LoadingSpinner message="Loading health observations…"/>}
    {query.isError && <div role="alert"><h2>{status===401?'Session ended':status===403?'Health access denied':'Health unavailable'}</h2><p>No previous observations are displayed. Verify current access before retrying.</p></div>}
    {!query.isError && !query.isFetching && query.data && <PlatformHealthComponents summary={currentHealth(query.data,Math.max(now,performance.now()))}/>}
  </section>
}

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { operationalTarget } from '../../auth/experience'
import { readPlatformClient } from '../../api/platformApi'
import { useAuth } from '../../hooks/useAuth'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ErrorDisplay } from '../../components/shared/ErrorDisplay'
export function PlatformClientPage() {
  const { clientId }=useParams(), target=operationalTarget(clientId), {user,hasPermission}=useAuth()
  const query=useQuery({queryKey:['backoffice','private','platform','client',user?.id,user?.sessionId,user?.securityRevision,target],
    enabled:!!target && hasPermission('platform:clients:view'), retry:false,
    queryFn:({signal})=>readPlatformClient(target!,signal)})
  return <section className="max-w-4xl space-y-4"><h1 className="text-2xl font-bold">Platform Client details</h1>
    <p className="break-all">Target Client: {target ?? 'Invalid'}</p>
    <BillingWorkspaceNav clientId={target ?? ''}/>
    {query.isPending && query.fetchStatus==='fetching' && <LoadingSpinner message="Loading Client metadata…"/>}
    {query.isError && <ErrorDisplay message="Client metadata unavailable" detail="Current access or metadata could not be verified." onRetry={()=>void query.refetch()}/>}
    {!query.isError && query.data && <dl className="space-y-3"><div><dt>Name</dt><dd>{query.data.name}</dd></div><div><dt>Status</dt><dd>{query.data.status}</dd></div><div><dt>Client classification</dt><dd>{query.data.clientClassification}</dd></div><div><dt>Classification revision</dt><dd>{query.data.classificationRevision}</dd></div><div><dt>Created at (UTC)</dt><dd>{query.data.createdAt}</dd></div></dl>}
  </section>
}

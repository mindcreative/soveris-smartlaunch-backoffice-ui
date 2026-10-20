import { Badge } from '@/components/shared/Badge'
import type { ComponentAlias, HealthSummary } from '@/api/healthApi'

const names: Record<ComponentAlias, string> = {
  api_process: 'Backoffice API process', ai_worker: 'AI Worker', postgres: 'PostgreSQL', redis_auth: 'Redis authentication',
  redis_rate: 'Redis rate limiting', redis_content: 'Redis content', rabbit_transport: 'RabbitMQ transport', rabbit_topology: 'RabbitMQ topology',
  queue_observer: 'Queue observation', publisher: 'Publisher', main_consumer: 'Main consumer', dlq_consumer: 'Rejected consumer',
  reconciliation: 'Reconciliation', private_ai_results: 'Private AI results', ledger_exports: 'Ledger exports', product_assets: 'Product assets',
  provider_config: 'AI configuration', provider_readiness: 'AI control plane', provider_content: 'AI content', provider_image: 'AI images',
  domain_proof: 'Domain proof', domain_edge: 'Domain edge', domain_cleanup: 'Domain cleanup', managed_cleanup: 'Managed cleanup',
  capability_projection: 'Capability projection', runtime_config: 'Health configuration', billing_observer: 'Billing observation',
  message_observer: 'Message observation', ai_job_observer: 'AI job observation', domain_observer: 'Domain observation',
}
const scopes = { api_control_plane: 'API control plane', ai_worker: 'AI Worker', ai_content_execution: 'AI content execution',
  ai_image_execution: 'AI image execution', product_asset_write: 'Product asset writes', private_ai_result_write: 'Private AI result writes', ledger_export_write: 'Ledger export writes' }

// Presentation only: intentionally absent from customer routes/navigation. The
// real platform grant/session integration must authorize and supply the DTO.
export function PlatformHealthComponents({ summary }: { summary: HealthSummary }) {
  return <section className="space-y-4" aria-labelledby="platform-health-title">
    <h2 id="platform-health-title" className="text-lg font-semibold">System Health</h2>
    <div className="space-y-2" aria-label="Overall readiness">
      {summary.readiness.map(scope => <div key={scope.scope} className="rounded-lg border border-line p-4">
        <h3 className="font-medium">Overall readiness — {scopes[scope.scope]}</h3>
        <p>{scope.status.replace(/_/g, ' ')}</p>
        {scope.blockers.length > 0 && <p className="text-sm text-muted">Blockers: {scope.blockers.map(alias => names[alias]).join(', ')}</p>}
      </div>)}
    </div>
    <dl className="divide-y divide-line rounded-lg border border-line">
      {summary.components.map(row => {
        const lifecycle = row.lifecycle === 'idle_on_demand' ? 'Idle — starts on demand' : row.lifecycle === 'preparing' ? 'Preparing' :
          row.lifecycle === 'failed' ? 'Failed' : row.lifecycle === 'ready' ? 'Ready' : null
        const variant = row.state === 'observed' && row.status === 'healthy' ? 'success' : row.status === 'unhealthy' ? 'error' : row.status === 'degraded' ? 'warning' : 'neutral'
        return <div key={row.alias} className="p-4 space-y-1 break-words">
          <dt className="font-medium">{names[row.alias]}</dt>
          <dd className="space-y-1 text-sm">
            <Badge variant={variant}>{lifecycle ?? row.status.replace(/_/g, ' ')}</Badge>
            <p>Observation: {row.state.replace(/_/g, ' ')} · {row.ageSeconds === null ? 'No observation' : `${Math.floor(row.ageSeconds)} seconds old`}</p>
            <p>{row.reasonCode === 'write_unverified' ? 'Write capability unverified' : row.reasonCode.replace(/_/g, ' ')}</p>
            {row.storageWrite !== 'not_applicable' && <p>{row.storageWrite === 'unverified' ? 'Write capability unverified' :
              row.storageWrite === 'read_only' ? 'Read-only mount' : row.storageWrite === 'failed' ? 'Confirmed write failure' : 'Write capability verified'}</p>}
            {row.executionReady !== null && <p>{row.executionReady ? 'Capability ready to execute' : 'Capability not ready to execute'}</p>}
          </dd>
        </div>
      })}
    </dl>
  </section>
}

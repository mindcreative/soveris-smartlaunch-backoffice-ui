// Application component contract v2. No customer fetch API is exported.
// 16.1/16.2/16.7 must supply real platform authority before adding a transport/hook.
export const componentAliases = ['api_process', 'ai_worker', 'ai_job_observer', 'billing_observer', 'capability_projection',
  'dlq_consumer', 'domain_cleanup', 'domain_edge', 'domain_observer', 'domain_proof', 'ledger_exports', 'main_consumer',
  'managed_cleanup', 'message_observer', 'postgres', 'private_ai_results', 'product_assets', 'provider_config',
  'provider_content', 'provider_image', 'provider_readiness', 'publisher', 'queue_observer', 'rabbit_topology',
  'rabbit_transport', 'reconciliation', 'redis_auth', 'redis_content', 'redis_rate', 'runtime_config'] as const
export type ComponentAlias = typeof componentAliases[number]
export const readinessScopes = ['api_control_plane', 'ai_worker', 'ai_content_execution', 'ai_image_execution',
  'product_asset_write', 'private_ai_result_write', 'ledger_export_write'] as const
export type ReadinessScope = typeof readinessScopes[number]
const scopeMembership: Record<ReadinessScope, readonly string[]> = {
  api_control_plane: ['postgres', 'redis_auth', 'redis_rate', 'rabbit_transport', 'rabbit_topology', 'queue_observer', 'publisher',
    'private_ai_results', 'ledger_exports', 'product_assets', 'provider_config', 'provider_readiness', 'provider_content', 'provider_image',
    'domain_proof', 'domain_edge', 'domain_cleanup', 'managed_cleanup', 'capability_projection', 'runtime_config',
    'billing_observer', 'message_observer', 'ai_job_observer', 'domain_observer'],
  ai_worker: ['ai_worker'], ai_content_execution: ['postgres', 'provider_config', 'provider_content', 'private_ai_results'],
  ai_image_execution: ['postgres', 'rabbit_transport', 'rabbit_topology', 'ai_worker', 'provider_config', 'provider_image', 'private_ai_results'],
  product_asset_write: ['product_assets'], private_ai_result_write: ['private_ai_results'], ledger_export_write: ['ledger_exports'],
}
export type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not_applicable'
export type ObservationState = 'observed' | 'unknown' | 'stale' | 'absent' | 'disabled' | 'not_applicable'
export type CapabilityLifecycle = 'not_applicable' | 'unknown' | 'ready' | 'preparing' | 'idle_on_demand' | 'failed'
export const reasonCodes = ['available', 'not_observed', 'dependency_unavailable', 'timed_out', 'expired',
  'configuration_unavailable', 'disabled', 'not_applicable', 'stopped', 'iteration_failed', 'compatibility_unknown',
  'incompatible_topology', 'safe_fallback', 'invalid_configuration', 'invalid_reload', 'conflicting_observations',
  'capability_unverified', 'write_unverified', 'read_only_mount', 'write_failed', 'idle_on_demand', 'preparing'] as const
export type HealthReason = typeof reasonCodes[number]
export interface HealthComponent {
  alias: ComponentAlias
  status: ComponentStatus
  state: ObservationState
  reasonCode: HealthReason
  lifecycle: CapabilityLifecycle
  ageSeconds: number | null
  validForSeconds: number | null
  executionReady: boolean | null
  storageRead: 'not_applicable' | 'unknown' | 'metadata_only' | 'verified' | 'failed'
  storageWrite: 'not_applicable' | 'unverified' | 'verified' | 'read_only' | 'failed'
}
export interface HealthReadinessScope {
  scope: ReadinessScope
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_applicable'
  components: ComponentAlias[]
  blockers: ComponentAlias[]
}
export interface HealthSummary { schemaVersion: '2'; components: HealthComponent[]; readiness: HealthReadinessScope[] }
const duration = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const fields = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v)
const member = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v)
const ai = (alias: unknown) => alias === 'provider_content' || alias === 'provider_image'
const storage = (alias: unknown) => ['product_assets', 'private_ai_results', 'ledger_exports'].includes(alias as string)
function unavailable(): never { throw new Error('Health summary unavailable') }

export function parseHealthSummary(value: unknown): HealthSummary {
  if (!isObject(value) || !fields(value, ['schemaVersion', 'components', 'readiness']) || value.schemaVersion !== '2' ||
      !Array.isArray(value.components) || value.components.length !== componentAliases.length ||
      !Array.isArray(value.readiness) || value.readiness.length !== readinessScopes.length) return unavailable()
  for (const row of value.components) {
    if (!isObject(row) || !fields(row, ['alias', 'status', 'state', 'reasonCode', 'lifecycle', 'ageSeconds', 'validForSeconds', 'executionReady', 'storageRead', 'storageWrite']) ||
        !member(row.alias, componentAliases) || !member(row.status, ['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable']) ||
        !member(row.state, ['observed', 'unknown', 'stale', 'absent', 'disabled', 'not_applicable']) || !member(row.reasonCode, reasonCodes) ||
        !member(row.lifecycle, ['not_applicable', 'unknown', 'ready', 'preparing', 'idle_on_demand', 'failed']) ||
        (row.ageSeconds !== null && !duration(row.ageSeconds)) || (row.validForSeconds !== null && !duration(row.validForSeconds)) ||
        (row.executionReady !== null && typeof row.executionReady !== 'boolean') ||
        !member(row.storageRead, ['not_applicable', 'unknown', 'metadata_only', 'verified', 'failed']) ||
        !member(row.storageWrite, ['not_applicable', 'unverified', 'verified', 'read_only', 'failed'])) return unavailable()
    if ((row.status === 'healthy' || row.executionReady === true || row.storageWrite === 'verified') &&
        (row.state !== 'observed' || row.ageSeconds === null || row.validForSeconds === null || row.validForSeconds === 0)) return unavailable()
    if ((row.lifecycle === 'idle_on_demand' || row.lifecycle === 'preparing') &&
        (row.status !== 'unknown' || row.state !== 'observed' || row.executionReady !== false || row.validForSeconds === null || row.validForSeconds === 0)) return unavailable()
    if (ai(row.alias) ? row.executionReady === null ||
        (row.executionReady === true && (row.lifecycle !== 'ready' || row.status !== 'healthy')) :
        row.executionReady !== null || row.lifecycle !== 'not_applicable') return unavailable()
    if (!storage(row.alias) && (row.storageRead !== 'not_applicable' || row.storageWrite !== 'not_applicable')) return unavailable()
    if (row.state === 'not_applicable' && row.status !== 'not_applicable') return unavailable()
  }
  if (new Set(value.components.map(row => row.alias)).size !== componentAliases.length) return unavailable()
  for (const scope of value.readiness) {
    if (!isObject(scope) || !fields(scope, ['scope', 'status', 'components', 'blockers']) || !member(scope.scope, readinessScopes) ||
        !member(scope.status, ['healthy', 'degraded', 'unhealthy', 'not_applicable']) ||
        !Array.isArray(scope.components) || scope.components.length === 0 || scope.components.length > componentAliases.length ||
        scope.components.some(alias => !member(alias, componentAliases)) || new Set(scope.components).size !== scope.components.length ||
        !Array.isArray(scope.blockers) || scope.blockers.some(alias => !(scope.components as unknown[]).includes(alias)) ||
        new Set(scope.blockers).size !== scope.blockers.length ||
        (scope.status === 'healthy' && scope.blockers.length !== 0) ||
        (scope.status === 'unhealthy' && scope.blockers.length === 0)) return unavailable()
  }
  if (new Set(value.readiness.map(scope => scope.scope)).size !== readinessScopes.length) return unavailable()
  for (const scope of value.readiness) {
    const expected = scopeMembership[scope.scope as ReadinessScope]
    if (scope.components.length !== expected.length || expected.some(alias => !scope.components.includes(alias))) return unavailable()
  }
  const rows = new Map(value.components.map(row => [row.alias, row]))
  for (const scope of value.readiness) {
    const inactivePurpose = scope.scope === 'ai_content_execution' ? rows.get('provider_content')!.state === 'not_applicable' :
      scope.scope === 'ai_image_execution' ? rows.get('provider_image')!.state === 'not_applicable' : false
    if (scope.status === 'not_applicable' && !inactivePurpose && scope.components.some((alias: string) => rows.get(alias)!.state !== 'not_applicable')) return unavailable()
    if (scope.status !== 'healthy') continue
    for (const alias of scope.components) {
      const row = rows.get(alias)!
      if (row.state === 'not_applicable') continue
      const expectedIdle = scope.scope === 'api_control_plane' && ['idle_on_demand', 'preparing'].includes(row.lifecycle)
      const metadataReadScope = scope.scope === 'api_control_plane' && row.alias === 'product_assets' &&
        row.storageRead === 'metadata_only' && row.storageWrite === 'unverified' && row.reasonCode === 'write_unverified'
      if (row.state !== 'observed' || row.validForSeconds === null || row.validForSeconds === 0 ||
          (row.status !== 'healthy' && !expectedIdle && !metadataReadScope) ||
          (scope.scope !== 'api_control_plane' && ai(alias) && row.executionReady !== true) ||
          (scope.scope.endsWith('_write') && row.storageWrite !== 'verified') ||
          (scope.scope.endsWith('_execution') && storage(alias) && row.storageWrite !== 'verified')) return unavailable()
    }
  }
  return structuredClone(value) as unknown as HealthSummary
}

// Elapsed time includes transport time. Repeated aging must use the original receipt.
export function ageHealthSummary(summary: HealthSummary, elapsedSeconds: number): HealthSummary {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : Number.MAX_SAFE_INTEGER
  const expired = new Set<ComponentAlias>()
  const components = summary.components.map(row => {
    if (row.state === 'not_applicable') return row
    const ageSeconds = row.ageSeconds === null ? null : row.ageSeconds + elapsed
    const validForSeconds = row.validForSeconds === null ? null : Math.max(0, row.validForSeconds - elapsed)
    if (validForSeconds !== null && validForSeconds === 0) {
      expired.add(row.alias)
      return { ...row, ageSeconds, validForSeconds, status: 'unknown' as const, state: 'stale' as const,
        reasonCode: 'expired' as const, lifecycle: ai(row.alias) ? 'unknown' as const : row.lifecycle,
        executionReady: ai(row.alias) ? false : null, storageWrite: storage(row.alias) ? 'unverified' as const : row.storageWrite }
    }
    return { ...row, ageSeconds, validForSeconds }
  })
  const readiness = summary.readiness.map(scope => {
    if (scope.status === 'not_applicable') return scope
    const blockers = [...new Set([...scope.blockers, ...scope.components.filter(alias => expired.has(alias))])]
    return scope.components.some(alias => expired.has(alias)) ? { ...scope, status: 'unhealthy' as const, blockers } : scope
  })
  return { ...summary, components, readiness }
}

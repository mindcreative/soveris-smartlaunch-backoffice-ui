import type { HealthReason } from '@/api/healthApi'

export const statusLabels = { healthy: 'Healthy', degraded: 'Degraded', unhealthy: 'Unavailable', unknown: 'Unverified', not_applicable: 'Not applicable' }
export const explanations: Record<HealthReason, string> = {
  available: 'The latest capability check passed.',
  not_observed: 'No current observation from the owning service is available.',
  dependency_unavailable: 'A required dependency check failed. Review the related component checks.',
  timed_out: 'The check exceeded its time limit. Readiness could not be verified.',
  expired: 'The last observation expired. Waiting for a fresh check.',
  configuration_unavailable: 'Required configuration could not be verified.',
  disabled: 'This capability is disabled.',
  not_applicable: 'This capability is not used by the current configuration.',
  stopped: 'The owning service has stopped.',
  iteration_failed: 'The latest background operation failed.',
  compatibility_unknown: 'Dependency compatibility has not been verified.',
  incompatible_topology: 'The messaging configuration does not match the required topology.',
  safe_fallback: 'The control plane is available with a limited capability.',
  invalid_configuration: 'The health configuration is invalid.',
  invalid_reload: 'A configuration update was rejected; the last accepted configuration remains active.',
  conflicting_observations: 'The available observations conflict.',
  capability_unverified: 'Connectivity is available, but the required operation has not been verified.',
  write_unverified: 'Write capability unverified. A successful read alone does not prove writes work.',
  read_only_mount: 'Storage is confirmed read-only.',
  write_failed: 'The diagnostic storage write, read-back, or cleanup failed.',
  idle_on_demand: 'Intentionally idle. A normal AI request can start preparation; generation is not ready yet.',
  preparing: 'The model is starting. Generation must wait for verified readiness.',
}


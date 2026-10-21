import type { QueryClient } from '@tanstack/react-query'
import { retireAuthority } from './authorityEpoch'
import { retireReportScopes } from '../queries/billingReportKeys'
import { retireAnomalyScopes } from '../queries/billingAnomalyKeys'
import { retireLocalSubscriptionAttempts } from '../queries/localSubscriptionAttemptScope'
import { setExperienceKey } from './experienceKey'
let scope = 'unbound'
export function bindExperienceScope(next: string, queries: QueryClient, retirePrivate = true): void {
  if (next===scope) return
  // These operations happen before cancellation can yield and before a new
  // audience/target mounts. Late JSON, binary and mutation receipts are fenced.
  if (retirePrivate) retireAuthority()
  retireReportScopes()
  retireAnomalyScopes()
  retireLocalSubscriptionAttempts()
  const cancellation=queries.cancelQueries()
  queries.removeQueries()
  queries.getMutationCache().clear()
  void cancellation.catch(()=>undefined)
  scope=next
  setExperienceKey(next)
}

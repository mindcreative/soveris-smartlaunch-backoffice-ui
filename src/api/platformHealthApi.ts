import { apiClient } from './apiClient'
import { ageHealthSummary, parseHealthSummary, type HealthSummary } from './healthApi'
import { AuthorityChangedError, currentAuthorityEpoch } from '../auth/authorityEpoch'
export interface HealthReceipt { summary:HealthSummary; receivedAt:number }
export async function readPlatformHealth(signal:AbortSignal, now=()=>performance.now()):Promise<HealthReceipt> {
  const epoch=currentAuthorityEpoch(), started=now()
  const response=await apiClient.get<unknown>('/health',{signal,retryOnUnauthorized:false})
  if(signal.aborted || epoch!==currentAuthorityEpoch()) throw new AuthorityChangedError()
  const receivedAt=now()
  return {summary:ageHealthSummary(parseHealthSummary(response.data),Math.max(0,receivedAt-started)/1000),receivedAt}
}
export function currentHealth(receipt:HealthReceipt, now=performance.now()):HealthSummary {
  return ageHealthSummary(receipt.summary,Math.max(0,now-receipt.receivedAt)/1000)
}

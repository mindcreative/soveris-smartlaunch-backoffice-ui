import { privateExperienceKey } from '../auth/experienceKey'

export interface RetainedLocalSubscriptionAttempt { body: string; operationId: string }

const uncertainAttempts = new Map<string, RetainedLocalSubscriptionAttempt>()
let retirementEpoch = 0

export function localSubscriptionAttemptScope(clientId: string): string {
  return JSON.stringify(['subscription-attempt', retirementEpoch, ...privateExperienceKey(), clientId])
}

export function retainedLocalSubscriptionAttempt(scope: string): RetainedLocalSubscriptionAttempt | undefined {
  return uncertainAttempts.get(scope)
}

export function retainLocalSubscriptionAttempt(scope: string, attempt: RetainedLocalSubscriptionAttempt): void {
  uncertainAttempts.set(scope, attempt)
}

export function discardLocalSubscriptionAttempt(scope: string): void {
  uncertainAttempts.delete(scope)
}

export function localSubscriptionAttemptScopeIsCurrent(scope: string, clientId: string): boolean {
  return scope === localSubscriptionAttemptScope(clientId)
}

export function retireLocalSubscriptionAttempts(): void {
  retirementEpoch++
  uncertainAttempts.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:cleared', retireLocalSubscriptionAttempts)
  window.addEventListener('auth:refreshed', retireLocalSubscriptionAttempts)
}

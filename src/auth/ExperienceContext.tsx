import { createContext, useContext } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { Audience } from './experience'

export const ExperienceContext = createContext<Audience>('workspace')
export function useExperience() { return useContext(ExperienceContext) }
export function billingPath(audience: Audience, clientId: string, section = 'account') {
  return `${audience === 'platform' ? '/platform' : '/billing'}/clients/${clientId}/${section}`
}
// Audience controls composition only. Each request still goes through the shared
// server authorization evaluator; command grants never imply financial reads.
export function useBillingAccess() {
  const auth = useAuth(), audience = useExperience()
  return { ...auth, audience, hasPermission: (permission: string) => {
    if (permission === 'billing:view' || permission === 'billing:export')
      return auth.hasPermission(audience === 'platform' ? `platform:${permission}` : permission)
    if (permission.startsWith('platform:')) return audience === 'platform' && auth.hasPermission(permission)
    return auth.hasPermission(permission)
  } }
}

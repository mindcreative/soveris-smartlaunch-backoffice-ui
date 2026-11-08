import type { AuthUser } from '../types/auth'
import { canonicalizeGuid } from '../lib/guid'
import { SUPPORT, SUPPORT_UUID_V7 } from '../support/constants'
import type { ExperienceRoute } from './models/experience'

export type { Audience, ExperienceRoute } from './models/experience'

export function operationalTarget(value:string | undefined):string|null {
  const id=canonicalizeGuid(value)
  return id && id!=='00000000-0000-0000-0000-000000000000' ? id : null
}
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function evaluationTarget(value: string | undefined): string | null {
  const id = canonicalizeGuid(value)
  return id && id !== '00000000-0000-7000-8000-000000000000' && UUID_V7.test(id) ? id : null
}

type Authority = (Pick<AuthUser, 'clientId' | 'permissions' | 'platformPermissions'> & Partial<Pick<AuthUser, 'role'>>) | null
export const workspaceDestinations = [
  ['dashboard', 'Dashboard', 'clients:view'], ['products', 'Products', 'products:view'],
  ['submissions', 'Submissions', 'submissions:view'], ['analytics', 'Analytics', 'analytics:view'],
  ['domains', 'Domains', 'domains:view'], ['audit', 'Audit Logs', 'audit:view'],
  ['users', 'Users', 'users:view'], ['ai', 'AI Tools', 'ai:view'], ['billing', 'Billing', 'billing:view'],
] as const
export const platformViews = {
  metadata: 'platform:clients:view', account: 'platform:billing:view', ledger: 'platform:billing:view',
  adjustments: 'platform:billing:view', subscriptions: 'platform:billing:view', reports: 'platform:billing:view',
  reconciliation: 'platform:billing:reconcile', health: 'platform:health:view',
} as const
export function platformAvailable(user: Authority): boolean {
  return Object.values(platformViews).some(p => user?.platformPermissions?.includes(p)) || !!user?.platformPermissions?.includes(SUPPORT.permission)
}
export function permittedLanding(user: Authority): string {
  return '/' + (workspaceDestinations.find(([, , p]) => user?.permissions?.includes(p))?.[0] ??
    (platformAvailable(user) ? 'platform' : 'workspace-access'))
}
export function experienceRoute(pathname: string, user: Authority): ExperienceRoute {
  const parts = pathname.split('/').filter(Boolean)
  const platform = parts[0] === 'platform'

  if (parts[0] === 'support') {
    const grant = canonicalizeGuid(parts[1])

    return { audience: 'support', target: null, grant: grant ?? undefined,
      allowed: parts.length === 2 && !!grant && SUPPORT_UUID_V7.test(grant) && !!user?.platformPermissions?.includes(SUPPORT.permission) }
  }

  const result: ExperienceRoute = { audience: platform ? 'platform' : 'workspace', target: platform ? null : canonicalizeGuid(user?.clientId), allowed: false }
  if (!user) return result

  if (parts[0] === 'settings' && parts[1] === 'support-access' && parts.length === 2) {
    return { ...result, allowed: user.role === 'ClientOwner' }
  }

  if (platform) {
    if (parts.length === 1) return { ...result, allowed: platformAvailable(user) }

    if (parts.length === 2 && parts[1] === 'support') {
      return { ...result, allowed: !!user.platformPermissions?.includes(SUPPORT.permission) }
    }

    if (parts.length === 2 && parts[1] === 'health') return { ...result, allowed: !!user.platformPermissions?.includes(platformViews.health) }
    const target = operationalTarget(parts[2])
    if (parts[1] !== 'clients' || !target) return result
    const section = parts[3] ?? 'metadata'
    const valid = parts.length === 3 || (parts.length === 4 && section !== 'metadata' && section !== 'health') ||
      (parts.length === 6 && section === 'reports' && parts[4] === 'anomalies' && !!evaluationTarget(parts[5]))
    const permission = platformViews[section as keyof typeof platformViews]
    return { ...result, target, allowed: valid && !!permission && !!user.platformPermissions?.includes(permission) }
  }
  if (parts[0] === 'workspace-access') return { ...result, allowed: true }
  if (parts[0] === 'billing' && parts.length > 1) {
    const target = operationalTarget(parts[2]), section = parts[3]
    if (parts[1] !== 'clients' || !target || !['account','ledger','adjustments','subscriptions','reports','reconciliation'].includes(section)) return result
    if (target !== canonicalizeGuid(user.clientId) || section === 'reconciliation' || parts[4] === 'anomalies') {
      const redirect = `/platform/clients/${target}/${parts.slice(3).join('/')}`
      return { ...result, allowed: experienceRoute(redirect, user).allowed, redirect }
    }
    if (parts.length !== 4) return result
  }
  const nested = parts[0] === 'domains' && parts.length === 2 && !!canonicalizeGuid(parts[1]) ||
    parts[0] === 'ai' && parts.length === 3 && parts[1] === 'image-jobs' && !!canonicalizeGuid(parts[2]) ||
    parts[0] === 'billing' && parts.length === 4
  if (parts.length !== 1 && !nested) return result
  const destination = workspaceDestinations.find(([route]) => route === parts[0])
  return { ...result, allowed: !!destination && !!user.permissions?.includes(destination[2]) }
}
export function safeReturnPath(from: unknown, user: Authority): string {
  const fallback = permittedLanding(user)

  if (typeof from !== 'string' || !/^\/[a-zA-Z0-9/-]+$/.test(from)) {
    return fallback
  }

  const segments = from.slice(1).split('/')

  if (segments.some(segment => !segment) || from !== from.toLowerCase()) {
    return fallback
  }

  if (segments[0] === 'workspace-access' && segments.length !== 1) {
    return fallback
  }

  try {
    const url = new URL(from, 'https://workspace.invalid')

    if (url.origin !== 'https://workspace.invalid' || url.pathname !== from || url.search || url.hash) {
      return fallback
    }

    const route = experienceRoute(url.pathname, user)

    return route.allowed ? route.redirect ?? url.pathname : fallback
  } catch {
    return fallback
  }
}

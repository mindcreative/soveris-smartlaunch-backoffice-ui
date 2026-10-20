import type { AuthUser } from '../types/auth'

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clientPermissions = new Set(['ai:create','ai:view','analytics:view','audit:view','billing:export','billing:view','clients:update','clients:view','content:update','content:view','domains:create','domains:delete','domains:update','domains:verify','domains:view','products:create','products:delete','products:update','products:view','submissions:delete','submissions:export','submissions:view','themes:update','themes:view','users:audit','users:create','users:delete','users:resetPassword','users:update','users:view'])
const platformPermissions = new Set(['platform:clients:view','platform:clients:status','platform:packages:manage','platform:billing:view','platform:billing:export','platform:billing:provision','platform:billing:adjust','platform:billing:reconcile','platform:audit:view','platform:health:view'])
function permissions(value: unknown, known: Set<string>): string[] {
  if (!Array.isArray(value) || value.some(p => typeof p !== 'string' || !known.has(p)) || new Set(value).size !== value.length) throw new Error('Current session permissions are unavailable')
  return [...value]
}
export function parseCurrentAuthority(value: unknown): AuthUser {
  if (!value || typeof value !== 'object') throw new Error('Current session authority is unavailable')
  const v = value as Record<string, unknown>
  if (![v.id,v.clientId,v.clientRoleId].every(id => typeof id === 'string' && guid.test(id) && id!=='00000000-0000-0000-0000-000000000000') ||
      typeof v.sessionId !== 'string' || !guid.test(v.sessionId) || v.sessionId[14] !== '7' || !/[89ab]/i.test(v.sessionId[19]!) ||
      typeof v.securityRevision !== 'string' || !/^[1-9][0-9]*$/.test(v.securityRevision) ||
      BigInt(v.securityRevision) > 9223372036854775807n ||
      !['ClientOwner','ClientAdmin','Editor','Viewer'].includes(String(v.role)) ||
      typeof v.email !== 'string' || typeof v.displayName !== 'string') throw new Error('Login with a current session to continue')
  return { id: v.id as string, clientId: v.clientId as string, clientRoleId: v.clientRoleId as string,
    sessionId: v.sessionId, securityRevision: v.securityRevision, role: v.role as AuthUser['role'],
    email: v.email, displayName: v.displayName, permissions: permissions(v.permissions, clientPermissions),
    platformPermissions: permissions(v.platformPermissions ?? [],platformPermissions),
    accessToken: '', refreshToken: '', expiresIn: 0 }
}

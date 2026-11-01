import type { AuthUser } from '../types/auth'
const fixtureVerifiedAt = Date.now() - 30_000
// Explicit synthetic server projections for UI tests; these do not prove real TOTP.
export const verifiedMfaFixture = {
  mfaState: 'enrolled' as const, stepUpRequired: false,
  assuranceExpiresAt: new Date(fixtureVerifiedAt + 900_000).toISOString(),
  freshAssuranceExpiresAt: new Date(fixtureVerifiedAt + 300_000).toISOString(),
  assuranceGeneration: '01990000-0000-7000-8000-000000000099',
}
const unenrolledMfaFixture = { mfaState: 'none' as const, stepUpRequired: true,
  assuranceExpiresAt: null, freshAssuranceExpiresAt: null, assuranceGeneration: null }

// Explicit isolated Client fixture rights; no platform permission is inferred from a role.
export const clientFixturePermissions = ['ai:create','ai:view','analytics:view','audit:view','billing:export','billing:view','clients:update','clients:view','domains:create','domains:delete','domains:update','domains:verify','domains:view','products:create','products:delete','products:update','products:view','submissions:delete','submissions:export','submissions:view','themes:update','themes:view','users:audit','users:create','users:delete','users:resetPassword','users:update','users:view']
export function currentAuthorityFixture(overrides: Partial<AuthUser> = {}): AuthUser {
  const mfa = overrides.platformPermissions?.length ? verifiedMfaFixture : unenrolledMfaFixture
  return { ...mfa, id:'01990000-0000-7000-8000-000000000001',clientId:'01990000-0000-7000-8000-000000000002',clientRoleId:'01990000-0000-7000-8000-000000000003',
    sessionId:'01990000-0000-7000-8000-000000000004',securityRevision:'1',role:'ClientAdmin',email:'isolated@example.test',displayName:'Isolated client collaborator',permissions:[...clientFixturePermissions],platformPermissions:[],accessToken:'fixture-token',refreshToken:'fixture-refresh',expiresIn:3600,...overrides }
}
export const editorFixturePermissions = ['ai:create','ai:view','analytics:view','content:view','content:update','domains:view','domains:create','domains:verify','domains:update','products:view','products:create','products:update','submissions:view','submissions:delete','submissions:export']
export const viewerFixturePermissions = ['submissions:view','analytics:view','content:view','products:view','domains:view','audit:view']

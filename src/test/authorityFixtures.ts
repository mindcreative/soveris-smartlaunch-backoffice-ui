import type { AuthUser } from '../types/auth'
// Explicit isolated Client fixture rights; no platform permission is inferred from a role.
export const clientFixturePermissions = ['ai:create','ai:view','analytics:view','audit:view','billing:export','billing:view','clients:update','clients:view','domains:create','domains:delete','domains:update','domains:verify','domains:view','products:create','products:delete','products:update','products:view','submissions:delete','submissions:export','submissions:view','themes:update','themes:view','users:audit','users:create','users:delete','users:resetPassword','users:update','users:view']
export function currentAuthorityFixture(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id:'01990000-0000-7000-8000-000000000001',clientId:'01990000-0000-7000-8000-000000000002',clientRoleId:'01990000-0000-7000-8000-000000000003',
    sessionId:'01990000-0000-7000-8000-000000000004',securityRevision:'1',role:'ClientAdmin',email:'isolated@example.test',displayName:'Isolated client collaborator',permissions:[...clientFixturePermissions],platformPermissions:[],accessToken:'fixture-token',refreshToken:'fixture-refresh',expiresIn:3600,...overrides }
}
export const editorFixturePermissions = ['ai:create','ai:view','analytics:view','content:view','content:update','domains:view','domains:create','domains:verify','domains:update','products:view','products:create','products:update','submissions:view','submissions:delete','submissions:export']
export const viewerFixturePermissions = ['submissions:view','analytics:view','content:view','products:view','domains:view','audit:view']

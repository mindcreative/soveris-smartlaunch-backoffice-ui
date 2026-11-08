import type { AuthUser } from '../types/auth'
import type { MfaProjection } from '../account/models/mfa'
import { MFA, MFA_UTC_INSTANT, MFA_UUID_V7 } from '../account/constants/mfa'

const absent: MfaProjection = {
  mfaState: 'none', stepUpRequired: true, assuranceExpiresAt: null, freshAssuranceExpiresAt: null, assuranceGeneration: null,
}
let privilegedGeneration = 0
let platformExperience = false
let revalidate: (() => Promise<void>) | null = null
let retireCurrent: (() => void) | null = null
const privilegedUrls = new Set<string>()

export function parseMfaProjection(value: Record<string, unknown>, now = Date.now()): MfaProjection {
  const keys = Object.keys(absent)

  if (keys.every(key => value[key] === undefined)) {
    return { ...absent }
  }

  const validState = value.mfaState === 'none' || value.mfaState === 'enrolled' || value.mfaState === 'recovery-required'
  const instant = (input: unknown) => typeof input === 'string' && MFA_UTC_INSTANT.test(input) && Number.isFinite(Date.parse(input))

  if (!validState || typeof value.stepUpRequired !== 'boolean') {
    throw new Error('Current MFA state is unavailable')
  }

  if (value.stepUpRequired || value.mfaState !== 'enrolled') {
    if (value.stepUpRequired !== true || value.assuranceExpiresAt !== null || value.freshAssuranceExpiresAt !== null || value.assuranceGeneration !== null) {
      throw new Error('Current MFA state is unavailable')
    }

    return { ...absent, mfaState: value.mfaState as MfaProjection['mfaState'] }
  }

  if (!instant(value.assuranceExpiresAt) || !instant(value.freshAssuranceExpiresAt) ||
    typeof value.assuranceGeneration !== 'string' || !MFA_UUID_V7.test(value.assuranceGeneration)) {
    throw new Error('Current MFA assurance is unavailable')
  }

  const expires = Date.parse(value.assuranceExpiresAt as string)
  const fresh = Date.parse(value.freshAssuranceExpiresAt as string)

  if (fresh > expires || expires - fresh > MFA.assuranceMilliseconds - MFA.freshMilliseconds) {
    throw new Error('Current MFA assurance is unavailable')
  }

  if (expires <= now) {
    return { ...absent, mfaState: 'enrolled' }
  }

  return { mfaState: 'enrolled', stepUpRequired: false, assuranceExpiresAt: value.assuranceExpiresAt as string,
    freshAssuranceExpiresAt: value.freshAssuranceExpiresAt as string, assuranceGeneration: value.assuranceGeneration }
}

export function hasMfaAssurance(user: Partial<MfaProjection> | null | undefined, now = Date.now()): boolean {
  return user?.mfaState === 'enrolled' && user.stepUpRequired === false && typeof user.assuranceGeneration === 'string'
    && typeof user.assuranceExpiresAt === 'string' && Date.parse(user.assuranceExpiresAt) > now
}

export function hasFreshMfa(user: Partial<MfaProjection> | null | undefined, now = Date.now()): boolean {
  return hasMfaAssurance(user, now) && typeof user?.freshAssuranceExpiresAt === 'string' && Date.parse(user.freshAssuranceExpiresAt) > now
}

export function withoutPrivilegedAuthority(user: AuthUser): AuthUser {
  return { ...user, platformPermissions: [], stepUpRequired: true, assuranceExpiresAt: null, freshAssuranceExpiresAt: null, assuranceGeneration: null }
}

export function currentPrivilegedGeneration(): number {
  return privilegedGeneration
}

export function setPrivilegedExperience(value: boolean): void {
  platformExperience = value
}

export function isPrivilegedExperience(): boolean {
  return platformExperience || /^\/(?:platform|support)(?:\/|$)/.test(window.location.pathname)
}

export function registerPrivilegedObjectUrl(url: string): void {
  if (isPrivilegedExperience()) {
    privilegedUrls.add(url)
  }
}

export function releasePrivilegedObjectUrl(url: string): void {
  privilegedUrls.delete(url)
}

export function retirePrivilegedAuthority(): void {
  privilegedGeneration++

  for (const url of privilegedUrls) {
    URL.revokeObjectURL(url)
  }

  privilegedUrls.clear()
  window.dispatchEvent(new CustomEvent('auth:privileged-retired'))
}

export function configurePrivilegedRevalidation(callback: () => Promise<void>, retire?: () => void): void {
  revalidate = callback
  retireCurrent = retire ?? null
}

export function invalidateCurrentPrivilegedAuthority(): void {
  if (retireCurrent) {
    retireCurrent()
  } else {
    retirePrivilegedAuthority()
  }
}

export async function revalidatePrivilegedAuthority(): Promise<void> {
  if (!revalidate) {
    throw new Error('Current privileged authority is unavailable')
  }

  await revalidate()
}

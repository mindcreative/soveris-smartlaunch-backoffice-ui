import { describe, expect, it } from 'vitest'
import { parseCurrentAuthority } from './currentAuthority'
import { currentAuthorityFixture } from '../test/authorityFixtures'

const permission = 'platform:clients:view'
const now = Date.now()

function current(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...currentAuthorityFixture({ platformPermissions: [permission] }),
    mfaState: 'enrolled', stepUpRequired: false, assuranceExpiresAt: new Date(now + 900_000).toISOString(),
    freshAssuranceExpiresAt: new Date(now + 300_000).toISOString(), assuranceGeneration: '01990000-0000-7000-8000-000000000009', ...overrides }
}

describe('server MFA projection and local retirement', () => {
  it('keeps only customer permissions when MFA projection is absent', () => {
    const input = current()
    for (const key of ['mfaState', 'stepUpRequired', 'assuranceExpiresAt', 'freshAssuranceExpiresAt', 'assuranceGeneration']) delete input[key]
    const parsed = parseCurrentAuthority(input)
    expect(parsed.platformPermissions).toEqual([])
    expect(parsed.permissions).toContain('products:view')
  })

  it('keeps a valid current server projection without inventing extra grants', () => {
    expect(parseCurrentAuthority(current()).platformPermissions).toEqual([permission])
    expect(parseCurrentAuthority(current({ platformPermissions: [] })).platformPermissions).toEqual([])
  })

  it.each([
    { assuranceExpiresAt: new Date(now - 1).toISOString(), freshAssuranceExpiresAt: new Date(now - 600_001).toISOString() },
    { mfaState: 'none', stepUpRequired: true, assuranceExpiresAt: null, freshAssuranceExpiresAt: null, assuranceGeneration: null },
    { mfaState: 'recovery-required', stepUpRequired: true, assuranceExpiresAt: null, freshAssuranceExpiresAt: null, assuranceGeneration: null },
  ])('removes expired or absent assurance while keeping permitted customer work', patch => {
    const parsed = parseCurrentAuthority(current(patch))
    expect(parsed.platformPermissions).toEqual([])
    expect(parsed.permissions).toContain('products:view')
  })

  it.each([
    { mfaState: 'trusted_browser' },
    { stepUpRequired: 'false' },
    { assuranceExpiresAt: 'tomorrow' },
    { assuranceGeneration: 'caller-assurance' },
    { freshAssuranceExpiresAt: new Date(now + 901_000).toISOString() },
  ])('rejects malformed or invented MFA authority fields', patch => {
    expect(() => parseCurrentAuthority(current(patch))).toThrow()
  })
})

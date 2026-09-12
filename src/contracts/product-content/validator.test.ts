import { describe, expect, it } from 'vitest'
import { validateProductContent } from './validator'
import manifestValue from './v1/manifest.json'
import checksums from './v1/checksums.sha256?raw'

interface ManifestCase {
  id: string
  file: string
  target: 'raw' | 'draft' | 'publish' | 'submission'
  valid: boolean
  path: string | null
  code: string | null
  schemaVersion?: number
}

interface Manifest {
  cases: ManifestCase[]
}

const fixtures = import.meta.glob('./v1/fixtures/**/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

function fixture(relative: string): string {
  const value = fixtures[`./v1/${relative}`]
  if (value === undefined) throw new Error(`Missing fixture: ${relative}`)
  return value
}

describe('Product Content v1 consumer pin', () => {
  it('matches every parseable shared Ajv content outcome and first pointer', async () => {
    const manifest = manifestValue as Manifest
    for (const entry of manifest.cases.filter((candidate) =>
      (candidate.target === 'draft' || candidate.target === 'publish')
        && candidate.file.endsWith('.json')
        && !['duplicate-root', 'duplicate-nested', 'malformed-json'].includes(candidate.id))) {
      const value = JSON.parse(fixture(entry.file)) as unknown
      const target = entry.target === 'draft' ? 'draft' : 'publish'
      const result = validateProductContent(value, target, entry.schemaVersion ?? 1)
      expect(result.valid, entry.id).toBe(entry.valid)
      if (!entry.valid) {
        expect(result.errors[0]?.path, `${entry.id} path`).toBe(entry.path)
        expect(result.errors[0]?.code, `${entry.id} code`).toBe(entry.code)
      }
    }
    expect(validateProductContent({}, 'publish', 2).errors[0]?.code).toBe('unsupported_schema_version')
  })

  it('pins the canonical checksum catalog and references every tested fixture', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(checksums))
    const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(checksum).toBe('74e029b65fc58b75bb50f3772813b8f2105d5f2fb3abf98185d3e0a73aad7b97')
    expect(checksums.trim().split('\n').length).toBeGreaterThan(80)
    for (const entry of (manifestValue as Manifest).cases.filter((candidate) => candidate.file.endsWith('.json'))) {
      expect(checksums, entry.file).toContain(`  ${entry.file}`)
    }
  })
})

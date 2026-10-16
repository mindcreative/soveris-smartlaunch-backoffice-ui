import { describe, expect, it } from 'vitest'
import fixtures from './__fixtures__/domains-http.json'
import { parseDomain, parseDomainPage, parseDomainRelease, parseDomainSchedule } from './domainContracts'

const wire = (name: string) => fixtures.cases.find(item => item.name === name)!.responseBody
const detail = JSON.parse(wire('detail'))

describe('real HTTP domain contracts', () => {
  it('accepts the exact new/read/primary payloads and treats historical authority as non-current', () => {
    expect(parseDomain(wire('claim-new'), detail.clientId, false).authority).toBeNull()
    expect(parseDomain(wire('detail'), detail.clientId).verification.cooldownUntil).toBeNull()
    expect(parseDomain(wire('detail-cooldown'), detail.clientId).authority!.cooldownRemainingSeconds).toBeGreaterThan(0)
    const primary = JSON.parse(wire('primary'))
    expect(parseDomain(wire('primary'), primary.clientId).authority!.active).toBe(true)
    expect(parseDomainPage(wire('list'), detail.clientId).items).toHaveLength(1)
  })
  it('accepts verification/retry/replay and closed retained receipt independently of detail', () => {
    for (const name of ['verify', 'retry', 'retry-replay'])
      expect(parseDomainSchedule(wire(name), detail.id).domainId).toBe(detail.id)
    const release = parseDomainRelease(wire('release-status'), detail.id)
    expect(release.state).toBe('pending')
    expect(parseDomainRelease(wire('release-repeat'), detail.id).releaseId).toBe(release.releaseId)
    expect(() => parseDomain(wire('detail-removed'), detail.clientId)).toThrow()
  })
  it('keeps maximum int64 revision exact and rejects rounded/duplicate/unknown contracts', () => {
    const text = wire('detail').replace(/"revision":\d+/, '"revision":9223372036854775807')
    expect(parseDomain(text, detail.clientId).revision).toBe('9223372036854775807')
    expect(() => parseDomain(text.replace('9223372036854775807', '9223372036854775808'), detail.clientId)).toThrow()
    expect(() => parseDomain(wire('detail').replace('"revision":', '"revision":1,"revision":'), detail.clientId)).toThrow()
    const bad = { ...detail, ownership: { ...detail.ownership, status: 'future_success' } }
    expect(() => parseDomain(JSON.stringify(bad), detail.clientId)).toThrow()
    expect(() => parseDomain(wire('detail'), '0149620b-af5c-47c9-8290-95edde45ef8f')).toThrow()
  })
  it('preserves saved-zone microseconds, rejects UTC/offset strings and unknown receipt fields', () => {
    const parsed = parseDomain(wire('detail'), detail.clientId)
    expect(parsed.createdAt).toMatch(/\.\d{6}$/)
    const bad = { ...detail, createdAt: detail.createdAt + 'Z' }
    expect(() => parseDomain(JSON.stringify(bad), detail.clientId)).toThrow()
    const receipt = JSON.parse(wire('release-status')); receipt.host = 'private.example.test'
    expect(() => parseDomainRelease(JSON.stringify(receipt), detail.id)).toThrow()
    expect(() => parseDomainRelease(wire('release-status'), '01990000-0000-7000-8000-000000000001')).toThrow()
  })
})

import { describe, it, expect } from 'vitest'
import { parseHealthSummary, ageHealthSummary, type HealthSummary } from './healthApi'
import fixture from './fixtures/health-v2.json'

const valid = () => parseHealthSummary(fixture)
const ready = (): HealthSummary => {
  const summary = valid()
  const row = summary.components.find(row => row.alias === 'provider_content')!
  Object.assign(row, { status: 'healthy', state: 'observed', reasonCode: 'available', lifecycle: 'ready',
    ageSeconds: 14, validForSeconds: 1, executionReady: true })
  return summary
}
describe('application component contract v2', () => {
  it('keeps process health independent of unknown Worker and write readiness', () => {
    const summary = valid()
    expect(summary.components.find(row => row.alias === 'api_process')?.status).toBe('healthy')
    expect(summary.components.find(row => row.alias === 'ai_worker')?.status).toBe('unknown')
    expect(summary.readiness.every(scope => scope.status === 'unhealthy')).toBe(true)
  })
  it.each(['idle_on_demand', 'preparing'] as const)('keeps %s observed but neutral and not executable', lifecycle => {
    const summary = ready(), row = summary.components.find(row => row.alias === 'provider_content')!
    Object.assign(row, { status: 'unknown', executionReady: false, lifecycle, reasonCode: lifecycle })
    expect(parseHealthSummary(summary).components.find(row => row.alias === 'provider_content')?.executionReady).toBe(false)
    row.status = 'healthy'
    expect(() => parseHealthSummary(summary)).toThrow('Health summary unavailable')
  })
  it.each([
    (v: HealthSummary) => { (v as unknown as { schemaVersion: string }).schemaVersion = '1' },
    (v: HealthSummary) => { v.components.pop() },
    (v: HealthSummary) => { v.components[1] = v.components[0] },
    (v: HealthSummary) => { (v.components[0] as unknown as { reasonCode: string }).reasonCode = 'private host' },
    (v: HealthSummary) => { v.components[0].ageSeconds = -1 },
    (v: HealthSummary) => { v.components[0].validForSeconds = Number.NaN },
    (v: HealthSummary) => { v.components[1].status = 'healthy' },
    (v: HealthSummary) => { v.readiness[0].status = 'healthy' },
    (v: HealthSummary) => { v.readiness[0].status = 'healthy'; v.readiness[0].blockers = [] },
    (v: HealthSummary) => { v.readiness[0].blockers.push('api_process') },
    (v: HealthSummary) => { v.readiness[0].status = 'healthy'; v.readiness[0].components = ['api_process']; v.readiness[0].blockers = [] },
  ])('rejects malformed, contradictory or unexpected values', mutate => {
    const summary = valid(); mutate(summary)
    expect(() => parseHealthSummary(summary)).toThrow('Health summary unavailable')
  })
  it('expires individual observations at equality without renewing source authority', () => {
    const summary = ready()
    summary.readiness[0].status = 'degraded'
    expect(ageHealthSummary(summary, .999).components.find(row => row.alias === 'provider_content')?.executionReady).toBe(true)
    const expired = ageHealthSummary(summary, 1)
    expect(expired.readiness[0].status).toBe('unhealthy')
    expect(expired.components.find(row => row.alias === 'provider_content')).toMatchObject({ state: 'stale', status: 'unknown', lifecycle: 'unknown', executionReady: false, ageSeconds: 15 })
    expect(summary.components.find(row => row.alias === 'provider_content')?.executionReady).toBe(true)
  })
  it('keeps an unselected AI purpose not applicable when an unrelated database observation expires', () => {
    const summary = valid(), database = summary.components.find(row => row.alias === 'postgres')!
    Object.assign(database, { status: 'healthy', state: 'observed', reasonCode: 'available', ageSeconds: 14, validForSeconds: 1 })
    const content = summary.components.find(row => row.alias === 'provider_content')!
    Object.assign(content, { status: 'not_applicable', state: 'not_applicable', reasonCode: 'not_applicable' })
    const scope = summary.readiness.find(row => row.scope === 'ai_content_execution')!
    Object.assign(scope, { status: 'not_applicable', blockers: [] })
    expect(ageHealthSummary(parseHealthSummary(summary), 2).readiness.find(row => row.scope === 'ai_content_execution')?.status).toBe('not_applicable')
  })

})

import { describe, expect, it } from 'vitest'
import { experienceRoute, permittedLanding, safeReturnPath } from './experience'
import type { AuthUser } from '../types/auth'
const own = '98b71ac3-7f62-4ac8-9b28-30444993a001'
const foreign = '0149620b-af5c-47c9-8290-95edde45ef8f'
const evaluation = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const actor = (permissions: string[] = [], platformPermissions: string[] = []) => ({ clientId: own, permissions, platformPermissions } as Pick<AuthUser, 'clientId' | 'permissions' | 'platformPermissions'>)
describe('experience route inventory', () => {
  it.each([
    ['dashboard','clients:view'], ['products','products:view'], ['submissions','submissions:view'],
    ['analytics','analytics:view'], ['domains','domains:view'], ['audit','audit:view'],
    ['users','users:view'], ['ai','ai:view'], ['billing','billing:view'],
  ])('guards workspace %s before mounting queries', (path, permission) => {
    expect(experienceRoute(`/${path}`, actor()).allowed).toBe(false)
    expect(experienceRoute(`/${path}`, actor([permission])).allowed).toBe(true)
    expect(permittedLanding(actor([permission]))).toBe(`/${path}`)
  })
  it.each([
    ['', 'platform:clients:view'], ['/account','platform:billing:view'], ['/ledger','platform:billing:view'],
    ['/adjustments','platform:billing:view'], ['/subscriptions','platform:billing:view'],
    ['/reports','platform:billing:view'], [`/reports/anomalies/${evaluation}`,'platform:billing:view'],
    ['/reconciliation','platform:billing:reconcile'],
  ])('requires only the exact platform grant for %s', (suffix, permission) => {
    const path = `/platform/clients/${foreign}${suffix}`
    expect(experienceRoute(path,actor([], [permission])).allowed).toBe(true)
    expect(experienceRoute(path,actor(['billing:view'])).allowed).toBe(false)
    expect(experienceRoute(path,actor([], ['platform:packages:manage'])).allowed).toBe(false)
  })
  it('supports health-only operators and denies unknown platform paths', () => {
    const user = actor([], ['platform:health:view'])
    expect(experienceRoute('/platform/health',user).allowed).toBe(true)
    expect(permittedLanding(user)).toBe('/platform')
    expect(experienceRoute('/platform/unknown',user).allowed).toBe(false)
    expect(experienceRoute('/platform/health',actor(['clients:view'])).allowed).toBe(false)
  })
  it('preserves own read URLs and redirects foreign reads before fetching', () => {
    const user = actor(['billing:view'], ['platform:billing:view'])
    expect(experienceRoute(`/billing/clients/${own}/account`,user).redirect).toBeUndefined()
    expect(experienceRoute(`/billing/clients/${foreign}/account`,user).redirect).toBe(`/platform/clients/${foreign}/account`)
    expect(experienceRoute(`/billing/clients/${foreign}/account`,actor(['billing:view'])).allowed).toBe(false)
  })
  it('moves every anomaly and reconciliation link to platform', () => {
    for(const client of [own,foreign]) {
      expect(experienceRoute(`/billing/clients/${client}/reports/anomalies/${evaluation}`,actor([],['platform:billing:view'])).redirect).toBe(`/platform/clients/${client}/reports/anomalies/${evaluation}`)
      expect(experienceRoute(`/billing/clients/${client}/reconciliation`,actor([],['platform:billing:reconcile'])).redirect).toBe(`/platform/clients/${client}/reconciliation`)
    }
  })
  it('rejects malformed anomaly deep links before any report query can mount', () => {
    const user = actor([], ['platform:billing:view'])
    for (const value of ['abc', foreign, '00000000-0000-7000-8000-000000000000'])
      expect(experienceRoute(`/platform/clients/${foreign}/reports/anomalies/${value}`, user).allowed).toBe(false)
  })
  it('rejects an empty UUID target before any view mounts',()=>{expect(experienceRoute('/platform/clients/00000000-0000-0000-0000-000000000000',actor([],['platform:clients:view'])).allowed).toBe(false)})
  it('lands collaborators without Dashboard loops and validates return authority', () => {
    const editor=actor(['products:view','submissions:view'])
    expect(permittedLanding(editor)).toBe('/products')
    for (const from of ['/dashboard','//example.com','/\\example.com','https://example.com','/platform/health','/unknown','/products/unknown'])
      expect(safeReturnPath(from,editor)).toBe('/products')
    expect(safeReturnPath('/products?draft=1#editor',editor)).toBe('/products?draft=1#editor')
    expect(permittedLanding(actor())).toBe('/workspace-access')
  })
})

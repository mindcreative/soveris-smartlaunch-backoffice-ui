import { beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from './__fixtures__/domains-http.json'
import { apiClient } from './apiClient'
import { domainsApi } from './domainsApi'
vi.mock('./apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../timezone/responseGuard', () => ({ localResponseBinding: async () => ({ verify: vi.fn() }) }))
const sample = (name: string) => fixtures.cases.find(item => item.name === name)!
const detail = JSON.parse(sample('detail').responseBody)
const response = (name: string) => ({ data: sample(name).responseBody, status: sample(name).status, headers: { location: sample(name).location } })
beforeEach(() => vi.resetAllMocks())
describe('closed domain request adapters', () => {
  it('sends empty Verify and DELETE and supplies Client constraint on release GET', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(response('verify'))
    await domainsApi.verify(detail.id)
    expect(apiClient.post).toHaveBeenCalledWith(`/domains/${detail.id}/verify`, undefined, expect.objectContaining({ retryOnUnauthorized: false, timeout: 15000 }))
    vi.mocked(apiClient.delete).mockResolvedValue(response('release'))
    await domainsApi.release(detail.id)
    expect(apiClient.delete).toHaveBeenCalledWith(`/domains/${detail.id}`, expect.objectContaining({ retryOnUnauthorized: false }))
    vi.mocked(apiClient.get).mockResolvedValue(response('release-status'))
    await domainsApi.releaseStatus(detail.clientId, detail.id)
    expect(apiClient.get).toHaveBeenCalledWith(`/domains/${detail.id}/release`, expect.objectContaining({ headers: { 'X-Domain-Client-Id': detail.clientId } }))
  })
  it('sends Retry-only operation identity and Primary-only exact revision', async () => {
    const op = '01990000-0000-7000-8000-000000000001'
    vi.mocked(apiClient.post).mockResolvedValue(response('retry'))
    await domainsApi.retry(detail.id, op)
    expect(apiClient.post).toHaveBeenCalledWith(`/domains/${detail.id}/retry`, { operationId: op }, expect.anything())
    const primary = JSON.parse(sample('primary').responseBody)
    vi.mocked(apiClient.put).mockResolvedValue(response('primary'))
    await domainsApi.primary(primary.clientId, primary.id, '9223372036854775807')
    expect(apiClient.put).toHaveBeenCalledWith(`/domains/${primary.id}/primary`, '{"expectedRevision":9223372036854775807}', expect.anything())
  })
  it('rejects foreign or arbitrary Location without following it', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ ...response('release'), headers: { location: 'https://foreign.test/receipt' } })
    await expect(domainsApi.release(detail.id)).rejects.toThrow()
    expect(apiClient.get).not.toHaveBeenCalled()
  })
})

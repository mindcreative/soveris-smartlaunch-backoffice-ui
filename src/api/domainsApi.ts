import { apiClient, type ApiResponse } from './apiClient'
import { domainGuid, DomainContractError, parseDomain, parseDomainPage, parseDomainRelease, parseDomainSchedule } from './domainContracts'
import { localResponseBinding } from '../timezone/responseGuard'
import type { DomainClaim } from '../types/domains'

const config = (signal?: AbortSignal) => ({ signal, timeout: 15000, transformResponse: [(data: string) => data] })
function location(response: ApiResponse<string>, expected: string, required = true) {
  const received = response.headers?.location
  if ((required || received != null) && received !== expected) throw new DomainContractError()
}
async function bound<T>(signal: AbortSignal | undefined, load: () => Promise<T>): Promise<T> {
  const binding = await localResponseBinding(signal)
  const result = await load()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  binding.verify(undefined)
  return result
}
export const domainsApi = {
  list: (clientId: string, page: number, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(clientId)
    if (!Number.isInteger(page) || page < 1) throw new DomainContractError()
    const response = await apiClient.get<string>(`/clients/${clientId}/domains?page=${page}&pageSize=20`, config(signal))
    if (response.status !== 200) throw new DomainContractError()
    return parseDomainPage(response.data, clientId)
  }),
  detail: (clientId: string, id: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(clientId); domainGuid(id, true)
    const response = await apiClient.get<string>(`/domains/${id}`, config(signal))
    if (response.status !== 200) throw new DomainContractError()
    const domain = parseDomain(response.data, clientId)
    if (domain.id !== id) throw new DomainContractError()
    return domain
  }),
  claim: (clientId: string, request: DomainClaim, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(clientId); domainGuid(request.operationId, true)
    const body = { operationId: request.operationId, host: request.host, bindingType: request.bindingType,
      ...(request.bindingType === 'product' && { productId: domainGuid(request.productId) }), verificationMethod: request.verificationMethod }
    const response = await apiClient.post<string>(`/clients/${clientId}/domains`, body, { ...config(signal), retryOnUnauthorized: false })
    if (response.status !== 200 && response.status !== 201) throw new DomainContractError()
    const domain = parseDomain(response.data, clientId, false)
    location(response, `/api/backoffice/domains/${domain.id}`, response.status === 201)
    return { domain, replay: response.status === 200 }
  }),
  verify: (id: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(id, true)
    const response = await apiClient.post<string>(`/domains/${id}/verify`, undefined, { ...config(signal), retryOnUnauthorized: false })
    if (response.status !== 202) throw new DomainContractError()
    location(response, `/api/backoffice/domains/${id}`)
    return parseDomainSchedule(response.data, id)
  }),
  retry: (id: string, operationId: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(id, true); domainGuid(operationId, true)
    const response = await apiClient.post<string>(`/domains/${id}/retry`, { operationId }, { ...config(signal), retryOnUnauthorized: false })
    if (response.status !== 202 && response.status !== 200) throw new DomainContractError()
    location(response, `/api/backoffice/domains/${id}`)
    return parseDomainSchedule(response.data, id)
  }),
  primary: (clientId: string, id: string, revision: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(clientId); domainGuid(id, true)
    if (!/^[1-9]\d*$/.test(revision) || BigInt(revision) > 9223372036854775807n) throw new DomainContractError()
    const response = await apiClient.put<string>(`/domains/${id}/primary`, `{"expectedRevision":${revision}}`, { ...config(signal), retryOnUnauthorized: false })
    if (response.status !== 200) throw new DomainContractError()
    const result = parseDomain(response.data, clientId)
    if (result.id !== id) throw new DomainContractError()
    return result
  }),
  release: (id: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(id, true)
    const response = await apiClient.delete<string>(`/domains/${id}`, { ...config(signal), retryOnUnauthorized: false })
    if (response.status !== 200 && response.status !== 202) throw new DomainContractError()
    location(response, `/api/backoffice/domains/${id}/release`)
    const result = parseDomainRelease(response.data, id)
    if ((response.status === 200) !== (result.state === 'released')) throw new DomainContractError()
    return result
  }),
  releaseStatus: (clientId: string, id: string, signal?: AbortSignal) => bound(signal, async () => {
    domainGuid(clientId); domainGuid(id, true)
    const response = await apiClient.get<string>(`/domains/${id}/release`, { ...config(signal), headers: { 'X-Domain-Client-Id': clientId } })
    if (response.status !== 200) throw new DomainContractError()
    location(response, `/api/backoffice/domains/${id}/release`)
    return parseDomainRelease(response.data, id)
  }),
}

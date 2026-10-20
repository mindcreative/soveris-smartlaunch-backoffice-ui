import { clientFixturePermissions } from '../../test/authorityFixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { DomainClaimModal } from './DomainClaimModal'
import { useAuthStore } from '../../stores/authStore'
import { captureDomainScope } from '../../queries/domainScope'
import { domainsApi } from '../../api/domainsApi'
import fixture from '../../api/__fixtures__/domains-http.json'
import { parseClientCapabilities } from '../../api/billingApi'
import type { ClientCapabilities } from '../../types/billing'
vi.mock('../../api/domainsApi', () => ({ domainsApi: { claim: vi.fn() } }))
vi.mock('../../api/endpoints', () => ({ contentApi: { getProducts: vi.fn() }, authApi: {} }))
beforeEach(() => { vi.mocked(domainsApi.claim).mockReset(); window.dispatchEvent(new Event('auth:refreshed')) })
it('keeps Client claim available and explains Product permission separately', () => {
  useAuthStore.setState({ isAuthenticated: true, user: { id: '01990000-0000-7000-8000-000000000001', clientId: '0149620b-af5c-47c9-8290-95edde45ef8f', role: 'ClientAdmin', permissions: clientFixturePermissions, email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } })
  render(<QueryClientProvider client={new QueryClient()}><DomainClaimModal scope={captureDomainScope()} open canReadProducts={false} onClose={vi.fn()} onCreated={vi.fn()} /></QueryClientProvider>)
  expect(screen.getByLabelText('Binding target')).toHaveValue('client')
  expect(screen.getByRole('option', { name: 'Product' })).toBeDisabled()
  expect(screen.getByText(/Product selection requires products:view/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'example.test' } })
  expect(screen.getByLabelText('Hostname')).toHaveValue('example.test')
})


function claimView(revalidatePolicy?: () => Promise<ClientCapabilities | undefined>) {
  const capsWire = fixture.cases.find(c => c.name === 'capabilities')!.responseBody
  const clientId = JSON.parse(capsWire).clientId
  useAuthStore.setState({ isAuthenticated: true, user: { id: '01990000-0000-7000-8000-000000000001', clientId, role: 'ClientAdmin', permissions: clientFixturePermissions, email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } })
  const capabilities = parseClientCapabilities(capsWire, clientId)
  const client = new QueryClient(), scope = captureDomainScope(), onCreated = vi.fn()
  const element = (policy: ClientCapabilities) => <QueryClientProvider client={client}><DomainClaimModal scope={scope} open canReadProducts={false} capabilities={policy} revalidatePolicy={revalidatePolicy} onClose={vi.fn()} onCreated={onCreated} /></QueryClientProvider>
  const view = render(element(capabilities))
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'same.example.test' } })
  return { onCreated, rerenderPolicy: (policy: ClientCapabilities) => view.rerender(element(policy)) }
}

function hostnameCapacity(usage: string): ClientCapabilities {
  const wire = fixture.cases.find(c => c.name === 'capabilities')!.responseBody
  const capabilities = parseClientCapabilities(wire, JSON.parse(wire).clientId)
  return { ...capabilities,
    limits: capabilities.limits.map(limit => limit.key === 'hostnames' ? { ...limit, value: '1' } : limit),
    usage: capabilities.usage.map(value => value.key === 'hostnames' ? { ...value, value: usage } : value),
  }
}
it('retains the exact UUIDv7 and material through ambiguous outcomes and locks edits', async () => {
  vi.mocked(domainsApi.claim).mockRejectedValue({ code: 'NETWORK_ERROR', message: 'lost reply' })
  claimView()
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  await screen.findByRole('button', { name: 'Retry exact claim' })
  expect(screen.getByLabelText('Hostname')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact claim' }))
  await waitFor(() => expect(domainsApi.claim).toHaveBeenCalledTimes(2))
  const first = vi.mocked(domainsApi.claim).mock.calls[0]![1]
  expect(first.operationId).toMatch(/-7[0-9a-f]{3}-/)
  expect(vi.mocked(domainsApi.claim).mock.calls[1]![1]).toEqual(first)
})
it('focuses linked hostname errors, preserves safe input and clears it on permission loss', async () => {
  vi.mocked(domainsApi.claim).mockRejectedValueOnce({ code: 'invalid_hostname', status: 422, message: 'The hostname is invalid.' })
    .mockRejectedValueOnce({ code: 'insufficient_permissions', status: 403, message: 'Denied.' })
  claimView()
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  expect(screen.getByLabelText('Hostname')).toHaveValue('same.example.test')
  expect(screen.getByLabelText('Hostname')).toHaveAttribute('aria-describedby', 'domain-host-error')
  fireEvent.click(screen.getByRole('link', { name: /Hostname:/ }))
  expect(screen.getByLabelText('Hostname')).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  await screen.findByText(/Claim permission was lost/)
  expect(screen.getByLabelText('Hostname')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Claim domain' })).toBeDisabled()
})

it('replays the same operation after its lost successful reply consumed the final hostname slot', async () => {
  const policy = vi.fn().mockResolvedValueOnce(hostnameCapacity('0')).mockResolvedValue(hostnameCapacity('1'))
  const id = '01990000-0000-7000-8000-000000000002'
  vi.mocked(domainsApi.claim).mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'lost committed reply' })
    .mockResolvedValueOnce({ domain: { id }, replay: true } as never)
  const view = claimView(policy)
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry exact claim' }))
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledWith(id))
  expect(domainsApi.claim).toHaveBeenCalledTimes(2)
  expect(vi.mocked(domainsApi.claim).mock.calls[1]![1]).toEqual(vi.mocked(domainsApi.claim).mock.calls[0]![1])
})

it('preserves an unresolved operation across a failed replay policy lookup and later reconciles it', async () => {
  const policy = vi.fn().mockResolvedValueOnce(hostnameCapacity('0'))
    .mockRejectedValueOnce({ status: 503, code: 'dependency_unavailable', message: 'policy unavailable' })
    .mockResolvedValue(hostnameCapacity('1'))
  vi.mocked(domainsApi.claim).mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'lost reply' })
    .mockResolvedValueOnce({ domain: { id: '01990000-0000-7000-8000-000000000002' }, replay: true } as never)
  const view = claimView(policy)
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry exact claim' }))
  await waitFor(() => expect(policy).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry exact claim' })).toBeEnabled())
  expect(screen.getByLabelText('Hostname')).toBeDisabled()
  expect(screen.getByLabelText('Hostname')).toHaveValue('same.example.test')
  expect(screen.getByText(/Outcome unconfirmed/)).toBeVisible()
  expect(domainsApi.claim).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact claim' }))
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1))
  expect(vi.mocked(domainsApi.claim).mock.calls[1]![1]).toEqual(vi.mocked(domainsApi.claim).mock.calls[0]![1])
})

it('keeps new claims subject to capacity admission', async () => {
  claimView(vi.fn().mockResolvedValue(hostnameCapacity('1')))
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  await screen.findByRole('link', { name: /hostname limit has been reached/ })
  expect(domainsApi.claim).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Hostname')).toBeEnabled()
})

it('allows only the original replay after current policy stops admitting new Client bindings', async () => {
  const full = hostnameCapacity('1')
  const disabled = { ...full, flags: full.flags.map(flag => flag.key === 'client_domain_binding' ? { ...flag, enabled: false } : flag) }
  const policy = vi.fn().mockResolvedValueOnce(hostnameCapacity('0')).mockResolvedValue(disabled)
  vi.mocked(domainsApi.claim).mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'lost reply' })
    .mockResolvedValueOnce({ domain: { id: '01990000-0000-7000-8000-000000000002' }, replay: true } as never)
  const view = claimView(policy)
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  await screen.findByRole('button', { name: 'Retry exact claim' })
  view.rerenderPolicy(disabled)
  expect(screen.getByRole('button', { name: 'Retry exact claim' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact claim' }))
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1))
  expect(vi.mocked(domainsApi.claim).mock.calls[1]![1]).toEqual(vi.mocked(domainsApi.claim).mock.calls[0]![1])
})

it('purges an unresolved operation when replay policy authorization is revoked', async () => {
  const policy = vi.fn().mockResolvedValueOnce(hostnameCapacity('0'))
    .mockRejectedValueOnce({ status: 403, code: 'insufficient_permissions', message: 'Denied.' })
  vi.mocked(domainsApi.claim).mockRejectedValue({ code: 'NETWORK_ERROR', message: 'lost reply' })
  claimView(policy)
  fireEvent.click(screen.getByRole('button', { name: 'Claim domain' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry exact claim' }))
  await screen.findByText(/Claim permission was lost/)
  expect(screen.getByLabelText('Hostname')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Claim domain' })).toBeDisabled()
  expect(captureDomainScope().blocked).toBe(true)
  expect(domainsApi.claim).toHaveBeenCalledTimes(1)
})

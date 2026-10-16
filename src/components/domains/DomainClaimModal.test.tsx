import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { DomainClaimModal } from './DomainClaimModal'
import { useAuthStore } from '../../stores/authStore'
import { captureDomainScope } from '../../queries/domainScope'
import { domainsApi } from '../../api/domainsApi'
import fixture from '../../api/__fixtures__/domains-http.json'
import { parseClientCapabilities } from '../../api/billingApi'
vi.mock('../../api/domainsApi', () => ({ domainsApi: { claim: vi.fn() } }))
vi.mock('../../api/endpoints', () => ({ contentApi: { getProducts: vi.fn() }, authApi: {} }))
it('keeps Client claim available and explains Product permission separately', () => {
  useAuthStore.setState({ isAuthenticated: true, user: { id: '01990000-0000-7000-8000-000000000001', clientId: '0149620b-af5c-47c9-8290-95edde45ef8f', role: 'Admin', email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } })
  render(<QueryClientProvider client={new QueryClient()}><DomainClaimModal scope={captureDomainScope()} open canReadProducts={false} onClose={vi.fn()} onCreated={vi.fn()} /></QueryClientProvider>)
  expect(screen.getByLabelText('Binding target')).toHaveValue('client')
  expect(screen.getByRole('option', { name: 'Product' })).toBeDisabled()
  expect(screen.getByText(/Product selection requires products:view/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'example.test' } })
  expect(screen.getByLabelText('Hostname')).toHaveValue('example.test')
})


function claimView() {
  const capsWire = fixture.cases.find(c => c.name === 'capabilities')!.responseBody
  const clientId = JSON.parse(capsWire).clientId
  useAuthStore.setState({ isAuthenticated: true, user: { id: '01990000-0000-7000-8000-000000000001', clientId, role: 'Admin', email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } })
  const capabilities = parseClientCapabilities(capsWire, clientId)
  render(<QueryClientProvider client={new QueryClient()}><DomainClaimModal scope={captureDomainScope()} open canReadProducts={false} capabilities={capabilities} onClose={vi.fn()} onCreated={vi.fn()} /></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'same.example.test' } })
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

import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import DomainsPage from './DomainsPage'
import { Sidebar } from '../../components/layout/Sidebar'
import { useAuthStore } from '../../stores/authStore'
import { domainsApi } from '../../api/domainsApi'
import { parseDomainPage } from '../../api/domainContracts'
import fixture from '../../api/__fixtures__/domains-http.json'
vi.mock('../../api/domainsApi', () => ({ domainsApi: { list: vi.fn(), detail: vi.fn() } }))
const wire = fixture.cases.find(c => c.name === 'list')!.responseBody
const clientId = JSON.parse(wire).items[0].clientId
const user = { id: '01990000-0000-7000-8000-000000000001', clientId, role: 'Viewer' as const, email: '', displayName: 'Viewer', accessToken: '', refreshToken: '', expiresIn: 1 }
beforeEach(() => { useAuthStore.setState({ isAuthenticated: true, isInitialized: true, isLoading: false, user }) })
function view(path = '/domains') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Sidebar /><Routes><Route path="/domains" element={<DomainsPage />} /><Route path="/domains/:domainId" element={<DomainsPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
it('places Domains immediately after Products and shows active Client with separately labelled states', async () => {
  vi.mocked(domainsApi.list).mockResolvedValue(parseDomainPage(wire, clientId))
  view()
  const nav = screen.getAllByRole('link').map(e => e.textContent)
  expect(nav.findIndex(e => e?.includes('Domains'))).toBe(nav.findIndex(e => e?.includes('Products')) + 1)
  await screen.findAllByText(JSON.parse(wire).items[0].host)
  expect(screen.getByText(`Active Client: ${clientId}`)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Claim domain' })).not.toBeInTheDocument()
  expect(screen.getAllByText('Ownership: pending').length).toBeGreaterThan(0)
})
it('does not issue reads for missing active Client and clears previous Client content before a new response', async () => {
  vi.mocked(domainsApi.list).mockResolvedValue(parseDomainPage(wire, clientId))
  view(); await screen.findAllByText(JSON.parse(wire).items[0].host)
  act(() => useAuthStore.setState({ user: { ...user, clientId: '' } }))
  await waitFor(() => expect(screen.queryByText(JSON.parse(wire).items[0].host)).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: 'Access denied' })).toBeVisible()
})

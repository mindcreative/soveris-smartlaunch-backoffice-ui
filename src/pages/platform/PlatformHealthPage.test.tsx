import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { PlatformHealthPage } from './PlatformHealthPage'
import { apiClient } from '../../api/apiClient'
import fixture from '../../api/fixtures/health-v2.json'

const authority = vi.hoisted(() => ({ allowed: true }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor', sessionId: 'session', securityRevision: '1' }, hasPermission: () => authority.allowed }) }))

afterEach(() => { cleanup(); onlineManager.setOnline(true); vi.restoreAllMocks(); authority.allowed = true })

it('announces a pending refresh, hides old inventory and never restores it after denial', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: fixture, status: 200 })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queries}><PlatformHealthPage /></QueryClientProvider>)
  await screen.findByText('Backoffice API process')
  let reject!: (error: unknown) => void
  requests.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }) as never)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }))
  await waitFor(() => expect(requests).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('status', { name: 'Refreshing health observations…' })).toBeVisible()
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  await act(async () => reject({ status: 403 }))
  await screen.findByRole('heading', { name: 'Health access denied' })
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  queries.clear()
})

it('does not request or render inventory when current permission is absent', () => {
  authority.allowed = false
  const requests = vi.spyOn(apiClient, 'get')
  const queries = new QueryClient()
  render(<QueryClientProvider client={queries}><PlatformHealthPage /></QueryClientProvider>)
  expect(screen.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  expect(requests).not.toHaveBeenCalled()
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  queries.clear()
})


it.each([false, true])('requires explicit recovery after an offline request (cached: %s)', async (cached) => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: fixture, status: 200 })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onlineManager.setOnline(cached)
  render(<QueryClientProvider client={queries}><PlatformHealthPage /></QueryClientProvider>)
  if (cached) {
    await screen.findByText('Backoffice API process')
    act(() => onlineManager.setOnline(false))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }))
  }
  await screen.findByRole('heading', { name: 'Health offline' })
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(cached ? 1 : 0)
  await act(async () => onlineManager.setOnline(true))
  expect(screen.getByRole('heading', { name: 'Health offline' })).toBeVisible()
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(cached ? 1 : 0)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }))
  await screen.findByText('Backoffice API process')
  expect(requests).toHaveBeenCalledTimes(cached ? 2 : 1)
  queries.clear()
})

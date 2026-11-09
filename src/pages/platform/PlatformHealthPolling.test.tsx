import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiClient } from '../../api/apiClient'
import fixture from '../../api/fixtures/health-v2.json'
import { PlatformHealthPage } from './PlatformHealthPage'

const authority = vi.hoisted(() => ({ allowed: true }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'actor', sessionId: 'session', securityRevision: '1' },
    hasPermission: () => authority.allowed,
  }),
}))

let queries: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  focusManager.setFocused(true)
  onlineManager.setOnline(true)
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  queries.clear()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.restoreAllMocks()
  authority.allowed = true
})

async function advance(milliseconds: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
}

function page() {
  return <QueryClientProvider client={queries}><PlatformHealthPage /></QueryClientProvider>
}

it('keeps observations fresh across multiple expiry windows while the page is active', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: fixture, status: 200 })
  render(page())
  await advance(1)

  for (let interval = 0; interval < 10; interval++) {
    await advance(10_000)
    const row = screen.getByText('Backoffice API process').closest('div')!
    expect(within(row).getByText('Healthy')).toBeVisible()
    expect(within(row).queryByText(/Observation: stale/)).not.toBeInTheDocument()
  }

  expect(requests).toHaveBeenCalledTimes(11)
})

it.each([401, 403, 503])('stops polling and clears observations after HTTP %s until explicit recovery', async status => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: fixture, status: 200 })
    .mockRejectedValueOnce({ status }).mockResolvedValue({ data: fixture, status: 200 })
  render(page())
  await advance(1)
  await advance(10_000)
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  await advance(60_000)
  expect(requests).toHaveBeenCalledTimes(2)

  fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }))
  await advance(1)
  expect(screen.getByText('Backoffice API process')).toBeVisible()
  await advance(10_000)
  expect(requests).toHaveBeenCalledTimes(4)
})

it('does not recover an offline polling failure merely because the connection returns', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: fixture, status: 200 })
  render(page())
  await advance(1)
  act(() => onlineManager.setOnline(false))
  await advance(10_000)
  expect(screen.getByRole('heading', { name: 'Health offline' })).toBeVisible()
  act(() => onlineManager.setOnline(true))
  await advance(60_000)
  expect(requests).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
})

it('pauses fetching in the background while still expiring old observations', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: fixture, status: 200 })
  render(page())
  await advance(1)
  act(() => focusManager.setFocused(false))
  await advance(40_000)
  expect(requests).toHaveBeenCalledTimes(1)
  const row = screen.getByText('Backoffice API process').closest('div')!
  expect(within(row).getByText('Unverified')).toBeVisible()

  act(() => focusManager.setFocused(true))
  await advance(10_000)
  expect(requests).toHaveBeenCalledTimes(2)
  expect(within(screen.getByText('Backoffice API process').closest('div')!).getByText('Healthy')).toBeVisible()
})

it('does not overlap slow requests and aborts the active poll when unmounted', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: fixture, status: 200 })
    .mockImplementationOnce(() => new Promise(() => {}) as never)
  const view = render(page())
  await advance(1)
  await advance(10_000)
  expect(within(screen.getByText('Backoffice API process').closest('div')!).getByText('Healthy')).toBeVisible()
  await advance(30_000)
  expect(requests).toHaveBeenCalledTimes(2)
  expect(within(screen.getByText('Backoffice API process').closest('div')!).getByText('Unverified')).toBeVisible()
  const signal = requests.mock.calls[1][1]?.signal
  expect(signal?.aborted).toBe(false)
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await advance(30_000)
  expect(requests).toHaveBeenCalledTimes(2)
})

it('stops polling and hides inventory when current permission is removed', async () => {
  const requests = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: fixture, status: 200 })
  const view = render(page())
  await advance(1)
  authority.allowed = false
  view.rerender(page())
  await advance(40_000)
  expect(screen.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  expect(screen.queryByText('Backoffice API process')).not.toBeInTheDocument()
  expect(requests).toHaveBeenCalledTimes(1)
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import { getUsers } from './endpoints'
import { useAuthStore } from '../stores/authStore'

beforeEach(() => {
  useAuthStore.setState({ user: {
    id: 'operator', email: 'operator@example.com', displayName: 'Operator', role: 'Admin',
    clientId: 'client-id', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
  } })
  vi.restoreAllMocks()
})

describe('plain local timestamp contract', () => {
  it('accepts a local string without fetching a timezone preference', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: {
      data: [{ id: 'user-id', createdAt: '2026-09-22T14:00:00.000000',
        updatedAt: '2026-09-22T14:01:00.000000', timeZoneId: 'UTC' }],
      total: 1, page: 1 }, status: 200, headers: {} })
    expect((await getUsers()).data[0]?.createdAt).toBe('2026-09-22T14:00:00.000000')
    expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => url === '/me/timezone')).toBe(false)
  })
})

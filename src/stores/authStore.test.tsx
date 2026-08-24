import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../api/endpoints'
import { AuthProvider } from '../hooks/useAuth'
import { billingAccountKeys } from '../queries/billingQueries'
import { queryClient } from '../queryClient'
import { useAuthStore } from './authStore'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function resetStore() {
  useAuthStore.setState({
    accessToken: null,
    refreshTokenValue: null,
    user: null,
    isLoading: true,
    isAuthenticated: false,
    isInitialized: false,
  })
  queryClient.clear()
  localStorage.clear()
}

describe('auth lifecycle', () => {
  beforeEach(resetStore)

  it('finishes initialization when there is no persisted session', async () => {
    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      isLoading: false,
      isAuthenticated: false,
      isInitialized: true,
    })
  })

  it('removes private Billing cache on logout', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    localStorage.setItem('backoffice_access_token', 'token')
    useAuthStore.setState({
      accessToken: 'token',
      refreshTokenValue: 'refresh',
      user: {
        id: 'operator',
        email: 'admin@example.com',
        displayName: 'Admin',
        role: 'Admin',
        clientId: CLIENT_ID,
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresIn: 3600,
      },
      isAuthenticated: true,
      isLoading: false,
      isInitialized: true,
    })

    await useAuthStore.getState().logout()

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  })

  it('reacts to auth:cleared without leaving private data behind', async () => {
    useAuthStore.setState({ isInitialized: true, isLoading: false })
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    render(<AuthProvider><div>child</div></AuthProvider>)

    window.dispatchEvent(new CustomEvent('auth:cleared'))

    await waitFor(() => {
      expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
  })

  it('clears private Billing data when token refresh fails', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    localStorage.setItem('backoffice_access_token', 'expired-token')
    localStorage.setItem('backoffice_refresh_token', 'expired-refresh')
    useAuthStore.setState({
      accessToken: 'expired-token',
      refreshTokenValue: 'expired-refresh',
      user: null,
      isAuthenticated: true,
      isLoading: false,
      isInitialized: true,
    })
    vi.spyOn(authApi, 'refreshToken').mockRejectedValue(new Error('Refresh rejected'))

    await useAuthStore.getState().doRefreshToken()

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      accessToken: null,
      refreshTokenValue: null,
    })
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
    expect(localStorage.getItem('backoffice_refresh_token')).toBeNull()
  })
})

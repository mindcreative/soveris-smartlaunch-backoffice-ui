import axios, { type AxiosResponse } from 'axios'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/apiClient'
import { authApi } from '../api/endpoints'
import { AuthProvider } from '../hooks/useAuth'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { useAuthStore } from './authStore'
import { queryClient } from '../queryClient'
import { setPrivilegedExperience } from '../auth/mfaAuthority'

const adapter = axios.defaults.adapter
beforeEach(() => {
  localStorage.clear()
  setPrivilegedExperience(false)
  useAuthStore.getState().setTokens('original-access', 'original-refresh')
  useAuthStore.getState().setUser(currentAuthorityFixture())
  vi.spyOn(authApi, 'currentAuthority').mockResolvedValue(currentAuthorityFixture())
})
afterEach(() => { axios.defaults.adapter = adapter })

it.each([undefined, 503])('AV2 composed transport and AuthProvider retain credentials when refresh verification is unavailable: %s', async status => {
  const paths: string[] = []
  axios.defaults.adapter = async config => {
    paths.push(config.url ?? '')
    const failure = config.url === '/auth/refresh' ? status : 401
    throw { config, message: 'Fixture unavailable', ...(failure === undefined ? {} : { response: { status: failure, data: { code: 'authorization_unavailable' }, config, headers: {} } }) }
  }
  const client = new ApiClient()
  axios.defaults.adapter = adapter
  render(<AuthProvider><div>Session consumer</div></AuthProvider>)
  queryClient.setQueryData(['private', 'retirement'], { private: true })
  await act(async () => { await client.get('/users').catch(() => undefined) })
  expect(paths).toEqual(['/users', '/auth/refresh'])
  expect(useAuthStore.getState()).toMatchObject({ isLoading: false, isInitialized: true, isAuthenticated: false, authorityUnavailable: true })
  expect(localStorage.getItem('backoffice_access_token')).toBe('original-access')
  expect(localStorage.getItem('backoffice_refresh_token')).toBe('original-refresh')
  expect(queryClient.getQueryData(['private', 'retirement'])).toBeUndefined()
})

it('AV2 a delayed transport refresh cannot install old tokens or replay a read after a newer login', async () => {
  let finish!: (value: AxiosResponse) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  let refreshConfig: AxiosResponse['config']
  let reads = 0
  axios.defaults.adapter = async config => {
    if (config.url === '/auth/refresh') {
      refreshConfig = config
      entered()
      return new Promise<AxiosResponse>(resolve => { finish = resolve })
    }

    reads++
    throw { config, response: { status: 401, data: { code: 'authentication_required' }, config, headers: {} } }
  }
  const client = new ApiClient()
  axios.defaults.adapter = adapter
  render(<AuthProvider><div>Session consumer</div></AuthProvider>)
  const pending = client.get('/users').catch(() => undefined)
  await started
  act(() => {
    useAuthStore.getState().setTokens('replacement-access', 'replacement-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture({ id: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4' }))
  })
  await act(async () => {
    finish({ config: refreshConfig!, data: { accessToken: 'old-successor', refreshToken: 'old-refresh-successor' }, status: 200, statusText: 'OK', headers: {} })
    await pending
  })
  expect(reads).toBe(1)
  expect(localStorage.getItem('backoffice_access_token')).toBe('replacement-access')
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, accessToken: 'replacement-access' })
})

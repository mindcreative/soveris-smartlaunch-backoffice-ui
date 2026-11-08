import { currentAuthorityFixture } from '../test/authorityFixtures'
import { clientFixturePermissions } from '../test/authorityFixtures'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../api/endpoints'
import { AuthProvider } from '../hooks/useAuth'
import { billingAccountKeys } from '../queries/billingQueries'
import { productKeys } from '../queries/productQueries'
import { queryClient } from '../queryClient'
import { useAuthStore } from './authStore'
import { currentAuthorityEpoch, retireAuthority, privateObjectUrl } from '../auth/authorityEpoch'

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
  it.each([new TypeError('offline'), { status: 503 }, { status: 403 }])('AV2 settles unavailable and retains login credentials during uncertainty: %j', async failure => {
    useAuthStore.getState().setTokens('saved-access', 'saved-refresh')
    vi.spyOn(authApi, 'currentAuthority').mockRejectedValue(failure)
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, isInitialized: true, authorityUnavailable: true, isAuthenticated: false })
    expect(localStorage.getItem('backoffice_access_token')).toBe('saved-access')
  })

  it('AV2 settles its interrupted restoration without accepting the cancelled authority', async () => {
    useAuthStore.getState().setTokens('saved-access', 'saved-refresh')
    let finish!: (value: ReturnType<typeof currentAuthorityFixture>) => void
    const current = vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const restoring = useAuthStore.getState().initialize()
    await waitFor(() => expect(current).toHaveBeenCalledTimes(1))
    retireAuthority()
    finish(currentAuthorityFixture())
    await restoring
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, isInitialized: true, authorityUnavailable: true, user: null })
    expect(localStorage.getItem('backoffice_access_token')).toBe('saved-access')
  })

  it('AV2 a late failed restoration cannot erase a newer authenticated account', async () => {
    useAuthStore.getState().setTokens('saved-access', 'saved-refresh')
    let fail!: (error: unknown) => void
    const current = vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const restoring = useAuthStore.getState().initialize()
    await waitFor(() => expect(current).toHaveBeenCalledTimes(1))
    useAuthStore.getState().setTokens('new-access', 'new-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    fail({ status: 401 })
    await restoring
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, isAuthenticated: true, accessToken: 'new-access' })
    expect(localStorage.getItem('backoffice_access_token')).toBe('new-access')
  })

  it('AV2 confirmed invalid original login requires authentication', async () => {
    useAuthStore.getState().setTokens('saved-access', 'saved-refresh')
    vi.spyOn(authApi, 'currentAuthority').mockRejectedValue({ status: 401 })
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, isInitialized: true, authorityUnavailable: false, accessToken: null })
  })

  beforeEach(() => { resetStore(); vi.spyOn(authApi,'revoke').mockResolvedValue() })

  it('refreshes the saved timezone for support deadlines without changing original authority or its epoch', async () => {
    const original = currentAuthorityFixture({ timeZoneId: 'UTC', platformPermissions: ['platform:support:operate'] })
    useAuthStore.getState().setTokens('fixture-token', 'fixture-refresh')
    useAuthStore.getState().setUser(original)
    const epoch = currentAuthorityEpoch()
    vi.spyOn(authApi, 'currentAuthority').mockResolvedValue({ ...original, timeZoneId: 'Europe/Belgrade' })

    await useAuthStore.getState().revalidateAuthority()

    expect(useAuthStore.getState().user?.timeZoneId).toBe('Europe/Belgrade')
    expect(useAuthStore.getState().user?.clientId).toBe(original.clientId)
    expect(useAuthStore.getState().user?.sessionId).toBe(original.sessionId)
    expect(useAuthStore.getState().user?.securityRevision).toBe(original.securityRevision)
    expect(currentAuthorityEpoch()).toBe(epoch)
  })

  it('retires queries, optimistic mutations and blob URLs synchronously on another tab logout', async () => {
    useAuthStore.getState().setTokens('old-access','old-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    render(<AuthProvider><div>child</div></AuthProvider>)
    queryClient.setQueryData(productKeys.detail(CLIENT_ID,'product'),{name:'private'})
    queryClient.getMutationCache().build(queryClient,{mutationKey:['billing','optimistic']})
    const revoke=vi.fn()
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:private')})
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke})
    privateObjectUrl(new Blob(['private']))
    const epoch=currentAuthorityEpoch()
    localStorage.removeItem('backoffice_access_token');localStorage.removeItem('backoffice_refresh_token')

    act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'backoffice_access_token',oldValue:'old-access',newValue:null,storageArea:localStorage})))

    expect(currentAuthorityEpoch()).toBeGreaterThan(epoch)
    expect(useAuthStore.getState()).toMatchObject({user:null,isAuthenticated:false,accessToken:null})
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(revoke).toHaveBeenCalledWith('blob:private')
  })

  it('retires an old account before validating a cross-tab replacement and ignores a late superseded projection', async () => {
    useAuthStore.getState().setTokens('old-access','old-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    render(<AuthProvider><div>child</div></AuthProvider>)
    queryClient.setQueryData(productKeys.detail(CLIENT_ID,'product'),{name:'private'})
    let release!: (value: ReturnType<typeof currentAuthorityFixture>)=>void
    const current=vi.spyOn(authApi,'currentAuthority').mockImplementation(()=>new Promise(resolve=>{release=resolve}))
    localStorage.setItem('backoffice_access_token','replacement');localStorage.setItem('backoffice_refresh_token','replacement-refresh')
    act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'backoffice_access_token',storageArea:localStorage})))
    expect(useAuthStore.getState()).toMatchObject({user:null,isAuthenticated:false,isLoading:true})
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    await waitFor(()=>expect(current).toHaveBeenCalledTimes(1))
    localStorage.clear()
    act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null,storageArea:localStorage})))
    await act(async()=>{release(currentAuthorityFixture());await Promise.resolve()})
    expect(useAuthStore.getState()).toMatchObject({user:null,isAuthenticated:false,accessToken:null})
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  })

  it('accepts a replacement account only after current authority validation', async () => {
    useAuthStore.getState().setTokens('old-access','old-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    render(<AuthProvider><div>child</div></AuthProvider>)
    const replacement=currentAuthorityFixture({id:'01990000-0000-7000-8000-000000000088',clientId:CLIENT_ID})
    vi.spyOn(authApi,'currentAuthority').mockResolvedValue(replacement)
    localStorage.setItem('backoffice_access_token','replacement');localStorage.setItem('backoffice_refresh_token','replacement-refresh')
    await act(async()=>{window.dispatchEvent(new StorageEvent('storage',{key:'backoffice_access_token',storageArea:localStorage}))})
    await waitFor(()=>expect(useAuthStore.getState()).toMatchObject({isAuthenticated:true,user:{id:replacement.id,clientId:CLIENT_ID},accessToken:'replacement'}))
  })

  it('does not issue an old refresh when another tab switches accounts during query cancellation', async () => {
    useAuthStore.getState().setTokens('old-access','old-refresh')
    useAuthStore.getState().setUser(currentAuthorityFixture())
    let release!:()=>void
    const cancelled=new Promise<void>(resolve=>{release=resolve})
    vi.spyOn(queryClient,'cancelQueries').mockReturnValue(cancelled)
    const refresh=vi.spyOn(authApi,'refreshToken')
    const replacement=currentAuthorityFixture({id:'01990000-0000-7000-8000-000000000088'})
    vi.spyOn(authApi,'currentAuthority').mockResolvedValue(replacement)
    const stale=useAuthStore.getState().doRefreshToken()
    localStorage.setItem('backoffice_access_token','replacement');localStorage.setItem('backoffice_refresh_token','replacement-refresh')
    const switching=useAuthStore.getState().synchronizeSessionFromStorage()
    release()
    await Promise.all([stale,switching])
    expect(refresh).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({isAuthenticated:true,accessToken:'replacement',user:{id:replacement.id}})
  })

  it('shares one current-authority verification across simultaneous refresh listeners', async () => {
    localStorage.setItem('backoffice_access_token','new-access')
    localStorage.setItem('backoffice_refresh_token','new-refresh')
    let release!: (value: ReturnType<typeof currentAuthorityFixture>) => void
    const current=vi.spyOn(authApi,'currentAuthority').mockImplementation(() => new Promise(resolve => { release=resolve }))
    const first=useAuthStore.getState().handleSuccessfulRefresh()
    const second=useAuthStore.getState().handleSuccessfulRefresh()
    await waitFor(()=>expect(current).toHaveBeenCalledTimes(1))
    release(currentAuthorityFixture())
    await Promise.all([first,second])
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe('new-access')
  })

  it('retains authenticated authority and private caches after an ordinary forbidden response when projection is unchanged', async () => {
    const authority=currentAuthorityFixture({clientId:CLIENT_ID})
    useAuthStore.setState({accessToken:'access',refreshTokenValue:'refresh',user:authority,isAuthenticated:true,isInitialized:true,isLoading:false})
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    vi.spyOn(authApi,'currentAuthority').mockResolvedValue(authority)

    await useAuthStore.getState().revalidateAuthority()

    expect(useAuthStore.getState()).toMatchObject({isAuthenticated:true,authorityUnavailable:false,user:{id:authority.id}})
    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toEqual({ ownedBalance: '10.0000' })
  })

  it('retires private caches when forbidden-response revalidation returns changed authority', async () => {
    const authority=currentAuthorityFixture({clientId:CLIENT_ID,platformPermissions:['platform:billing:view']})
    const reduced=currentAuthorityFixture({clientId:CLIENT_ID,platformPermissions:[]})
    useAuthStore.setState({accessToken:'access',refreshTokenValue:'refresh',user:authority,isAuthenticated:true,isInitialized:true,isLoading:false})
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    vi.spyOn(authApi,'currentAuthority').mockResolvedValue(reduced)

    await useAuthStore.getState().revalidateAuthority()

    expect(useAuthStore.getState().user?.platformPermissions).toEqual([])
    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
  })

  it('suspends authority when forbidden-response revalidation cannot determine current authority', async () => {
    const authority=currentAuthorityFixture({clientId:CLIENT_ID})
    useAuthStore.setState({accessToken:'access',refreshTokenValue:'refresh',user:authority,isAuthenticated:true,isInitialized:true,isLoading:false})
    vi.spyOn(authApi,'currentAuthority').mockRejectedValue(new Error('network unavailable'))
    render(<AuthProvider><div>child</div></AuthProvider>)
    let lifecycle:Promise<void>|undefined

    act(() => window.dispatchEvent(new CustomEvent('auth:forbidden',{detail:{waitUntil:(pending:Promise<void>)=>{lifecycle=pending}}})))
    await lifecycle

    expect(useAuthStore.getState()).toMatchObject({isAuthenticated:false,authorityUnavailable:true,user:null})
  })

  it('finishes initialization when there is no persisted session', async () => {
    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState()).toMatchObject({
      isLoading: false,
      isAuthenticated: false,
      isInitialized: true,
    })
  })

  it('removes private Billing and Product caches on logout', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    queryClient.setQueryData(productKeys.detail(CLIENT_ID, 'product-id'), { name: 'Private product' })
    localStorage.setItem('backoffice_access_token', 'token')
    useAuthStore.setState({
      accessToken: 'token',
      refreshTokenValue: 'refresh',
      user: {
        id: 'operator',
        email: 'admin@example.com',
        displayName: 'ClientAdmin',
        role: 'ClientAdmin', permissions: clientFixturePermissions,
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
    expect(queryClient.getQueryData(productKeys.detail(CLIENT_ID, 'product-id'))).toBeUndefined()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  })

  it('reacts to auth:cleared without leaving private data behind', async () => {
    useAuthStore.setState({ isInitialized: true, isLoading: false })
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    queryClient.setQueryData(productKeys.detail(CLIENT_ID, 'product-id'), { name: 'Private product' })
    render(<AuthProvider><div>child</div></AuthProvider>)

    window.dispatchEvent(new CustomEvent('auth:cleared'))

    await waitFor(() => {
      expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
      expect(queryClient.getQueryData(productKeys.detail(CLIENT_ID, 'product-id'))).toBeUndefined()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
  })

  it('clears private Billing and Product data when token refresh fails', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    queryClient.setQueryData(productKeys.detail(CLIENT_ID, 'product-id'), { name: 'Private product' })
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
    vi.spyOn(authApi, 'refreshToken').mockRejectedValue({ status: 401 })

    await useAuthStore.getState().doRefreshToken()

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
    expect(queryClient.getQueryData(productKeys.detail(CLIENT_ID, 'product-id'))).toBeUndefined()
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      accessToken: null,
      refreshTokenValue: null,
    })
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
    expect(localStorage.getItem('backoffice_refresh_token')).toBeNull()
  })

  it('clears private Billing and Product data before accepting a successful store refresh', async () => {
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_ID), { ownedBalance: '10.0000' })
    queryClient.setQueryData(productKeys.detail(CLIENT_ID, 'product-id'), { name: 'Private product' })
    useAuthStore.setState({ refreshTokenValue: 'refresh', isInitialized: true, isLoading: false })
    vi.spyOn(authApi, 'refreshToken').mockResolvedValue({
      accessToken: 'new-token', refreshToken: 'new-refresh', expiresIn: 3600, user:currentAuthorityFixture(),
    })

    await useAuthStore.getState().doRefreshToken()

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_ID))).toBeUndefined()
    expect(queryClient.getQueryData(productKeys.detail(CLIENT_ID, 'product-id'))).toBeUndefined()
    expect(useAuthStore.getState().accessToken).toBe('new-token')
  })
})

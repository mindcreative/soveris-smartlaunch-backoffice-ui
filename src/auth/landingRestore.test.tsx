import { act,render,waitFor } from '@testing-library/react'
import { expect,it,vi } from 'vitest'
import App from '../App'
import { apiClient } from '../api/apiClient'
import { authApi } from '../api/endpoints'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'
it('waits for authoritative restoration before selecting an unknown-route landing',async()=>{
  vi.spyOn(apiClient,'get').mockRejectedValue({status:503})
  localStorage.clear()
  useAuthStore.getState().setTokens('fixture-token','fixture-refresh')
  useAuthStore.setState({user:null,isAuthenticated:false,isInitialized:false,isLoading:true})
  let resolve!:(value:ReturnType<typeof currentAuthorityFixture>)=>void
  const current=vi.spyOn(authApi,'currentAuthority').mockImplementation(()=>new Promise(r=>{resolve=r}))
  window.history.replaceState({},'','/themes')
  render(<App/>);await waitFor(()=>expect(current).toHaveBeenCalled())
  await act(async()=>{resolve(currentAuthorityFixture({permissions:['products:view'],platformPermissions:[]}))})
  await waitFor(()=>expect(window.location.pathname).toBe('/products'))
  vi.restoreAllMocks()
})

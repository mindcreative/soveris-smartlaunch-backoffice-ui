import { describe,it,expect,vi,afterEach } from 'vitest'
import { apiClient } from './apiClient'
import { readPlatformHealth,currentHealth } from './platformHealthApi'
import { retireAuthority } from '../auth/authorityEpoch'
import fixture from './fixtures/health-v2.json'
afterEach(()=>vi.restoreAllMocks())
describe('platform health receipt',()=>{
  it('consumes round trip time once and ages the original observation',async()=>{
    vi.spyOn(apiClient,'get').mockResolvedValue({data:fixture,status:200})
    const now=vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(3000)
    const receipt=await readPlatformHealth(new AbortController().signal,now)
    const original=fixture.components.find(r=>r.alias==='api_process')!
    expect(receipt.summary.components.find(r=>r.alias==='api_process')?.ageSeconds).toBe(original.ageSeconds!+2)
    expect(currentHealth(receipt,5000).components.find(r=>r.alias==='api_process')?.ageSeconds).toBe(original.ageSeconds!+4)
    expect(currentHealth(receipt,5000)).toEqual(currentHealth(receipt,5000))
    expect(apiClient.get).toHaveBeenCalledWith('/health',expect.objectContaining({retryOnUnauthorized:false,signal:expect.any(AbortSignal)}))
  })
  it('fences a response held across an audience retirement',async()=>{
    let resolve!:(value:unknown)=>void
    vi.spyOn(apiClient,'get').mockImplementation(()=>new Promise(r=>{resolve=r}) as never)
    const pending=readPlatformHealth(new AbortController().signal)
    retireAuthority();resolve({data:fixture})
    await expect(pending).rejects.toMatchObject({code:'AUTHORITY_CHANGED'})
  })
  it('rejects extra private fields instead of rendering a partial summary',async()=>{
    vi.spyOn(apiClient,'get').mockResolvedValue({data:{...fixture,privateContent:'canary'},status:200})
    await expect(readPlatformHealth(new AbortController().signal)).rejects.toThrow('Health summary unavailable')
  })
})

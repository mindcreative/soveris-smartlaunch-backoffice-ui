import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { adoptGeneratedProductImage, getGeneratedProductImageStatus } from '../api/generatedProductImageApi'
import { useGeneratedProductImageCommands } from './generatedProductImageQueries'

vi.mock('../api/generatedProductImageApi', () => ({ adoptGeneratedProductImage: vi.fn(), getGeneratedProductImageStatus: vi.fn() }))
describe('generated image command teardown', () => {
  it('rejects a deferred response after close and removes its scoped receipt cache', async () => {
    const client = new QueryClient(); let finish!: (value: never) => void
    vi.mocked(adoptGeneratedProductImage).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = renderHook(() => useGeneratedProductImageCommands('client-a', 'product-a'), { wrapper })
    let promise!: Promise<unknown>
    act(() => { promise = hook.result.current.execute({ productId: 'product-a', operationId: 'operation', jobId: 'job', resultId: 'result', assetRole: 'hero' }, false) })
    const rejected = expect(promise).rejects.toThrow('no longer current')
    act(() => { hook.result.current.clear(); finish({ status: 'completed' } as never) })
    await rejected
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    hook.unmount()
  })
  it('status recovery invokes only authorized GET', async () => {
    vi.mocked(adoptGeneratedProductImage).mockClear(); vi.mocked(getGeneratedProductImageStatus).mockResolvedValue({ status: 'processing' } as never)
    const client = new QueryClient(); const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = renderHook(() => useGeneratedProductImageCommands('client-a', 'product-a'), { wrapper })
    await act(async () => { await hook.result.current.execute({ productId: 'product-a', operationId: 'operation', jobId: 'job', resultId: 'result', assetRole: 'hero' }, true) })
    expect(getGeneratedProductImageStatus).toHaveBeenCalled(); expect(adoptGeneratedProductImage).not.toHaveBeenCalled()
    hook.unmount(); expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
})

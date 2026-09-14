import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { contentApi } from '../api/endpoints'
import type { ProductPage } from '../types/content'
import { clearPrivateProductQueries, productKeys, useProducts } from './productQueries'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'

describe('private product queries', () => {
  it('keys every product resource by Client before product identity', () => {
    expect(productKeys.list(CLIENT_A, { status: 'all', publication: 'all' })).toEqual([
      'backoffice', 'private', 'products', CLIENT_A, 'list', { status: 'all', publication: 'all' },
    ])
    expect(productKeys.detail(CLIENT_A, 'product-id')).toEqual([
      'backoffice', 'private', 'products', CLIENT_A, 'detail', 'product-id',
    ])
    expect(productKeys.content(CLIENT_A, 'product-id')).toEqual([
      'backoffice', 'private', 'products', CLIENT_A, 'content', 'product-id',
    ])
  })

  it('cancels and removes private product queries and mutations only', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(productKeys.detail(CLIENT_A, 'a'), { name: 'A' })
    queryClient.setQueryData(productKeys.detail(CLIENT_B, 'b'), { name: 'B' })
    queryClient.setQueryData(['backoffice', 'public'], 'preserve')
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: productKeys.command(CLIENT_A, 'a', 'save-draft'),
      mutationFn: async () => undefined,
    })

    await clearPrivateProductQueries(queryClient)

    expect(queryClient.getQueryData(productKeys.detail(CLIENT_A, 'a'))).toBeUndefined()
    expect(queryClient.getQueryData(productKeys.detail(CLIENT_B, 'b'))).toBeUndefined()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(queryClient.getQueryData(['backoffice', 'public'])).toBe('preserve')
  })

  it('removes an old Client and ignores its late list response after switching', async () => {
    let resolveA: ((page: ProductPage) => void) | undefined
    const pageA = new Promise<ProductPage>((resolve) => { resolveA = resolve })
    const pageB: ProductPage = { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 }
    vi.spyOn(contentApi, 'getProducts').mockImplementation((clientId) =>
      clientId === CLIENT_A ? pageA : Promise.resolve(pageB))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    const filters = { status: 'all' as const, publication: 'all' as const }
    const { rerender, unmount } = renderHook(
      ({ clientId }) => useProducts(clientId, filters),
      { initialProps: { clientId: CLIENT_A }, wrapper: Wrapper },
    )
    await waitFor(() => expect(contentApi.getProducts).toHaveBeenCalledWith(CLIENT_A, filters, expect.any(AbortSignal)))

    rerender({ clientId: CLIENT_B })
    await waitFor(() => expect(queryClient.getQueryData(productKeys.list(CLIENT_B, filters))).toEqual(pageB))
    await act(async () => { resolveA?.({ ...pageB, totalCount: 1 }) })
    await waitFor(() => expect(queryClient.getQueryData(productKeys.list(CLIENT_A, filters))).toBeUndefined())

    unmount()
    await waitFor(() => expect(queryClient.getQueryData(productKeys.list(CLIENT_B, filters))).toBeUndefined())
  })
})

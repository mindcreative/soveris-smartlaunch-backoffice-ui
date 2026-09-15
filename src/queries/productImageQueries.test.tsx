import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as productImageApi from '../api/productImageApi'
import type { CompletedProductImageUpload } from '../types/productImages'
import { useProductImageUploads } from './productImageQueries'

const completed: CompletedProductImageUpload = {
  operationId: '01995d88-7740-73f1-8000-000000000001',
  status: 'completed',
  asset: {
    id: '01995d88-7740-73f1-8000-000000000002', productId: 'product-a', role: 'hero',
    url: '/assets/product-images/01995d88-7740-73f1-8000-000000000002.webp',
    mediaType: 'image/webp', byteLength: 5, width: 1200, height: 630,
    visibility: 'private', createdAt: '2026-09-14T12:00:00Z',
  },
  storage: { usedBytes: 5, limitBytes: 100, remainingBytes: 95 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function Harness({ clientId, productId, onCompleted }: {
  clientId: string
  productId: string
  onCompleted: (pointer: string, result: CompletedProductImageUpload) => void
}) {
  const uploads = useProductImageUploads(clientId, productId, onCompleted)
  return <div>
    <button type="button" onClick={() => uploads.start(
      '/hero/backgroundImage', 'hero', new File(['same'], 'hero.webp', { type: 'image/webp' }))}
    >Start</button>
    <button type="button" onClick={() => uploads.cancel('/hero/backgroundImage')}>Cancel</button>
    <output>{uploads.uploads['/hero/backgroundImage']?.phase ?? 'empty'}</output>
  </div>
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useProductImageUploads boundaries', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(productImageApi, 'getProductImagePreview').mockResolvedValue(new Blob(['preview']))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('drops every late completion after auth, cancellation and product changes', async () => {
    const pending = deferred<CompletedProductImageUpload>()
    let capturedSignal: AbortSignal | undefined
    vi.spyOn(productImageApi, 'uploadProductImage').mockImplementation(
      async (_product, _operation, _role, _file, signal) => {
        capturedSignal = signal
        return pending.promise
      },
    )
    const onCompleted = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rendered = render(
      <Harness clientId="client-a" productId="product-a" onCompleted={onCompleted} />,
      { wrapper: wrapper(client) },
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByText('uploading')).toBeVisible()

    act(() => window.dispatchEvent(new CustomEvent('auth:cleared')))
    expect(screen.getByText('empty')).toBeVisible()
    expect(capturedSignal?.aborted).toBe(true)
    await act(async () => pending.resolve(completed))
    expect(onCompleted).not.toHaveBeenCalled()

    const second = deferred<CompletedProductImageUpload>()
    vi.mocked(productImageApi.uploadProductImage).mockImplementationOnce(async () => second.promise)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    rendered.rerender(<Harness clientId="client-a" productId="product-b" onCompleted={onCompleted} />)
    await act(async () => second.resolve(completed))
    expect(onCompleted).not.toHaveBeenCalled()

    const third = deferred<CompletedProductImageUpload>()
    vi.mocked(productImageApi.uploadProductImage).mockImplementationOnce(async () => third.promise)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => third.resolve(completed))
    expect(onCompleted).not.toHaveBeenCalled()
  })

  it('allows only its own Axios auth replay to continue', async () => {
    vi.spyOn(productImageApi, 'uploadProductImage').mockImplementation(
      async (_product, _operation, _role, _file, _signal, _progress, onAuthReplay) => {
        onAuthReplay?.()
        window.dispatchEvent(new CustomEvent('auth:refreshed'))
        return completed
      },
    )
    const onCompleted = vi.fn()
    render(<Harness clientId="client-a" productId="product-a" onCompleted={onCompleted} />, {
      wrapper: wrapper(new QueryClient()),
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(screen.getByText('completed')).toBeVisible()
  })
})

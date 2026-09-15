import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import { getProductImagePreview, getProductImageUploadStatus, uploadProductImage } from './productImageApi'

describe('product image asset API', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses exact multipart, status and authenticated preview routes', async () => {
    const completed = { operationId: 'operation-id', status: 'completed' }
    const blob = new Blob(['bytes'], { type: 'image/webp' })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: completed, status: 201 })
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: completed, status: 200 })
      .mockResolvedValueOnce({ data: blob, status: 200 })
    const file = new File(['image'], 'hero.webp', { type: 'image/webp' })
    const signal = new AbortController().signal
    const progress = vi.fn()

    await uploadProductImage('product-id', 'operation-id', 'hero', file, signal, progress)
    await getProductImageUploadStatus('product-id', 'operation-id', signal)
    await getProductImagePreview('product-id', 'asset-id', signal)

    const form = post.mock.calls[0]![1] as FormData
    expect(form.get('operationId')).toBe('operation-id')
    expect(form.get('assetRole')).toBe('hero')
    expect(form.get('file')).toMatchObject({ name: 'hero.webp', size: 5, type: 'image/webp' })
    expect(post.mock.calls[0]![0]).toBe('/products/product-id/assets/images')
    expect(post.mock.calls[0]![2]).toEqual(expect.objectContaining({ signal, onUploadProgress: progress }))
    expect(get).toHaveBeenNthCalledWith(1, '/products/product-id/assets/images/uploads/operation-id', { signal })
    expect(get).toHaveBeenNthCalledWith(2, '/products/product-id/assets/images/asset-id/preview', {
      signal,
      responseType: 'blob',
    })
  })
})

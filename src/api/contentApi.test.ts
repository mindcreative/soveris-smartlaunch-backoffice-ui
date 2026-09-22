import { useAuthStore } from '../stores/authStore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import {
  createProduct,
  getContent,
  getProduct,
  getProducts,
  publishContent,
  saveContentDraft,
  updateProduct,
  validateContent,
} from './endpoints'
import type { ProductContentV1 } from '../types'

beforeEach(() => useAuthStore.setState({ user: {
  id: 'actor', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  email: 'actor@example.test', displayName: 'Actor', role: 'Admin',
  accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
} }))

const content: ProductContentV1 = {
  slug: 'demo',
  name: 'Demo',
  hero: {
    title: 'Title',
    subtitle: 'Subtitle',
    cta: { label: 'Go', href: '/go' },
    backgroundImage: { src: '/images/demo.png', alt: 'Demo' },
  },
}

describe('canonical content API', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gets the lossless live and draft envelope', async () => {
    const envelope = {
      productId: 'product-id', schemaVersion: null, revision: 7, content: {},
      draft: { schemaVersion: 1, revision: 4, content },
    }
    const request = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: envelope, status: 200 })

    await expect(getContent('product-id')).resolves.toBe(envelope)
    expect(request).toHaveBeenCalledWith('/content/product-id')
  })

  it('uses exact validate and draft-save request contracts', async () => {
    const validateRequest = { schemaVersion: 1, content, target: 'draft' as const }
    const saveRequest = { schemaVersion: 1, expectedRevision: 4, content }
    const report = { schemaVersion: 1, isValid: true, errors: [], warnings: [] }
    const envelope = {
      productId: 'product-id', schemaVersion: null, revision: 7, content: {},
      draft: { schemaVersion: 1, revision: 5, content },
    }
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: report, status: 200 })
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: envelope, status: 200 })

    await expect(validateContent('product-id', validateRequest)).resolves.toBe(report)
    await expect(saveContentDraft('product-id', saveRequest)).resolves.toBe(envelope)
    expect(post).toHaveBeenCalledWith('/content/product-id/validate', validateRequest)
    expect(put).toHaveBeenCalledWith('/content/product-id/draft', saveRequest)
  })

  it('uses exact scoped product identity and publication contracts', async () => {
    const signal = new AbortController().signal
    const page = { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 }
    const product = {
      id: 'product-id', clientId: 'client-id', name: 'Demo', slug: 'demo',
      status: 'active', publicationStatus: 'draft', revision: 1,
      contentSchemaVersion: null, contentRevision: 1, draftSchemaVersion: null,
      draftRevision: 0, completeness: { isComplete: false, missingRequirements: ['form'] },
      canonicalUrl: null, createdAt: '2026-09-12T00:00:00.000000', updatedAt: '2026-09-12T00:00:00.000000',
    }
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: page, status: 200 })
      .mockResolvedValueOnce({ data: product, status: 200 })
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: product, status: 201 })
      .mockResolvedValueOnce({ data: { ...product, publicationStatus: 'published' }, status: 200 })
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: product, status: 200 })

    await expect(getProducts('client-id', { status: 'all', publication: 'all' }, signal)).resolves.toEqual(page)
    await expect(getProduct('product-id', signal)).resolves.toEqual(product)
    await expect(createProduct('client-id', { operationId: 'operation-id', name: 'Demo', slug: 'demo' })).resolves.toEqual(product)
    await expect(updateProduct('product-id', {
      operationId: 'operation-id', expectedRevision: 1, name: 'Demo', slug: 'demo', status: 'active',
    })).resolves.toEqual(product)
    await expect(publishContent('product-id', { expectedDraftRevision: 2, expectedRevision: 1 })).resolves.toMatchObject({ publicationStatus: 'published' })

    expect(get).toHaveBeenNthCalledWith(1, '/clients/client-id/products?status=all&publication=all', { signal })
    expect(get).toHaveBeenNthCalledWith(2, '/products/product-id', { signal })
    expect(post).toHaveBeenNthCalledWith(1, '/clients/client-id/products', { operationId: 'operation-id', name: 'Demo', slug: 'demo' })
    expect(put).toHaveBeenCalledWith('/products/product-id', {
      operationId: 'operation-id', expectedRevision: 1, name: 'Demo', slug: 'demo', status: 'active',
    })
    expect(post).toHaveBeenNthCalledWith(2, '/content/product-id/publish', { expectedDraftRevision: 2, expectedRevision: 1 })
  })
})

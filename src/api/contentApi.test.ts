import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import { getContent, saveContentDraft, validateContent } from './endpoints'
import type { ProductContentV1 } from '../types'

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
})

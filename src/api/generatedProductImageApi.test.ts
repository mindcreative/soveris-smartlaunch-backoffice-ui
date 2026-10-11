import { describe, expect, it } from 'vitest'
import { parseGeneratedProductImageResponse } from './generatedProductImageApi'

const scope = { productId: '018f0000-0000-7000-8000-000000000001', operationId: '018f0000-0000-7000-8000-000000000002',
  jobId: '018f0000-0000-7000-8000-000000000003', resultId: '018f0000-0000-7000-8000-000000000004', assetRole: 'feature' as const }
const asset = { id: '018f0000-0000-7000-8000-000000000005', productId: scope.productId, role: 'feature',
  url: '/assets/product-images/018f0000-0000-7000-8000-000000000005.webp', mediaType: 'image/webp', byteLength: 1000,
  width: 400, height: 400, visibility: 'private', createdAt: '2026-10-10T10:00:00Z' }
const completed = { operationId: scope.operationId, status: 'completed', jobId: scope.jobId, resultId: scope.resultId,
  asset, storage: { usedBytes: 1000, limitBytes: 2000, remainingBytes: 1000 } }
describe('generated product image closed response', () => {
  it('accepts the exact stable source/product/operation/asset binding', () => {
    expect(parseGeneratedProductImageResponse(JSON.stringify(completed), 201, scope)).toEqual(completed)
  })
  it.each([
    { ...completed, reference: 'private' },
    { ...completed, jobId: scope.resultId },
    { ...completed, asset: { ...asset, role: 'hero' } },
    { ...completed, asset: { ...asset, productId: scope.jobId } },
    { ...completed, asset: { ...asset, url: 'https://private.invalid/source.webp' } },
    { ...completed, storage: { usedBytes: 1000, limitBytes: 2000, remainingBytes: 2000 } },
  ])('rejects extra/private/foreign/wrong-role or incoherent material', (value) => {
    expect(() => parseGeneratedProductImageResponse(JSON.stringify(value), 200, scope)).toThrow()
  })
  it('rejects duplicate raw properties and wrong success category', () => {
    expect(() => parseGeneratedProductImageResponse('{"status":"processing","status":"completed"}', 202, scope)).toThrow()
    expect(() => parseGeneratedProductImageResponse(JSON.stringify(completed), 202, scope)).toThrow()
  })
})

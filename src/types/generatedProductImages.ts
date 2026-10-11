import type { ProductImageAsset, ProductImageRole, ProductImageStorageSnapshot } from './productImages'

export interface GeneratedProductImageCommand { operationId: string; jobId: string; resultId: string; assetRole: ProductImageRole }
export interface GeneratedProductImageScope extends GeneratedProductImageCommand { productId: string }
export interface CompletedGeneratedProductImage {
  operationId: string; status: 'completed'; jobId: string; resultId: string
  asset: ProductImageAsset & { mediaType: 'image/webp' }; storage: ProductImageStorageSnapshot
}
export interface ProcessingGeneratedProductImage {
  operationId: string; status: 'processing'; jobId: string; resultId: string; retryAfterSeconds: number
}
export type GeneratedProductImageResponse = CompletedGeneratedProductImage | ProcessingGeneratedProductImage

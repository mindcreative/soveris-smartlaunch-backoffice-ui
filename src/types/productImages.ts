export type ProductImageRole = 'hero' | 'feature'

export interface ProductImageAsset {
  id: string
  productId: string
  role: ProductImageRole
  url: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteLength: number
  width: number
  height: number
  visibility: 'private'
  createdAt: string
}

export interface ProductImageStorageSnapshot {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
}

export interface CompletedProductImageUpload {
  operationId: string
  status: 'completed'
  asset: ProductImageAsset
  storage: ProductImageStorageSnapshot
}

export interface ProcessingProductImageUpload {
  status: 'processing'
}

export type ProductImageUploadResponse =
  | CompletedProductImageUpload
  | ProcessingProductImageUpload

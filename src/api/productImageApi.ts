import type { AxiosProgressEvent } from 'axios'
import { apiClient } from './apiClient'
import type { ProductImageRole, ProductImageUploadResponse } from '../types/productImages'

export async function uploadProductImage(
  productId: string,
  operationId: string,
  role: ProductImageRole,
  file: File,
  signal: AbortSignal,
  onUploadProgress: (event: AxiosProgressEvent) => void,
  onAuthReplay?: () => void,
): Promise<ProductImageUploadResponse> {
  const body = new FormData()
  body.append('operationId', operationId)
  body.append('assetRole', role)
  body.append('file', file, file.name)
  const response = await apiClient.post<ProductImageUploadResponse>(
    `/products/${productId}/assets/images`,
    body,
    { signal, onUploadProgress, onAuthReplay, headers: { 'Content-Type': undefined } },
  )
  return response.data
}

export async function getProductImageUploadStatus(
  productId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<ProductImageUploadResponse> {
  const response = await apiClient.get<ProductImageUploadResponse>(
    `/products/${productId}/assets/images/uploads/${operationId}`,
    { signal },
  )
  return response.data
}

export async function getProductImagePreview(
  productId: string,
  assetId: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await apiClient.get<Blob>(
    `/products/${productId}/assets/images/${assetId}/preview`,
    { signal, responseType: 'blob' },
  )
  return response.data
}

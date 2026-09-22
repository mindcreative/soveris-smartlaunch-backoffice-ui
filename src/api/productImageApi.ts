import type { AxiosProgressEvent } from 'axios'
import { apiClient } from './apiClient'
import type { ProductImageRole, ProductImageUploadResponse } from '../types/productImages'
import { localInstantDateTime } from '../timezone/LocalInstant'
import { localResponseBinding } from '../timezone/responseGuard'

function projectUpload(response: ProductImageUploadResponse,
  instant: Awaited<ReturnType<typeof localResponseBinding>>['instant']): ProductImageUploadResponse {
  if (!response || (response.status !== 'completed' && response.status !== 'processing'))
    throw new Error('Invalid product image upload response')
  if (response.status === 'processing') return response
  return { ...response, asset: { ...response.asset,
    createdAt: localInstantDateTime(instant(response.asset.createdAt)) } }
}

export async function uploadProductImage(
  productId: string,
  operationId: string,
  role: ProductImageRole,
  file: File,
  signal: AbortSignal,
  onUploadProgress: (event: AxiosProgressEvent) => void,
  onAuthReplay?: () => void,
): Promise<ProductImageUploadResponse> {
  const binding = await localResponseBinding(signal)
  const body = new FormData()
  body.append('operationId', operationId)
  body.append('assetRole', role)
  body.append('file', file, file.name)
  const response = await apiClient.post<ProductImageUploadResponse>(
    `/products/${productId}/assets/images`,
    body,
    { signal, onUploadProgress, onAuthReplay, headers: { 'Content-Type': undefined } },
  )
  binding.verify(response.headers)
  return projectUpload(response.data, binding.instant)
}

export async function getProductImageUploadStatus(
  productId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<ProductImageUploadResponse> {
  const binding = await localResponseBinding(signal)
  const response = await apiClient.get<ProductImageUploadResponse>(
    `/products/${productId}/assets/images/uploads/${operationId}`,
    { signal },
  )
  binding.verify(response.headers)
  return projectUpload(response.data, binding.instant)
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

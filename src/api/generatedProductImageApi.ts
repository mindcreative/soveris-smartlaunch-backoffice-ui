import { apiClient } from './apiClient'
import { assertNoDuplicateObjectKeys, isCanonicalUuidV7 } from './aiImageApi'
import { useAuthStore } from '../stores/authStore'
import type { GeneratedProductImageResponse, GeneratedProductImageScope } from '../types/generatedProductImages'

function invalid(): never { throw new Error('The generated product image response is invalid. Check its authorized status before continuing.') }
function exact(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join('|') !== names.sort().join('|')) return invalid()
  return row
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) return invalid()
  return value
}
export function parseGeneratedProductImageResponse(raw: string, status: number, scope: GeneratedProductImageScope): GeneratedProductImageResponse {
  assertNoDuplicateObjectKeys(raw)
  const parsed: unknown = JSON.parse(raw)
  const preview = parsed as { status?: unknown } | null
  if (preview?.status === 'processing') {
    const row = exact(parsed, ['operationId', 'status', 'jobId', 'resultId', 'retryAfterSeconds'])
    if (status !== 202 || row.operationId !== scope.operationId || row.jobId !== scope.jobId || row.resultId !== scope.resultId) return invalid()
    return { operationId: scope.operationId, status: 'processing', jobId: scope.jobId, resultId: scope.resultId,
      retryAfterSeconds: integer(row.retryAfterSeconds, 1, 300) }
  }
  const row = exact(parsed, ['operationId', 'status', 'jobId', 'resultId', 'asset', 'storage'])
  if (![200, 201].includes(status) || row.status !== 'completed' || row.operationId !== scope.operationId ||
    row.jobId !== scope.jobId || row.resultId !== scope.resultId) return invalid()
  const asset = exact(row.asset, ['id', 'productId', 'role', 'url', 'mediaType', 'byteLength', 'width', 'height', 'visibility', 'createdAt'])
  if (typeof asset.id !== 'string' || !isCanonicalUuidV7(asset.id) || asset.productId !== scope.productId || asset.role !== scope.assetRole ||
    asset.mediaType !== 'image/webp' || asset.visibility !== 'private' || asset.url !== `/assets/product-images/${asset.id}.webp` ||
    typeof asset.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(asset.createdAt) || !Number.isFinite(Date.parse(asset.createdAt))) return invalid()
  const byteLength = integer(asset.byteLength, 1, scope.assetRole === 'hero' ? 2097152 : 1048576)
  const width = integer(asset.width, scope.assetRole === 'hero' ? 1200 : 400, 8192)
  const height = integer(asset.height, scope.assetRole === 'hero' ? 630 : 400, 8192)
  if (width * height > 40000000) return invalid()
  const storage = exact(row.storage, ['usedBytes', 'limitBytes', 'remainingBytes'])
  const usedBytes = integer(storage.usedBytes); const limitBytes = integer(storage.limitBytes); const remainingBytes = integer(storage.remainingBytes)
  if (usedBytes < byteLength || remainingBytes !== Math.max(0, limitBytes - usedBytes)) return invalid()
  return { operationId: scope.operationId, status: 'completed', jobId: scope.jobId, resultId: scope.resultId,
    asset: { id: asset.id, productId: scope.productId, role: scope.assetRole, url: asset.url as string, mediaType: 'image/webp',
      byteLength, width, height, visibility: 'private', createdAt: asset.createdAt }, storage: { usedBytes, limitBytes, remainingBytes } }
}
function identity(): string {
  const state = useAuthStore.getState()
  return `${state.user?.id ?? ''}|${state.user?.clientId ?? ''}|${state.user?.role ?? ''}|${state.accessToken ?? ''}`
}
function validateScope(scope: GeneratedProductImageScope): void {
  if (![scope.operationId, scope.jobId, scope.resultId].every(isCanonicalUuidV7) || !['hero', 'feature'].includes(scope.assetRole) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scope.productId)) return invalid()
}
export async function adoptGeneratedProductImage(scope: GeneratedProductImageScope, signal: AbortSignal): Promise<GeneratedProductImageResponse> {
  validateScope(scope); const actor = identity()
  const response = await apiClient.post<string>(`/products/${scope.productId}/assets/images/adoptions`,
    { operationId: scope.operationId, jobId: scope.jobId, resultId: scope.resultId, assetRole: scope.assetRole },
    { signal, retryOnUnauthorized: false, responseType: 'text', transformResponse: [(raw: string) => raw] })
  if (signal.aborted || actor !== identity() || typeof response.data !== 'string') return invalid()
  return parseGeneratedProductImageResponse(response.data, response.status, scope)
}
export async function getGeneratedProductImageStatus(scope: GeneratedProductImageScope, signal: AbortSignal): Promise<GeneratedProductImageResponse> {
  validateScope(scope); const actor = identity()
  const response = await apiClient.get<string>(`/products/${scope.productId}/assets/images/adoptions/${scope.operationId}`,
    { signal, retryOnUnauthorized: false, responseType: 'text', transformResponse: [(raw: string) => raw] })
  if (signal.aborted || actor !== identity() || typeof response.data !== 'string') return invalid()
  return parseGeneratedProductImageResponse(response.data, response.status, scope)
}

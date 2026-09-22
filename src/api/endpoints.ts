import { apiClient } from './apiClient'
import { localInstantDateTime, parseLocalInstant, type LocalInstantValue } from '../timezone/LocalInstant'
import { localResponseBinding } from '../timezone/responseGuard'
import type {
  AuthUser,
  LoginCredentials,
  AuthResponse,
  RefreshTokenRequest,
} from '../types/auth'
import type {
  PaginatedResult,
  ProductContentEnvelope,
  ProductContentValidationReport,
  ValidateProductContentRequest,
  SaveProductContentDraftRequest,
  PublishProductContentRequest,
  ProductContentPublicationResult,
  Product,
  ProductPage,
  ProductFilters,
  CreateProductRequest,
  UpdateProductRequest,
  Submission,
  SubmissionSummary,
  GetSubmissionsRequest,
  OverviewMetrics,
  FunnelStageCount,
  GeographyData,
  TrendPoint,
  TrafficSource,
  ProductBreakdown,
  BackOfficeUser,
  BackOfficeUserDetail,
  CreatedBackOfficeUser,
  UpdatedBackOfficeUser,
  CreateUserRequest,
  UpdateUserRequest,
} from '../types'

export {
  billingApi,
  getBillingAccountSnapshot,
  getBillingLedgerPage,
  parseBillingAccountSnapshot,
  parseBillingLedgerPage,
} from './billingApi'

// ==================== AUTH ENDPOINTS ====================

export async function login(credentials: LoginCredentials): Promise<AuthResponse & { user: AuthUser }> {
  const response = await apiClient.post('/auth/login', credentials)
  return response.data as AuthResponse & { user: AuthUser }
}

export async function refreshToken(request: RefreshTokenRequest): Promise<AuthResponse> {
  const response = await apiClient.post('/auth/refresh', request)
  return response.data as AuthResponse
}

// NOTE: /auth/me is not implemented in the API. Use getCurrentUser from JWT payload instead.
// export async function getCurrentUser(): Promise<AuthUser> {
//   const response = await apiClient.get('/auth/me')
//   return response.data as AuthUser
// }

// NOTE: /auth/logout is not implemented in the API. Token revocation uses /auth/revoke.
// export async function logout(): Promise<void> {
//   await apiClient.post('/auth/logout')
// }

// ==================== USERS ENDPOINTS ====================

function parseBackOfficeUser<T extends Partial<BackOfficeUser>>(value: T,
  instant: (value: unknown) => LocalInstantValue, requireBoth = false): T {
  if (!value || typeof value !== 'object') throw new Error('Invalid user response')
  if (requireBoth && (value.createdAt === undefined || value.updatedAt === undefined))
    throw new Error('Missing user timestamps')
  return { ...value,
    ...(value.createdAt !== undefined && { createdAt: instant(value.createdAt) }),
    ...(value.updatedAt !== undefined && { updatedAt: instant(value.updatedAt) }) } as T
}

export async function getUsers(params?: {
  page?: number
  pageSize?: number
  search?: string
  role?: string
}): Promise<PaginatedResult<BackOfficeUser>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.search) queryParams.set('search', params.search)
  if (params?.role) queryParams.set('role', params.role)

  const queryString = queryParams.toString()
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/users${queryString ? `?${queryString}` : ''}`)
  binding.verify(response.headers)
  const page = response.data as PaginatedResult<BackOfficeUser>
  if (!page || !Array.isArray(page.data)) throw new Error('Invalid user page')
  return { ...page, data: page.data.map((user) => parseBackOfficeUser(user, binding.instant, true)) }
}

export async function getUser(userId: string): Promise<BackOfficeUserDetail> {
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/users/${userId}`)
  binding.verify(response.headers)
  return parseBackOfficeUser(response.data as BackOfficeUserDetail, binding.instant)
}

export async function createUser(data: CreateUserRequest): Promise<CreatedBackOfficeUser> {
  const binding = await localResponseBinding()
  const response = await apiClient.post('/users', data)
  binding.verify(response.headers)
  return parseBackOfficeUser(response.data as CreatedBackOfficeUser, binding.instant)
}

export async function updateUser(userId: string, data: UpdateUserRequest): Promise<UpdatedBackOfficeUser> {
  const binding = await localResponseBinding()
  const response = await apiClient.put(`/users/${userId}`, data)
  binding.verify(response.headers)
  return response.data as UpdatedBackOfficeUser
}

// NOTE: deleteUser is not implemented in the API. Use deactivateUser instead.
export async function deactivateUser(userId: string): Promise<void> {
  await apiClient.delete(`/users/${userId}`)
}

export async function resetUserPassword(userId: string): Promise<unknown> {
  const response = await apiClient.put(`/users/${userId}/reset-password`, {})
  return response.data
}

export async function getUserAuditLog(userId: string): Promise<AuditLogEntry[]> {
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/users/${userId}/audit`)
  binding.verify(response.headers)
  if (!Array.isArray(response.data)) throw new Error('Invalid user audit history')
  return response.data.map(parseAuditEntry)
}

// ==================== CONTENT ENDPOINTS ====================

// GET /api/backoffice/clients/{clientId}/products — canonical scoped product list
export async function getProducts(
  clientId: string,
  filters: ProductFilters = {},
  signal?: AbortSignal,
): Promise<ProductPage> {
  const queryParams = new URLSearchParams()
  if (filters.page !== undefined) queryParams.set('page', String(filters.page))
  if (filters.pageSize !== undefined) queryParams.set('pageSize', String(filters.pageSize))
  if (filters.status) queryParams.set('status', filters.status)
  if (filters.publication) queryParams.set('publication', filters.publication)
  if (filters.search?.trim()) queryParams.set('search', filters.search.trim())
  if (filters.sort) queryParams.set('sort', filters.sort)
  if (filters.direction) queryParams.set('direction', filters.direction)
  const query = queryParams.toString()
  const binding = await localResponseBinding(signal)
  const response = await apiClient.get(`/clients/${clientId}/products${query ? `?${query}` : ''}`, { signal })
  binding.verify(response.headers)
  const page = response.data as ProductPage
  if (!page || !Array.isArray(page.items)) throw new Error('Invalid product page')
  return { ...page, items: page.items.map((item) => projectProductDates(item, binding.instant)) }
}

function projectProductDates(product: Product, instant: (value: unknown) => LocalInstantValue): Product {
  if (!product || typeof product !== 'object') throw new Error('Invalid product')
  return { ...product, createdAt: localInstantDateTime(instant(product.createdAt)),
    updatedAt: localInstantDateTime(instant(product.updatedAt)) }
}

export async function getProduct(productId: string, signal?: AbortSignal): Promise<Product> {
  const binding = await localResponseBinding(signal)
  const response = await apiClient.get(`/products/${productId}`, { signal })
  binding.verify(response.headers)
  return projectProductDates(response.data as Product, binding.instant)
}

export async function createProduct(clientId: string, data: CreateProductRequest): Promise<Product> {
  const binding = await localResponseBinding()
  const response = await apiClient.post(`/clients/${clientId}/products`, data)
  binding.verify(response.headers)
  return projectProductDates(response.data as Product, binding.instant)
}

export async function updateProduct(productId: string, data: UpdateProductRequest): Promise<Product> {
  const binding = await localResponseBinding()
  const response = await apiClient.put(`/products/${productId}`, data)
  binding.verify(response.headers)
  return projectProductDates(response.data as Product, binding.instant)
}

// GET /api/backoffice/content/{productId} — Get content for a specific product
export async function getContent(productId: string, signal?: AbortSignal): Promise<ProductContentEnvelope> {
  const response = signal
    ? await apiClient.get(`/content/${productId}`, { signal })
    : await apiClient.get(`/content/${productId}`)
  return response.data as ProductContentEnvelope
}

export async function validateContent(
  productId: string,
  data: ValidateProductContentRequest
): Promise<ProductContentValidationReport> {
  const response = await apiClient.post(`/content/${productId}/validate`, data)
  return response.data as ProductContentValidationReport
}

export async function saveContentDraft(
  productId: string,
  data: SaveProductContentDraftRequest
): Promise<ProductContentEnvelope> {
  const response = await apiClient.put(`/content/${productId}/draft`, data)
  return response.data as ProductContentEnvelope
}

export async function publishContent(
  productId: string,
  data: PublishProductContentRequest,
): Promise<ProductContentPublicationResult> {
  const response = await apiClient.post(`/content/${productId}/publish`, data)
  return response.data as ProductContentPublicationResult
}

// NOTE: createContent and deleteContent are not implemented in the API.
// Content creation/deletion and live publication are owned by later product stories.
// export async function deleteContent(id: string): Promise<void> { ... }

// ==================== SUBMISSIONS ENDPOINTS ====================

export async function getSubmissions(params?: GetSubmissionsRequest): Promise<PaginatedResult<SubmissionSummary>> {
  const binding = await localResponseBinding()
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.productId) queryParams.set('productId', params.productId)
  if (params?.status) queryParams.set('status', params.status)
  // API expects fromDate/toDate, but the type uses startDate/endDate — map them
  if (params?.startDate) queryParams.set('fromDate', params.startDate)
  if (params?.endDate) queryParams.set('toDate', params.endDate)
  if (params?.sortBy) queryParams.set('sortBy', params.sortBy)
  if (params?.sortDirection) queryParams.set('sortDirection', params.sortDirection)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/submissions${queryString ? `?${queryString}` : ''}`)
  binding.verify(response.headers)
  const page = response.data as PaginatedResult<SubmissionSummary>
  if (!page || !Array.isArray(page.data)) throw new Error('Invalid submission page')
  return { ...page, data: page.data.map((row) => ({ ...row,
    createdAt: binding.instant(row.createdAt),
    updatedAt: row.updatedAt ? binding.instant(row.updatedAt) : null,
  })) }
}

export async function getSubmission(id: string): Promise<Submission> {
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/submissions/${id}`)
  binding.verify(response.headers)
  const row = response.data as Submission
  return { ...row, createdAt: binding.instant(row.createdAt),
    updatedAt: row.updatedAt ? binding.instant(row.updatedAt) : null,
    expiresAt: row.expiresAt ? binding.instant(row.expiresAt) : null }
}

export async function deleteSubmission(id: string): Promise<void> {
  await apiClient.delete(`/submissions/${id}`)
}

export async function exportSubmissions(format?: 'csv' | 'json'): Promise<Blob> {
  const binding = await localResponseBinding()
  const f = format ?? 'csv'
  const response = await apiClient.get(`/submissions/export?format=${f}`, { responseType: 'blob' })
  binding.verify(response.headers)
  return response.data as Blob
}

// NOTE: updateSubmissionStatus and rejectSubmission are not implemented in the API.
// export async function updateSubmissionStatus(id, status, notes?): Promise<Submission> { ... }
// export async function rejectSubmission(id, reason: string): Promise<Submission> { ... }

// ==================== ANALYTICS ENDPOINTS ====================

export async function getOverviewMetrics(params?: { fromDate?: string; toDate?: string }): Promise<OverviewMetrics> {
  const binding = await localResponseBinding()
  const queryParams = new URLSearchParams()
  if (params?.fromDate) queryParams.set('fromDate', params.fromDate)
  if (params?.toDate) queryParams.set('toDate', params.toDate)
  const queryString = queryParams.toString()
  const response = await apiClient.get(`/analytics/overview${queryString ? `?${queryString}` : ''}`)
  binding.verify(response.headers)
  const metrics = response.data as OverviewMetrics
  if (!metrics || typeof metrics.totalSubmissions !== 'number' ||
      typeof metrics.verifiedSubmissions !== 'number' ||
      typeof metrics.verificationRate !== 'number' ||
      typeof metrics.conversionRate !== 'number' ||
      typeof metrics.totalPageViews !== 'number' ||
      metrics.fromDate !== (params?.fromDate || null) ||
      metrics.toDate !== (params?.toDate || null))
    throw new Error('Invalid saved-zone analytics response')
  return metrics
}

export async function getFunnelData(): Promise<FunnelStageCount[]> {
  const response = await apiClient.get('/analytics/funnel')
  return response.data as FunnelStageCount[]
}

export async function getGeographyData(): Promise<GeographyData[]> {
  const response = await apiClient.get('/analytics/geography')
  return response.data as GeographyData[]
}

export async function getTrendData(params?: { interval?: string; fromDate?: string; toDate?: string }): Promise<TrendPoint[]> {
  const queryParams = new URLSearchParams()
  if (params?.interval) queryParams.set('interval', params.interval)
  if (params?.fromDate) queryParams.set('fromDate', params.fromDate)
  if (params?.toDate) queryParams.set('toDate', params.toDate)
  const queryString = queryParams.toString()
  const response = await apiClient.get(`/analytics/trends${queryString ? `?${queryString}` : ''}`)
  return response.data as TrendPoint[]
}

// Fixed: /analytics/traffic-sources → /analytics/traffic
export async function getTrafficSources(): Promise<TrafficSource[]> {
  const response = await apiClient.get('/analytics/traffic')
  return response.data as TrafficSource[]
}

// Fixed: /analytics/products → /analytics/products/{productId} (requires productId)
export async function getProductBreakdown(productId: string): Promise<ProductBreakdown> {
  const response = await apiClient.get(`/analytics/products/${productId}`)
  return response.data as ProductBreakdown
}

// ==================== AI ENDPOINTS ====================

export interface AiGenerationRequest {
  prompt: string
  type: 'headline' | 'description' | 'faq' | 'seo' | 'cta'
  context?: Record<string, unknown>
}

// NOTE: /ai/tools endpoint does not exist in the API. Removed getAiTools().
// export async function getAiTools(): Promise<AiTool[]> { ... }

// Fixed: /ai/generate → /ai/generate-content
export async function generateContent(request: AiGenerationRequest): Promise<{
  content: string
  suggestions: string[]
  metadata: Record<string, unknown>
}> {
  const response = await apiClient.post('/ai/generate-content', request)
  return response.data as {
    content: string
    suggestions: string[]
    metadata: Record<string, unknown>
  }
}

// Fixed: /ai/analyze/{id} → use individual AI endpoints instead
// Available AI endpoints: /ai/generate-seo, /ai/generate-headline, /ai/generate-image-prompt, /ai/rewrite-content
export async function generateSeo(request: { content: string; language?: string }): Promise<string> {
  const response = await apiClient.post('/ai/generate-seo', request)
  return response.data as string
}

export async function generateHeadline(request: { content: string; tone?: string }): Promise<string> {
  const response = await apiClient.post('/ai/generate-headline', request)
  return response.data as string
}

export async function generateImagePrompt(request: { description: string }): Promise<string> {
  const response = await apiClient.post('/ai/generate-image-prompt', request)
  return response.data as string
}

export async function rewriteContent(request: { content: string; style?: string }): Promise<string> {
  const response = await apiClient.post('/ai/rewrite-content', request)
  return response.data as string
}

// ==================== AUDIT ENDPOINTS ====================

export interface AuditLogEntry {
  id: string
  action: string
  entityType: string
  entityId?: string
  userId?: string
  userName?: string
  ipAddress?: string
  userAgent?: string
  details?: Record<string, unknown>
  createdAt: LocalInstantValue
  [key: string]: unknown
}

export interface GetAuditLogsParams {
  page?: number
  pageSize?: number
  action?: string
  userId?: string
  entityType?: string
  startDate?: string
  endDate?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

function parseAuditEntry(value: unknown): AuditLogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audit entry')
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'string' || typeof data.action !== 'string' ||
      typeof data.entityType !== 'string') throw new Error('Invalid audit entry')
  return { ...data, createdAt: parseLocalInstant(data.createdAt) } as AuditLogEntry
}

// Fixed: /audit → /audit-logs
export async function getAuditLogs(params?: GetAuditLogsParams): Promise<PaginatedResult<AuditLogEntry>> {
  const binding = await localResponseBinding()
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.action) queryParams.set('action', params.action)
  if (params?.userId) queryParams.set('userId', params.userId)
  if (params?.entityType) queryParams.set('entityType', params.entityType)
  if (params?.startDate) queryParams.set('startDate', params.startDate)
  if (params?.endDate) queryParams.set('endDate', params.endDate)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/audit-logs${queryString ? `?${queryString}` : ''}`)
  binding.verify(response.headers)
  const result = response.data as PaginatedResult<unknown>
  if (!result || !Array.isArray(result.data)) throw new Error('Invalid audit page')
  return { ...result, data: result.data.map(parseAuditEntry) }
}

// GET /api/backoffice/audit-logs/{id} — Get single audit log entry by ID
export async function getAuditLogById(id: string): Promise<AuditLogEntry> {
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/audit-logs/${id}`)
  binding.verify(response.headers)
  return parseAuditEntry(response.data)
}

// GET /api/backoffice/audit-logs/entity?entityType={type}&entityId={id}
export async function getEntityAuditLog(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
  const binding = await localResponseBinding()
  const response = await apiClient.get('/audit-logs/entity', {
    params: { entityType, entityId }
  })
  binding.verify(response.headers)
  if (!Array.isArray(response.data)) throw new Error('Invalid audit history')
  return response.data.map(parseAuditEntry)
}

// ==================== CLIENTS ENDPOINTS ====================

export interface Client {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// NOTE: API has no list endpoint for clients. Only GET /clients/{id} exists.
// getClients() will fail until a list endpoint is added to the API.
export async function getClients(): Promise<Client[]> {
  // This endpoint does not exist in the API. Placeholder only.
  // API only supports: GET /clients/{id}, PUT /clients/{id}, GET /clients/{id}/dashboard
  throw new Error('Client listing is not implemented in the backoffice-api')
}

export async function getClient(id: string): Promise<Client> {
  const binding = await localResponseBinding()
  const response = await apiClient.get(`/clients/${id}`)
  binding.verify(response.headers)
  const client = response.data as Client
  if (!client || typeof client !== 'object') throw new Error('Invalid Client response')
  return { ...client, createdAt: localInstantDateTime(binding.instant(client.createdAt)),
    ...(client.updatedAt !== undefined && { updatedAt: localInstantDateTime(binding.instant(client.updatedAt)) }) }
}

// NOTE: createClient and deleteClient are not implemented in the API.
// export async function createClient(data: Partial<Client>): Promise<Client> { ... }
// export async function deleteClient(id: string): Promise<void> { ... }

export async function updateClient(id: string, data: Partial<Client>): Promise<Client> {
  const binding = await localResponseBinding()
  const response = await apiClient.put(`/clients/${id}`, data)
  binding.verify(response.headers)
  const envelope = response.data as { client?: Client }
  if (!envelope || typeof envelope !== 'object' || !envelope.client) throw new Error('Invalid Client update response')
  return { ...envelope.client,
    createdAt: localInstantDateTime(binding.instant(envelope.client.createdAt)),
    ...(envelope.client.updatedAt !== undefined && {
      updatedAt: localInstantDateTime(binding.instant(envelope.client.updatedAt)) }) }
}

export async function getClientDashboard(id: string): Promise<Record<string, unknown>> {
  const response = await apiClient.get(`/clients/${id}/dashboard`)
  return response.data as Record<string, unknown>
}

// ==================== SETTINGS ENDPOINTS ====================

export interface Settings {
  siteName: string
  siteUrl: string
  contactEmail: string
  maintenanceMode: boolean
  registrationEnabled: boolean
  [key: string]: unknown
}

// NOTE: /settings endpoint does not exist in the API.
export async function getSettings(): Promise<Settings> {
  throw new Error('Settings endpoint is not implemented in the backoffice-api')
}

export async function updateSettings(_data: Partial<Settings>): Promise<Settings> {
  throw new Error('Settings endpoint is not implemented in the backoffice-api')
}

// ==================== THEME ENDPOINTS ====================

export interface ThemeConfig {
  primaryColor: string
  secondaryColor: string
  fontFamily: string
  logoUrl?: string
  faviconUrl?: string
  [key: string]: unknown
}

// Fixed: /theme → /products/{productId}/theme (requires productId)
export async function getTheme(productId: string): Promise<ThemeConfig> {
  const response = await apiClient.get(`/products/${productId}/theme`)
  return response.data as ThemeConfig
}

// Fixed: /theme → /products/{productId}/theme (requires productId)
export async function updateTheme(productId: string, data: Partial<ThemeConfig>): Promise<ThemeConfig> {
  const response = await apiClient.put(`/products/${productId}/theme`, data)
  return response.data as ThemeConfig
}

// ==================== HEALTH ENDPOINTS ====================

export async function checkHealth(): Promise<{
  status: string
  database: string
  redis: string
  uptime: number
  version: string
}> {
  const response = await apiClient.get('/health')
  return response.data as {
    status: string
    database: string
    redis: string
    uptime: number
    version: string
  }
}

export async function checkReadiness(): Promise<Record<string, unknown>> {
  const response = await apiClient.get('/ready')
  return response.data as Record<string, unknown>
}

export async function checkLiveness(): Promise<Record<string, unknown>> {
  const response = await apiClient.get('/live')
  return response.data as Record<string, unknown>
}

// Export all endpoint functions as a namespace for convenience
export const authApi = { login, refreshToken }
export const usersApi = { getUsers, getUser, createUser, updateUser, deactivateUser, resetUserPassword, getUserAuditLog }
export const contentApi = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  getContent,
  validateContent,
  saveContentDraft,
  publishContent,
}
export const submissionsApi = { getSubmissions, getSubmission, deleteSubmission, exportSubmissions }
export const analyticsApi = { getOverviewMetrics, getFunnelData, getGeographyData, getTrendData, getTrafficSources, getProductBreakdown }
export const aiApi = { generateContent, generateSeo, generateHeadline, generateImagePrompt, rewriteContent }
export const auditApi = { getAuditLogs, getAuditLogById, getEntityAuditLog }
export const clientsApi = { getClient, updateClient, getClientDashboard }
export const settingsApi = { getSettings, updateSettings }
export const themeApi = { getTheme, updateTheme }
export const healthApi = { checkHealth, checkReadiness, checkLiveness }

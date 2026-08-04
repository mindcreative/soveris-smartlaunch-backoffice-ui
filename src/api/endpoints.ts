import { apiClient } from './apiClient'
import type {
  AuthUser,
  LoginCredentials,
  AuthResponse,
  RefreshTokenRequest,
} from '../types/auth'
import type {
  PaginatedResult,
  ProductContent,
  Submission,
  SubmissionStatus,
  GetSubmissionsRequest,
  OverviewMetrics,
  FunnelStageCount,
  GeographyData,
  TrendPoint,
  TrafficSource,
  ProductBreakdown,
  BackOfficeUser,
  CreateUserRequest,
  UpdateUserRequest,
} from '../types'

// ==================== AUTH ENDPOINTS ====================

export async function login(credentials: LoginCredentials): Promise<AuthResponse & { user: AuthUser }> {
  const response = await apiClient.post('/auth/login', credentials)
  return response.data as AuthResponse & { user: AuthUser }
}

export async function refreshToken(request: RefreshTokenRequest): Promise<AuthResponse> {
  const response = await apiClient.post('/auth/refresh', request)
  return response.data as AuthResponse
}

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await apiClient.get('/auth/me')
  return response.data as AuthUser
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}

// ==================== USERS ENDPOINTS ====================

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
  const response = await apiClient.get(`/users${queryString ? `?${queryString}` : ''}`)
  return response.data as PaginatedResult<BackOfficeUser>
}

export async function getUser(userId: string): Promise<BackOfficeUser> {
  const response = await apiClient.get(`/users/${userId}`)
  return response.data as BackOfficeUser
}

export async function createUser(data: CreateUserRequest): Promise<BackOfficeUser> {
  const response = await apiClient.post('/users', data)
  return response.data as BackOfficeUser
}

export async function updateUser(userId: string, data: UpdateUserRequest): Promise<BackOfficeUser> {
  const response = await apiClient.put(`/users/${userId}`, data)
  return response.data as BackOfficeUser
}

export async function deleteUser(userId: string): Promise<void> {
  await apiClient.delete(`/users/${userId}`)
}

// ==================== CONTENT ENDPOINTS ====================

export async function getContents(params?: {
  page?: number
  pageSize?: number
  search?: string
  clientId?: string
}): Promise<PaginatedResult<ProductContent>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.search) queryParams.set('search', params.search)
  if (params?.clientId) queryParams.set('clientId', params.clientId)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/content${queryString ? `?${queryString}` : ''}`)
  return response.data as PaginatedResult<ProductContent>
}

export async function getContent(id: string): Promise<ProductContent> {
  const response = await apiClient.get(`/content/${id}`)
  return response.data as ProductContent
}

export async function createContent(data: Partial<ProductContent>): Promise<ProductContent> {
  const response = await apiClient.post('/content', data)
  return response.data as ProductContent
}

export async function updateContent(id: string, data: Partial<ProductContent>): Promise<ProductContent> {
  const response = await apiClient.put(`/content/${id}`, data)
  return response.data as ProductContent
}

export async function deleteContent(id: string): Promise<void> {
  await apiClient.delete(`/content/${id}`)
}

// ==================== SUBMISSIONS ENDPOINTS ====================

export async function getSubmissions(params?: GetSubmissionsRequest): Promise<PaginatedResult<Submission>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.productId) queryParams.set('productId', params.productId)
  if (params?.status) queryParams.set('status', params.status)
  if (params?.startDate) queryParams.set('startDate', params.startDate)
  if (params?.endDate) queryParams.set('endDate', params.endDate)
  if (params?.sortBy) queryParams.set('sortBy', params.sortBy)
  if (params?.sortDirection) queryParams.set('sortDirection', params.sortDirection)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/submissions${queryString ? `?${queryString}` : ''}`)
  return response.data as PaginatedResult<Submission>
}

export async function getSubmission(id: string): Promise<Submission> {
  const response = await apiClient.get(`/submissions/${id}`)
  return response.data as Submission
}

export async function updateSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  notes?: string
): Promise<Submission> {
  const response = await apiClient.patch(`/submissions/${id}/status`, { status, notes })
  return response.data as Submission
}

export async function rejectSubmission(id: string, reason: string): Promise<Submission> {
  const response = await apiClient.post(`/submissions/${id}/reject`, { reason })
  return response.data as Submission
}

// ==================== ANALYTICS ENDPOINTS ====================

export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const response = await apiClient.get('/analytics/overview')
  return response.data as OverviewMetrics
}

export async function getFunnelData(): Promise<FunnelStageCount[]> {
  const response = await apiClient.get('/analytics/funnel')
  return response.data as FunnelStageCount[]
}

export async function getGeographyData(): Promise<GeographyData[]> {
  const response = await apiClient.get('/analytics/geography')
  return response.data as GeographyData[]
}

export async function getTrendData(): Promise<TrendPoint[]> {
  const response = await apiClient.get('/analytics/trends')
  return response.data as TrendPoint[]
}

export async function getTrafficSources(): Promise<TrafficSource[]> {
  const response = await apiClient.get('/analytics/traffic-sources')
  return response.data as TrafficSource[]
}

export async function getProductBreakdown(): Promise<ProductBreakdown[]> {
  const response = await apiClient.get('/analytics/products')
  return response.data as ProductBreakdown[]
}

// ==================== AI ENDPOINTS ====================

export interface AiGenerationRequest {
  prompt: string
  type: 'headline' | 'description' | 'faq' | 'seo' | 'cta'
  context?: Record<string, unknown>
}

export interface AiTool {
  id: string
  name: string
  description: string
  type: string
}

export async function getAiTools(): Promise<AiTool[]> {
  const response = await apiClient.get('/ai/tools')
  return response.data as AiTool[]
}

export async function generateContent(request: AiGenerationRequest): Promise<{
  content: string
  suggestions: string[]
  metadata: Record<string, unknown>
}> {
  const response = await apiClient.post('/ai/generate', request)
  return response.data as {
    content: string
    suggestions: string[]
    metadata: Record<string, unknown>
  }
}

export async function analyzeSubmission(submissionId: string): Promise<{
  sentiment: string
  confidence: number
  categories: string[]
  summary: string
  recommendations: string[]
}> {
  const response = await apiClient.post(`/ai/analyze/${submissionId}`)
  return response.data as {
    sentiment: string
    confidence: number
    categories: string[]
    summary: string
    recommendations: string[]
  }
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
  createdAt: string
}

export interface GetAuditLogsParams {
  page?: number
  pageSize?: number
  action?: string
  userId?: string
  entityType?: string
  startDate?: string
  endDate?: string
}

export async function getAuditLogs(params?: GetAuditLogsParams): Promise<PaginatedResult<AuditLogEntry>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.action) queryParams.set('action', params.action)
  if (params?.userId) queryParams.set('userId', params.userId)
  if (params?.entityType) queryParams.set('entityType', params.entityType)
  if (params?.startDate) queryParams.set('startDate', params.startDate)
  if (params?.endDate) queryParams.set('endDate', params.endDate)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/audit${queryString ? `?${queryString}` : ''}`)
  return response.data as PaginatedResult<AuditLogEntry>
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

export async function getClients(params?: {
  page?: number
  pageSize?: number
  search?: string
}): Promise<PaginatedResult<Client>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', String(params.page))
  if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params?.search) queryParams.set('search', params.search)

  const queryString = queryParams.toString()
  const response = await apiClient.get(`/clients${queryString ? `?${queryString}` : ''}`)
  return response.data as PaginatedResult<Client>
}

export async function getClient(id: string): Promise<Client> {
  const response = await apiClient.get(`/clients/${id}`)
  return response.data as Client
}

export async function createClient(data: Partial<Client>): Promise<Client> {
  const response = await apiClient.post('/clients', data)
  return response.data as Client
}

export async function updateClient(id: string, data: Partial<Client>): Promise<Client> {
  const response = await apiClient.put(`/clients/${id}`, data)
  return response.data as Client
}

export async function deleteClient(id: string): Promise<void> {
  await apiClient.delete(`/clients/${id}`)
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

export async function getSettings(): Promise<Settings> {
  const response = await apiClient.get('/settings')
  return response.data as Settings
}

export async function updateSettings(data: Partial<Settings>): Promise<Settings> {
  const response = await apiClient.put('/settings', data)
  return response.data as Settings
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

export async function getTheme(): Promise<ThemeConfig> {
  const response = await apiClient.get('/theme')
  return response.data as ThemeConfig
}

export async function updateTheme(data: Partial<ThemeConfig>): Promise<ThemeConfig> {
  const response = await apiClient.put('/theme', data)
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

// Export all endpoint functions as a namespace for convenience
export const authApi = { login, refreshToken, getCurrentUser, logout }
export const usersApi = { getUsers, getUser, createUser, updateUser, deleteUser }
export const contentApi = { getContents, getContent, createContent, updateContent, deleteContent }
export const submissionsApi = { getSubmissions, getSubmission, updateSubmissionStatus, rejectSubmission }
export const analyticsApi = { getOverviewMetrics, getFunnelData, getGeographyData, getTrendData, getTrafficSources, getProductBreakdown }
export const aiApi = { getAiTools, generateContent, analyzeSubmission }
export const auditApi = { getAuditLogs }
export const clientsApi = { getClients, getClient, createClient, updateClient, deleteClient }
export const settingsApi = { getSettings, updateSettings }
export const themeApi = { getTheme, updateTheme }
export const healthApi = { checkHealth }
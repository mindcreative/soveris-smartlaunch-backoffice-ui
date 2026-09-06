import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  usersApi,
  contentApi,
  submissionsApi,
  analyticsApi,
  aiApi,
  auditApi,
  clientsApi,
  getClients,
  settingsApi,
  themeApi,
  healthApi,
  type Client,
  type AiGenerationRequest,
} from '../api/endpoints'
import type {
  ProductContent,
  Submission,
  GetSubmissionsRequest,
  FunnelStageCount,
  GeographyData,
  TrendPoint,
  TrafficSource,
  ProductBreakdown,
  BackOfficeUser,
  CreateUserRequest,
  UpdateUserRequest,
  OverviewMetrics,
} from '../types'

export {
  billingAccountKeys,
  billingExportKeys,
  billingLedgerKeys,
  cancelAndRemoveBillingAccount,
  cancelAndRemoveBillingExport,
  cancelAndRemoveBillingLedger,
  clearPrivateBillingQueries,
  useBillingAccount,
  useBillingLedger,
} from '../queries/billingQueries'

// ==================== QUERY KEY FACTORIES ====================

export const queryKeys = {
  all: ['backoffice'] as const,
  clients: () => ['backoffice', 'clients'] as const,
  client: (id: string) => ['backoffice', 'clients', id] as const,
  content: () => ['backoffice', 'content'] as const,
  contentItem: (id: string) => ['backoffice', 'content', id] as const,
  submissions: () => ['backoffice', 'submissions'] as const,
  submission: (id: string) => ['backoffice', 'submissions', id] as const,
  users: () => ['backoffice', 'users'] as const,
  user: (id: string) => ['backoffice', 'users', id] as const,
  analytics: () => ['backoffice', 'analytics'] as const,
  auditLogs: () => ['backoffice', 'audit'] as const,
  themes: () => ['backoffice', 'themes'] as const,
  ai: () => ['backoffice', 'ai'] as const,
  health: () => ['backoffice', 'health'] as const,
  settings: () => ['backoffice', 'settings'] as const,
}

// ==================== CLIENTS HOOKS ====================
// NOTE: API has no list/create/delete endpoints for clients. Only GET/PUT by ID.

export function useClients(_params?: { page?: number; pageSize?: number; search?: string }) {
  // Placeholder - will throw at runtime until API implements list endpoint
  return useQuery<Client[]>({
    queryKey: queryKeys.clients(),
    queryFn: async () => {
      try {
        return await getClients()
      } catch {
        return []
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: queryKeys.client(id),
    queryFn: () => clientsApi.getClient(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateClient() {
  const queryClient = useQueryClient()
  return useMutation<
    Client,
    Error,
    { id: string; data: Partial<Client> }
  >({
    mutationFn: ({ id, data }) => clientsApi.updateClient(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
      queryClient.setQueryData(queryKeys.client(data.id), data)
    },
  })
}

// ==================== CONTENT HOOKS ====================
// NOTE: API has no create/delete content endpoints. Content is per-product.

export function useContent(params?: {
  clientId?: string
}) {
  return useQuery({
    queryKey: queryKeys.content(),
    queryFn: () => contentApi.getContents(params),
    staleTime: 5 * 60 * 1000,
  })
}

export function useContentItem(id: string) {
  return useQuery<ProductContent>({
    queryKey: queryKeys.contentItem(id),
    queryFn: () => contentApi.getContent(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateContent() {
  const queryClient = useQueryClient()
  return useMutation<
    ProductContent,
    Error,
    { id: string; data: Partial<ProductContent> }
  >({
    mutationFn: ({ id, data }) => contentApi.updateContent(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content() })
      queryClient.setQueryData(queryKeys.contentItem(data.id), data)
    },
  })
}

// ==================== SUBMISSIONS HOOKS ====================
// NOTE: API has no updateSubmissionStatus or rejectSubmission endpoints.

export function useSubmissions(params?: GetSubmissionsRequest) {
  return useQuery({
    queryKey: [...queryKeys.submissions(), params],
    queryFn: () => submissionsApi.getSubmissions(params),
    staleTime: 3 * 60 * 1000,
  })
}

export function useSubmission(id: string) {
  return useQuery<Submission | null>({
    queryKey: queryKeys.submission(id),
    queryFn: () => submissionsApi.getSubmission(id),
    enabled: !!id,
    staleTime: 3 * 60 * 1000,
  })
}

export function useDeleteSubmission() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => submissionsApi.deleteSubmission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.submissions() })
    },
  })
}

// ==================== ANALYTICS HOOKS ====================

export function useOverviewMetrics(params?: { fromDate?: string; toDate?: string }) {
  return useQuery({
    queryKey: [...queryKeys.analytics(), 'overview', params?.fromDate ?? '', params?.toDate ?? ''] as const,
    queryFn: () => analyticsApi.getOverviewMetrics(params),
    staleTime: 2 * 60 * 1000,
  })
}

export function useFunnelData() {
  return useQuery<FunnelStageCount[]>({
    queryKey: [...queryKeys.analytics(), 'funnel'],
    queryFn: () => analyticsApi.getFunnelData(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useGeographyData() {
  return useQuery<GeographyData[]>({
    queryKey: [...queryKeys.analytics(), 'geography'],
    queryFn: () => analyticsApi.getGeographyData(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useTrendData() {
  return useQuery<TrendPoint[]>({
    queryKey: [...queryKeys.analytics(), 'trends'],
    queryFn: () => analyticsApi.getTrendData(),
    staleTime: 2 * 60 * 1000,
  })
}

export function useTrafficSources() {
  return useQuery<TrafficSource[]>({
    queryKey: [...queryKeys.analytics(), 'traffic-sources'],
    queryFn: () => analyticsApi.getTrafficSources(),
    staleTime: 5 * 60 * 1000,
  })
}

// NOTE: API requires productId for product breakdown. Use useProductBreakdownWithId(productId) instead.
export function useProductBreakdown(_productId?: string) {
  // This now requires a productId - kept for backward compat but will fail without it
  return useQuery<ProductBreakdown>({
    queryKey: [...queryKeys.analytics(), 'products', _productId || 'all'],
    queryFn: () => analyticsApi.getProductBreakdown(_productId || ''),
    enabled: !!_productId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useProductBreakdownWithId(productId: string) {
  return useQuery<ProductBreakdown>({
    queryKey: [...queryKeys.analytics(), 'products', productId],
    queryFn: () => analyticsApi.getProductBreakdown(productId),
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  })
}

// ==================== USERS HOOKS ====================

export function useUsers(params?: {
  page?: number
  pageSize?: number
  search?: string
  role?: string
}) {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: () => usersApi.getUsers(params),
    staleTime: 5 * 60 * 1000,
  })
}

export function useUser(id: string) {
  return useQuery<BackOfficeUser>({
    queryKey: queryKeys.user(id),
    queryFn: () => usersApi.getUser(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation<BackOfficeUser, Error, CreateUserRequest>({
    mutationFn: (data) => usersApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users() })
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation<
    BackOfficeUser,
    Error,
    { id: string; data: UpdateUserRequest }
  >({
    mutationFn: ({ id, data }) => usersApi.updateUser(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users() })
      queryClient.setQueryData(queryKeys.user(data.id), data)
    },
  })
}

// NOTE: API has no deleteUser endpoint. Use deactivateUser instead.
export function useDeactivateUser() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => usersApi.deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users() })
    },
  })
}

// ==================== AUDIT LOGS HOOKS ====================

export interface AuditLogParams {
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

export function useAuditLogs(params?: AuditLogParams) {
  return useQuery({
    queryKey: [...queryKeys.auditLogs(), params || 'all'],
    queryFn: () => auditApi.getAuditLogs(params),
    staleTime: 1 * 60 * 1000,
  })
}

export function useAuditLogDetail(id: string) {
  return useQuery({
    queryKey: [...queryKeys.auditLogs(), id],
    queryFn: () => auditApi.getAuditLogById(id),
    enabled: !!id,
    staleTime: 1 * 60 * 1000,
  })
}

// ==================== AI HOOKS ====================
// NOTE: /ai/tools and /ai/analyze/{id} endpoints do not exist in the API.

export function useAiGenerate() {
  return useMutation<
    { content: string; suggestions: string[]; metadata: Record<string, unknown> },
    Error,
    AiGenerationRequest
  >({
    mutationFn: (data) => aiApi.generateContent(data),
  })
}

export function useAiGenerateSeo() {
  return useMutation<string, Error, { content: string; language?: string }>({
    mutationFn: (data) => aiApi.generateSeo(data),
  })
}

export function useAiGenerateHeadline() {
  return useMutation<string, Error, { content: string; tone?: string }>({
    mutationFn: (data) => aiApi.generateHeadline(data),
  })
}

export function useAiGenerateImagePrompt() {
  return useMutation<string, Error, { description: string }>({
    mutationFn: (data) => aiApi.generateImagePrompt(data),
  })
}

export function useAiRewriteContent() {
  return useMutation<string, Error, { content: string; style?: string }>({
    mutationFn: (data) => aiApi.rewriteContent(data),
  })
}

// ==================== SETTINGS HOOKS ====================

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => settingsApi.getSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Record<string, unknown>>) => settingsApi.updateSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings(), data)
    },
  })
}

// ==================== THEME HOOKS ====================
// NOTE: API requires productId for theme endpoints. Use useThemeWithProduct(productId) instead.

export function useTheme(_productId?: string) {
  // This now requires a productId - kept for backward compat but will fail without it
  return useQuery({
    queryKey: queryKeys.themes(),
    queryFn: () => themeApi.getTheme(_productId || ''),
    enabled: !!_productId,
    staleTime: 30 * 60 * 1000,
  })
}

export function useThemeWithId(productId: string) {
  return useQuery({
    queryKey: [...queryKeys.themes(), productId],
    queryFn: () => themeApi.getTheme(productId),
    enabled: !!productId,
    staleTime: 30 * 60 * 1000,
  })
}

export function useUpdateTheme() {
  const queryClient = useQueryClient()
  return useMutation<
    Record<string, unknown>,
    Error,
    { productId: string; data: Record<string, unknown> }
  >({
    mutationFn: ({ productId, data }) => themeApi.updateTheme(productId, data),
    onSuccess: (data, { productId }) => {
      queryClient.setQueryData([...queryKeys.themes(), productId], data)
    },
  })
}

// ==================== DASHBOARD HOOKS ====================

interface ActivityItem {
  action?: string
  description?: string
  userName?: string
  createdAt: string
}

export function useDashboardStats() {
  return useQuery<OverviewMetrics>({
    queryKey: [...queryKeys.all, 'dashboard', 'stats'] as const,
    queryFn: () => analyticsApi.getOverviewMetrics(),
    staleTime: 2 * 60 * 1000,
  })
}

export function useDashboardActivity() {
  return useQuery<ActivityItem[]>({
    queryKey: [...queryKeys.all, 'dashboard', 'activity'] as const,
    queryFn: async () => {
      const result = await auditApi.getAuditLogs({ page: 1, pageSize: 10 })
      // Result is PaginatedResult<AuditLogEntry> - extract the data array
      if (Array.isArray(result)) return result as unknown as ActivityItem[]
      if (result && typeof result === 'object') {
        if ('data' in result) return (result as { data?: ActivityItem[] }).data || []
        if ('items' in result) return (result as { items?: ActivityItem[] }).items || []
      }
      return []
    },
    staleTime: 1 * 60 * 1000,
  })
}

// ==================== HEALTH HOOKS ====================

export function useHealthCheck() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => healthApi.checkHealth(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  })
}

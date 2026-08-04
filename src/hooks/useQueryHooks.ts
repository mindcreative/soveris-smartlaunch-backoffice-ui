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
  settingsApi,
  themeApi,
  healthApi,
  type Client,
  type AiGenerationRequest,
  type AiTool,
} from '../api/endpoints'
import type {
  ProductContent,
  Submission,
  SubmissionStatus,
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

export function useClients(params?: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: queryKeys.clients(),
    queryFn: () => clientsApi.getClients(params),
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

export function useCreateClient() {
  const queryClient = useQueryClient()
  return useMutation<Client, Error, Partial<Client>>({
    mutationFn: (data) => clientsApi.createClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
    },
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

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => clientsApi.deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
      queryClient.removeQueries({ queryKey: queryKeys.client('') })
    },
  })
}

// ==================== CONTENT HOOKS ====================

export function useContent(params?: {
  page?: number
  pageSize?: number
  search?: string
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

export function useCreateContent() {
  const queryClient = useQueryClient()
  return useMutation<ProductContent, Error, Partial<ProductContent>>({
    mutationFn: (data) => contentApi.createContent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content() })
    },
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

export function useDeleteContent() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => contentApi.deleteContent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content() })
    },
  })
}

// ==================== SUBMISSIONS HOOKS ====================

export function useSubmissions(params?: GetSubmissionsRequest) {
  return useQuery({
    queryKey: queryKeys.submissions(),
    queryFn: () => submissionsApi.getSubmissions(params),
    staleTime: 3 * 60 * 1000,
  })
}

export function useSubmission(id: string) {
  return useQuery<Submission>({
    queryKey: queryKeys.submission(id),
    queryFn: () => submissionsApi.getSubmission(id),
    enabled: !!id,
    staleTime: 3 * 60 * 1000,
  })
}

export function useUpdateSubmissionStatus() {
  const queryClient = useQueryClient()
  return useMutation<
    Submission,
    Error,
    { id: string; status: SubmissionStatus; notes?: string }
  >({
    mutationFn: ({ id, status, notes }) =>
      submissionsApi.updateSubmissionStatus(id, status, notes),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.submissions() })
      queryClient.setQueryData(queryKeys.submission(data.id), data)
    },
  })
}

export function useRejectSubmission() {
  const queryClient = useQueryClient()
  return useMutation<Submission, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => submissionsApi.rejectSubmission(id, reason),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.submissions() })
      queryClient.setQueryData(queryKeys.submission(data.id), data)
    },
  })
}

// ==================== ANALYTICS HOOKS ====================

export function useOverviewMetrics() {
  return useQuery({
    queryKey: queryKeys.analytics(),
    queryFn: () => analyticsApi.getOverviewMetrics(),
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

export function useProductBreakdown() {
  return useQuery<ProductBreakdown[]>({
    queryKey: [...queryKeys.analytics(), 'products'],
    queryFn: () => analyticsApi.getProductBreakdown(),
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

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => usersApi.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users() })
    },
  })
}

// ==================== AUDIT LOGS HOOKS ====================

export function useAuditLogs(params?: {
  page?: number
  pageSize?: number
  action?: string
  userId?: string
  entityType?: string
  startDate?: string
  endDate?: string
}) {
  return useQuery({
    queryKey: queryKeys.auditLogs(),
    queryFn: () => auditApi.getAuditLogs(params),
    staleTime: 1 * 60 * 1000,
  })
}

// ==================== AI HOOKS ====================

export function useAiTools() {
  return useQuery<AiTool[]>({
    queryKey: queryKeys.ai(),
    queryFn: () => aiApi.getAiTools(),
    staleTime: 30 * 60 * 1000,
  })
}

export function useAiGenerate() {
  return useMutation<
    { content: string; suggestions: string[]; metadata: Record<string, unknown> },
    Error,
    AiGenerationRequest
  >({
    mutationFn: (data) => aiApi.generateContent(data),
  })
}

export function useAiAnalyze() {
  return useMutation<
    {
      sentiment: string
      confidence: number
      categories: string[]
      summary: string
      recommendations: string[]
    },
    Error,
    string
  >({
    mutationFn: (submissionId) => aiApi.analyzeSubmission(submissionId),
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

export function useTheme() {
  return useQuery({
    queryKey: queryKeys.themes(),
    queryFn: () => themeApi.getTheme(),
    staleTime: 30 * 60 * 1000,
  })
}

export function useUpdateTheme() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => themeApi.updateTheme(data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.themes(), data)
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
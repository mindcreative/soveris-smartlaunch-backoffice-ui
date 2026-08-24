import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

// Normalized error shape
export interface ApiError {
  code: string
  message: string
  status?: number
}

export interface ApiErrorResponse {
  error?: string | {
    code?: string
    message: string
  }
  message?: string
  statusCode?: number
  success?: boolean
}

// Response wrapper
export interface ApiResponse<T = unknown> {
  data: T
  status: number
  message?: string
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/backoffice'

export function resolveApiOrigin(
  baseUrl: string,
  currentOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
): string {
  try {
    const parsed = new URL(baseUrl, currentOrigin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol')
    }
    return parsed.origin
  } catch {
    throw new Error('Invalid API base URL')
  }
}

const API_ORIGIN = resolveApiOrigin(API_BASE_URL)

export interface AuthRefreshLifecycleDetail {
  waitUntil: (promise: Promise<void>) => void
}

export async function notifySuccessfulAuthRefresh(): Promise<void> {
  if (typeof window === 'undefined') return
  const pending: Promise<void>[] = []
  window.dispatchEvent(new CustomEvent<AuthRefreshLifecycleDetail>('auth:refreshed', {
    detail: { waitUntil: (promise) => pending.push(promise) },
  }))
  await Promise.all(pending)
}

function isApiError(error: unknown): error is ApiError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

function decodeErrorBody(data: unknown): unknown {
  if (typeof data !== 'string') return data

  try {
    return JSON.parse(data) as unknown
  } catch {
    return data
  }
}

export class ApiClient {
  private client: AxiosInstance
  private refreshPromise: Promise<string> | null = null

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors(): void {
    // Request interceptor — attach access token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = this.getAccessToken()
        if (token) {
          config.headers.set('Authorization', `Bearer ${token}`)
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    // Response interceptor — handle 401 with token refresh
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean
        }

        // If 401 and we haven't retried yet, attempt refresh
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.shouldRetryRequest(originalRequest)
        ) {
          originalRequest._retry = true

          try {
            const newToken = await this.refreshAccessToken()
            originalRequest.headers.set('Authorization', `Bearer ${newToken}`)
            return this.client.request(originalRequest)
          } catch (refreshError) {
            // Refresh failed — clear auth and redirect
            this.clearAuthState()
            return Promise.reject(this.normalizeError(refreshError))
          }
        }

        return Promise.reject(this.normalizeError(error))
      }
    )
  }

  private shouldRetryRequest(config: InternalAxiosRequestConfig & { _retry?: boolean }): boolean {
    // Don't retry login, refresh, or health endpoints
    const nonRetryPaths = ['/auth/login', '/auth/refresh', '/health']
    return !nonRetryPaths.some((path) => config.url?.includes(path))
  }

  public normalizeError(error: unknown): ApiError {
    if (isApiError(error)) {
      return error
    }

    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: AxiosResponse<unknown> }
      const responseData = decodeErrorBody(axiosError.response?.data)
      const status = axiosError.response?.status
      const fallbackCode = status ? `HTTP_${status}` : 'API_ERROR'

      if (responseData && typeof responseData === 'object') {
        const envelope = responseData as ApiErrorResponse

        if (typeof envelope.error === 'string') {
          return {
            code: fallbackCode,
            message: envelope.error,
            status,
          }
        }

        if (envelope.error?.message) {
          return {
            code: envelope.error.code || fallbackCode,
            message: envelope.error.message,
            status,
          }
        }

        if (envelope.message) {
          return {
            code: envelope.statusCode ? `HTTP_${envelope.statusCode}` : fallbackCode,
            message: envelope.message,
            status,
          }
        }
      }

      if (typeof responseData === 'string' && responseData.trim()) {
        return {
          code: fallbackCode,
          message: responseData,
          status,
        }
      }

      return {
        code: fallbackCode,
        message: status ? `Request failed with status ${status}` : 'API request failed',
        status,
      }
    }

    if (error && typeof error === 'object' && 'message' in error) {
      return {
        code: 'NETWORK_ERROR',
        message: (error as { message: string }).message,
      }
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred',
    }
  }

  // Token management (abstracted for testability)
  private getAccessToken(): string | null {
    try {
      const stored = localStorage.getItem('backoffice_access_token')
      return stored || null
    } catch {
      return null
    }
  }

  private getRefreshToken(): string | null {
    try {
      const stored = localStorage.getItem('backoffice_refresh_token')
      return stored || null
    } catch {
      return null
    }
  }

  private setTokens(access: string, refresh: string): void {
    try {
      localStorage.setItem('backoffice_access_token', access)
      localStorage.setItem('backoffice_refresh_token', refresh)
    } catch {
      // localStorage unavailable — silently fail
    }
  }

  public clearAuthState(): void {
    try {
      localStorage.removeItem('backoffice_access_token')
      localStorage.removeItem('backoffice_refresh_token')
    } catch {
      // noop
    }
    // Dispatch event so stores can react
    window.dispatchEvent(new CustomEvent('auth:cleared'))
  }

  // Token refresh with deduplication
  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = (async () => {
      const refreshToken = this.getRefreshToken()
      if (!refreshToken) {
        throw { code: 'NO_REFRESH_TOKEN', message: 'No refresh token available' } satisfies ApiError
      }

      const response = await this.client.post('/auth/refresh', {
        refreshToken,
      })

      const { accessToken, refreshToken: newRefreshToken } = response.data

      this.setTokens(accessToken, newRefreshToken || refreshToken)
      await notifySuccessfulAuthRefresh()

      return accessToken
    })()

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  // Request helpers
  private request<T>(config: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.client
      .request(config)
      .then((res) => ({
        data: res.data as T,
        status: res.status,
        message: res.data?.message,
      }))
      .catch((err) => {
        throw this.normalizeError(err)
      })
  }

  get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url })
  }

  getApiRoot<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, baseURL: API_ORIGIN, method: 'GET', url })
  }

  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data })
  }

  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data })
  }

  patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data })
  }

  delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url })
  }
}

// Singleton instance
export const apiClient = new ApiClient()
export default apiClient

export type SubmissionStatus = 'pending' | 'verified' | 'invalid'

export interface Submission {
  id: string
  email: string
  name?: string
  product?: string
  formData?: Record<string, unknown>
  status: SubmissionStatus
  createdAt: string
  updatedAt?: string
  clientId?: string
  isVerified?: boolean
}

export interface GetSubmissionsRequest {
  page?: number
  pageSize?: number
  productId?: string
  status?: SubmissionStatus
  startDate?: string
  endDate?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

export type ExportFormat = 'csv' | 'json' | 'xlsx'
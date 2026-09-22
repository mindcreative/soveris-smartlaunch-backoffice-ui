import type { LocalInstantValue } from '../timezone/LocalInstant'

export type SubmissionStatus = 'pending' | 'verified' | 'invalid'

export interface SubmissionSummary {
  id: string
  email: string
  productName?: string
  isVerified?: boolean
  createdAt: LocalInstantValue
  updatedAt?: LocalInstantValue | null
}

export interface Submission {
  id: string
  email: string
  name?: string
  product?: string
  productName?: string
  formData?: Record<string, unknown>
  status: SubmissionStatus
  createdAt: LocalInstantValue
  updatedAt?: LocalInstantValue | null
  expiresAt?: LocalInstantValue | null
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

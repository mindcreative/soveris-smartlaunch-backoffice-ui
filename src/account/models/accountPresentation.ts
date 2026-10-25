import type { ReactNode } from 'react'
import type { ApiError } from '../../api/apiClient'
import type { AccountOperation } from './accountLifecycle'

export interface AccountLayoutProps {
  title: string
  description?: string
  children: ReactNode
}

export interface PasswordFieldProps {
  label?: string
  value: string
  onChange: (value: string) => void
  newPassword?: boolean
  error?: string | null
  errorSummaryId?: string
}

export interface AccountAction {
  pending: boolean
  error: ApiError | null
  retryAt: number
  run: (action: (operation: AccountOperation) => Promise<void>, onFailure?: (error: ApiError) => void) => Promise<void>
}

export interface AccountFeedbackProps {
  error: ApiError | null
  pending: boolean
}

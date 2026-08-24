import { useEffect, useRef, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { billingApi, BillingContractError } from '../api/billingApi'
import type { ApiError } from '../api/apiClient'
import type { BillingAccountSnapshot } from '../types/billing'

const privateRoot = ['backoffice', 'private'] as const

export const billingAccountKeys = {
  allPrivate: privateRoot,
  billing: [...privateRoot, 'billing'] as const,
  account: (clientId: string) => [...privateRoot, 'billing', 'account', clientId] as const,
}

export async function clearPrivateBillingQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: billingAccountKeys.billing })
  queryClient.removeQueries({ queryKey: billingAccountKeys.billing })
}

export async function cancelAndRemoveBillingAccount(
  queryClient: QueryClient,
  clientId: string
): Promise<void> {
  const queryKey = billingAccountKeys.account(clientId)
  await queryClient.cancelQueries({ queryKey, exact: true })
  queryClient.removeQueries({ queryKey, exact: true })
}

function isDurablePermissionError(error: unknown): error is ApiError {
  const status = getErrorStatus(error)
  return status === 401 || status === 403
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

export function useBillingAccount(clientId: string | null) {
  const queryClient = useQueryClient()
  const previousClientId = useRef<string | null>(null)
  const [durableError, setDurableError] = useState<Error | ApiError | null>(null)

  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId
    setDurableError(null)

    if (previous && previous !== clientId) {
      void cancelAndRemoveBillingAccount(queryClient, previous)
    }
  }, [clientId, queryClient])

  const query = useQuery<BillingAccountSnapshot, Error | ApiError>({
    queryKey: billingAccountKeys.account(clientId ?? 'invalid-client'),
    queryFn: ({ signal }) => {
      if (!clientId) throw new Error('A valid Client is required')
      return billingApi.getAccountSnapshot(clientId, signal)
    },
    enabled: Boolean(clientId),
    retry: (failureCount, error) => {
      if (error instanceof BillingContractError) return false
      const status = getErrorStatus(error)
      if (status && status >= 400 && status < 500 && status !== 429) return false
      return failureCount < 1
    },
    retryDelay: 250,
  })

  useEffect(() => {
    if (query.error instanceof BillingContractError && clientId) {
      setDurableError(query.error)
      void cancelAndRemoveBillingAccount(queryClient, clientId)
      return
    }

    if (isDurablePermissionError(query.error)) {
      setDurableError(query.error)
      void clearPrivateBillingQueries(queryClient)
      if (query.error.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:cleared'))
      }
      return
    }

    if (getErrorStatus(query.error) === 404 && clientId) {
      setDurableError(query.error)
      void cancelAndRemoveBillingAccount(queryClient, clientId)
    }
  }, [clientId, query.error, queryClient])

  return {
    ...query,
    error: durableError ?? query.error,
    isError: Boolean(durableError) || query.isError,
  }
}

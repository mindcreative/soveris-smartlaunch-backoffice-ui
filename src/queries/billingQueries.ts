import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  billingApi,
  BillingContractError,
  BillingLedgerContractError,
} from '../api/billingApi'
import type { ApiError } from '../api/apiClient'
import type {
  BillingAccountSnapshot,
  BillingLedgerFilters,
  BillingLedgerPage,
} from '../types/billing'

const privateRoot = ['backoffice', 'private'] as const

export const billingAccountKeys = {
  allPrivate: privateRoot,
  billing: [...privateRoot, 'billing'] as const,
  account: (clientId: string) => [...privateRoot, 'billing', 'account', clientId] as const,
}

export const billingLedgerKeys = {
  all: [...privateRoot, 'billing', 'ledger'] as const,
  client: (clientId: string) => [...privateRoot, 'billing', 'ledger', clientId] as const,
  traversal: (clientId: string, filters: BillingLedgerFilters, traversalId: number) =>
    [...privateRoot, 'billing', 'ledger', clientId, filters, traversalId] as const,
}

export const billingExportKeys = {
  all: [...privateRoot, 'billing', 'exports'] as const,
  client: (clientId: string) => [...privateRoot, 'billing', 'exports', clientId] as const,
  detail: (clientId: string, exportId: string) =>
    [...privateRoot, 'billing', 'exports', clientId, exportId] as const,
  request: (clientId: string) =>
    [...privateRoot, 'billing', 'exports', clientId, 'request'] as const,
}

function startsWithKey(value: readonly unknown[] | undefined, prefix: readonly unknown[]): boolean {
  return Boolean(value && prefix.every((part, index) => value[index] === part))
}

export async function clearPrivateBillingQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: billingAccountKeys.billing })
  queryClient.removeQueries({ queryKey: billingAccountKeys.billing })
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (startsWithKey(mutation.options.mutationKey, billingAccountKeys.billing)) {
      queryClient.getMutationCache().remove(mutation)
    }
  }
}

export async function cancelAndRemoveBillingExport(
  queryClient: QueryClient,
  clientId: string,
  exportId?: string,
  removeCommand = true
): Promise<void> {
  const queryKey = exportId
    ? billingExportKeys.detail(clientId, exportId)
    : billingExportKeys.client(clientId)
  await queryClient.cancelQueries({ queryKey, exact: Boolean(exportId) })
  queryClient.removeQueries({ queryKey, exact: Boolean(exportId) })
  if (removeCommand) {
    for (const mutation of queryClient.getMutationCache().getAll()) {
      if (startsWithKey(mutation.options.mutationKey, billingExportKeys.request(clientId).slice(0, -1))) {
        queryClient.getMutationCache().remove(mutation)
      }
    }
  }
}

export async function cancelAndRemoveBillingAccount(
  queryClient: QueryClient,
  clientId: string
): Promise<void> {
  const queryKey = billingAccountKeys.account(clientId)
  await queryClient.cancelQueries({ queryKey, exact: true })
  queryClient.removeQueries({ queryKey, exact: true })
}

export async function cancelAndRemoveBillingLedger(
  queryClient: QueryClient,
  queryKey: QueryKey = billingLedgerKeys.all
): Promise<void> {
  const exact = typeof queryKey[queryKey.length - 1] === 'number'
  await queryClient.cancelQueries({ queryKey, exact })
  queryClient.removeQueries({ queryKey, exact })
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

function validateContinuation(
  existing: InfiniteData<BillingLedgerPage, string | null> | undefined,
  page: BillingLedgerPage
): void {
  const first = existing?.pages[0]
  if (!first || page.asOf !== first.asOf) {
    throw new BillingLedgerContractError('continuation does not match the active snapshot')
  }
  const ids = new Set(existing.pages.flatMap((existingPage) =>
    existingPage.items.map((item) => item.ledgerId)))
  if (page.items.some((item) => ids.has(item.ledgerId))) {
    throw new BillingLedgerContractError('continuation contains a duplicate ledger row')
  }
  const lastPage = existing.pages[existing.pages.length - 1]
  const previous = lastPage?.items[lastPage.items.length - 1]
  const next = page.items[0]
  if (previous && next) {
    const timeOrder = Date.parse(previous.createdAt) - Date.parse(next.createdAt)
    if (timeOrder < 0 || (timeOrder === 0 && previous.ledgerId.localeCompare(next.ledgerId) < 0)) {
      throw new BillingLedgerContractError('continuation is not in server order')
    }
  }
}

export function useBillingLedger(
  clientId: string | null,
  filters: BillingLedgerFilters,
  traversalId: number
) {
  const queryClient = useQueryClient()
  const filterIdentity = JSON.stringify(filters)
  const traversalIdentity = `${clientId ?? 'invalid-client'}:${filterIdentity}:${traversalId}`
  const stableFilters = useMemo(() => filters, [filterIdentity])
  const queryKey = useMemo(
    () => billingLedgerKeys.traversal(clientId ?? 'invalid-client', stableFilters, traversalId),
    [clientId, stableFilters, traversalId]
  )
  const previousKey = useRef<QueryKey | null>(null)
  const loadingNext = useRef(false)
  const durableErrorRef = useRef<Error | ApiError | null>(null)
  const [durableError, setDurableError] = useState<Error | ApiError | null>(null)

  useEffect(() => {
    const previous = previousKey.current
    previousKey.current = queryKey
    setDurableError(null)
    durableErrorRef.current = null
    loadingNext.current = false
    if (previous && JSON.stringify(previous) !== JSON.stringify(queryKey)) {
      void cancelAndRemoveBillingLedger(queryClient, previous)
    }
  }, [queryClient, traversalIdentity])

  const query = useInfiniteQuery<
    BillingLedgerPage,
    Error | ApiError,
    InfiniteData<BillingLedgerPage, string | null>,
    typeof queryKey,
    string | null
  >({
    queryKey,
    initialPageParam: null,
    enabled: Boolean(clientId) && !durableError,
    queryFn: async ({ pageParam, signal }) => {
      if (!clientId) throw new Error('A valid Client is required')
      if (durableErrorRef.current) throw durableErrorRef.current
      try {
        const page = await billingApi.getLedgerPage(
          clientId,
          pageParam === null ? { filters: stableFilters } : { cursor: pageParam },
          signal
        )
        if (pageParam !== null) {
          const existing = queryClient.getQueryData<InfiniteData<BillingLedgerPage, string | null>>(queryKey)
          validateContinuation(existing, page)
        }
        return page
      } catch (error) {
        if (error instanceof BillingLedgerContractError || isDurablePermissionError(error)) {
          durableErrorRef.current = error
        }
        throw error
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: (failureCount, error) => {
      if (error instanceof BillingLedgerContractError) return false
      const status = getErrorStatus(error)
      if (status && status >= 400 && status < 500 && status !== 429) return false
      return failureCount < 1
    },
    retryDelay: 250,
  })

  useEffect(() => {
    if (query.error instanceof BillingLedgerContractError) {
      setDurableError(query.error)
      return
    }
    if (isDurablePermissionError(query.error)) {
      setDurableError(query.error)
      if (query.error.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
    }
  }, [query.error])

  useEffect(() => {
    if (durableError instanceof BillingLedgerContractError) {
      void cancelAndRemoveBillingLedger(queryClient, queryKey)
    } else if (isDurablePermissionError(durableError)) {
      void clearPrivateBillingQueries(queryClient)
    }
  }, [durableError, queryClient, queryKey])

  const loadMore = async (): Promise<void> => {
    if (loadingNext.current || !query.hasNextPage) return
    loadingNext.current = true
    try {
      await query.fetchNextPage()
    } finally {
      loadingNext.current = false
    }
  }

  const effectiveError = durableError ?? query.error
  const suppressPrivateRows = effectiveError instanceof BillingLedgerContractError ||
    isDurablePermissionError(effectiveError)

  return {
    ...query,
    data: query.data,
    error: effectiveError,
    isError: Boolean(durableError) || query.isError,
    items: suppressPrivateRows ? [] : query.data?.pages.flatMap((page) => page.items) ?? [],
    asOf: suppressPrivateRows ? undefined : query.data?.pages[0]?.asOf,
    loadMore,
  }
}

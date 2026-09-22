import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  billingApi,
  BillingContractError,
  ClientCapabilitiesContractError,
  BillingLedgerContractError,
  BillingSubscriptionContractError,
} from '../api/billingApi'
import { legacyBillingApi } from '../api/legacySubscriptionApi'
import type { ApiError } from '../api/apiClient'
import { productKeys } from './productQueries'
import { localInstantDateTime } from '../timezone/LocalInstant'
import type {
  BillingAccountSnapshot,
  BillingLedgerFilters,
  BillingLedgerPage,
  BillingSubscriptionCreationReceipt,
  BillingSubscriptionLifecycleReceipt,
  BillingSubscriptionLifecycleRequest,
  BillingSubscriptionState,
  BillingSubscriptionTierAction,
  BillingSubscriptionTierChangeRequest,
  BillingSubscriptionTierChangeResponse,
  ClientCapabilities,
  CreateBillingSubscriptionRequest,
  ResourceAccessConsequence,
  ResourceAccessPreview,
  ResourceAccessPreviewRequest,
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

export const billingSubscriptionKeys = {
  all: [...privateRoot, 'billing', 'subscriptions'] as const,
  client: (clientId: string) => [...privateRoot, 'billing', 'subscriptions', clientId] as const,
  state: (clientId: string) => [...privateRoot, 'billing', 'subscriptions', clientId, 'state'] as const,
  create: (clientId: string) => [...privateRoot, 'billing', 'subscriptions', clientId, 'create'] as const,
  lifecycle: (clientId: string, subscriptionId: string) =>
    [...privateRoot, 'billing', 'subscriptions', clientId, subscriptionId, 'lifecycle'] as const,
  tierChange: (clientId: string, subscriptionId: string, action: BillingSubscriptionTierAction) =>
    [...privateRoot, 'billing', 'subscriptions', clientId, subscriptionId, 'tier-change', action] as const,
}

export const clientCapabilityKeys = {
  all: [...privateRoot, 'capabilities'] as const,
  client: (clientId: string) => [...privateRoot, 'capabilities', clientId] as const,
}

export const resourceAccessKeys = {
  all: [...privateRoot, 'billing', 'resource-access'] as const,
  client: (clientId: string) => [...privateRoot, 'billing', 'resource-access', clientId] as const,
  consequences: (clientId: string) =>
    [...privateRoot, 'billing', 'resource-access', clientId, 'consequences'] as const,
  preview: (clientId: string, subscriptionId: string) =>
    [...privateRoot, 'billing', 'resource-access', clientId, subscriptionId, 'preview'] as const,
}

export const domainPrivateRoot = [...privateRoot, 'domains'] as const
export const domainClientPrefix = (clientId: string) =>
  [...domainPrivateRoot, clientId] as const

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

export async function clearPrivateClientScope(
  queryClient: QueryClient,
  clientId?: string
): Promise<void> {
  const roots = clientId
    ? [
        billingSubscriptionKeys.client(clientId), billingAccountKeys.account(clientId),
        clientCapabilityKeys.client(clientId), resourceAccessKeys.client(clientId),
        productKeys.client(clientId), domainClientPrefix(clientId),
      ]
    : [
        billingAccountKeys.billing, clientCapabilityKeys.all, resourceAccessKeys.all,
        productKeys.all, domainPrivateRoot,
      ]
  const cancellations = roots.map((queryKey) => queryClient.cancelQueries({ queryKey }))
  roots.forEach((queryKey) => queryClient.removeQueries({ queryKey }))
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (roots.some((root) => startsWithKey(mutation.options.mutationKey, root))) {
      queryClient.getMutationCache().remove(mutation)
    }
  }
  await Promise.all(cancellations)
}

export async function invalidateTierChangeScopes(
  queryClient: QueryClient,
  clientId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: billingSubscriptionKeys.client(clientId) }),
    queryClient.invalidateQueries({ queryKey: clientCapabilityKeys.client(clientId) }),
    queryClient.invalidateQueries({ queryKey: resourceAccessKeys.consequences(clientId) }),
    queryClient.invalidateQueries({ queryKey: productKeys.client(clientId) }),
    queryClient.invalidateQueries({ queryKey: domainClientPrefix(clientId) }),
  ])
  queryClient.removeQueries({
    predicate: (query) => startsWithKey(query.queryKey, resourceAccessKeys.client(clientId)) &&
      query.queryKey[query.queryKey.length - 1] === 'preview',
  })
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

export async function cancelAndRemoveBillingSubscriptions(
  queryClient: QueryClient,
  clientId: string
): Promise<void> {
  const queryKey = billingSubscriptionKeys.client(clientId)
  await queryClient.cancelQueries({ queryKey })
  queryClient.removeQueries({ queryKey })
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (startsWithKey(mutation.options.mutationKey, queryKey)) {
      queryClient.getMutationCache().remove(mutation)
    }
  }
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
  const mountGenerationRef = useRef(0)
  const [durableError, setDurableError] = useState<Error | ApiError | null>(null)

  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId
    setDurableError(null)

    if (previous && previous !== clientId) {
      void cancelAndRemoveBillingAccount(queryClient, previous)
    }
  }, [clientId, queryClient])

  useEffect(() => {
    const generation = ++mountGenerationRef.current
    return () => {
      queueMicrotask(() => {
        if (mountGenerationRef.current === generation && clientId) {
          void cancelAndRemoveBillingAccount(queryClient, clientId)
        }
      })
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

export function useBillingSubscriptions(clientId: string | null) {
  const queryClient = useQueryClient()
  const previousClientId = useRef<string | null>(null)
  const mountGenerationRef = useRef(0)
  const [durableError, setDurableError] = useState<Error | ApiError | null>(null)
  const [continuationPages, setContinuationPages] = useState<BillingSubscriptionState[]>([])
  const [continuationError, setContinuationError] = useState<Error | ApiError | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const continuationPagesRef = useRef<BillingSubscriptionState[]>([])
  const continuationAbortRef = useRef<AbortController | null>(null)
  const loadingMoreRef = useRef(false)
  const continuationEpochRef = useRef(0)

  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId
    setDurableError(null)
    continuationAbortRef.current?.abort()
    continuationPagesRef.current = []
    setContinuationPages([])
    setContinuationError(null)
    setIsLoadingMore(false)
    loadingMoreRef.current = false
    if (previous && previous !== clientId) {
      void cancelAndRemoveBillingSubscriptions(queryClient, previous)
    }
  }, [clientId, queryClient])

  useEffect(() => {
    const generation = ++mountGenerationRef.current
    return () => {
      queueMicrotask(() => {
        if (mountGenerationRef.current === generation && clientId) {
          void cancelAndRemoveBillingSubscriptions(queryClient, clientId)
        }
      })
    }
  }, [clientId, queryClient])

  const query = useQuery<BillingSubscriptionState, Error | ApiError>({
    queryKey: billingSubscriptionKeys.state(clientId ?? 'invalid-client'),
    queryFn: ({ signal }) => {
      if (!clientId) throw new Error('A valid Client is required')
      return billingApi.getSubscriptionState(clientId, { pageSize: 20 }, signal)
    },
    enabled: Boolean(clientId),
    retry: (failureCount, error) => {
      if (error instanceof BillingSubscriptionContractError) return false
      const status = getErrorStatus(error)
      if (status && status >= 400 && status < 500 && status !== 429) return false
      return failureCount < 1
    },
    retryDelay: 250,
  })

  useEffect(() => {
    if (query.error instanceof BillingSubscriptionContractError && clientId) {
      setDurableError(query.error)
      void cancelAndRemoveBillingSubscriptions(queryClient, clientId)
      return
    }
    if (getErrorStatus(query.error) === 404 && clientId) {
      setDurableError(query.error)
      void clearPrivateClientScope(queryClient, clientId)
      return
    }
    if (isDurablePermissionError(query.error)) {
      setDurableError(query.error)
      void clearPrivateBillingQueries(queryClient)
      if (query.error.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
    }
  }, [clientId, query.error, queryClient])

  useEffect(() => {
    continuationEpochRef.current += 1
    continuationAbortRef.current?.abort()
    continuationPagesRef.current = []
    setContinuationPages([])
    setContinuationError(null)
    setIsLoadingMore(false)
    loadingMoreRef.current = false
  }, [query.dataUpdatedAt])

  useEffect(() => {
    const clearContinuations = () => {
      continuationAbortRef.current?.abort()
      continuationPagesRef.current = []
      setContinuationPages([])
      setContinuationError(null)
      setIsLoadingMore(false)
      loadingMoreRef.current = false
    }
    window.addEventListener('auth:cleared', clearContinuations)
    window.addEventListener('auth:refreshed', clearContinuations)
    return () => {
      window.removeEventListener('auth:cleared', clearContinuations)
      window.removeEventListener('auth:refreshed', clearContinuations)
      continuationAbortRef.current?.abort()
    }
  }, [])

  const mergedData = useMemo(() => {
    if (!query.data || continuationPages.length === 0) return query.data
    const last = continuationPages[continuationPages.length - 1]!
    return {
      ...query.data,
      grantHistory: {
        ...query.data.grantHistory,
        items: [
          ...query.data.grantHistory.items,
          ...continuationPages.flatMap((page) => page.grantHistory.items),
        ],
        nextCursor: last.grantHistory.nextCursor,
      },
    }
  }, [continuationPages, query.data])

  const loadMore = useCallback(async () => {
    const first = query.data
    const pages = continuationPagesRef.current
    const prior = pages[pages.length - 1] ?? first
    const cursor = prior?.grantHistory.nextCursor
    if (!clientId || !first || !cursor || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setIsLoadingMore(true)
    setContinuationError(null)
    const controller = new AbortController()
    const epoch = continuationEpochRef.current
    continuationAbortRef.current = controller
    try {
      const page = await billingApi.getSubscriptionState(clientId, { cursor }, controller.signal)
      if (controller.signal.aborted || epoch !== continuationEpochRef.current) return
      if (page.clientId !== clientId || page.grantHistory.historyAsOf !== first.grantHistory.historyAsOf) {
        throw new BillingSubscriptionContractError('grant continuation does not match the active Client snapshot')
      }
      if (page.grantHistory.nextCursor === cursor) {
        throw new BillingSubscriptionContractError('grant continuation cursor did not advance')
      }
      const existingItems = [first, ...pages].flatMap((value) => value.grantHistory.items)
      const identities = new Set(existingItems.flatMap((item) => [
        `grant:${item.grantId}`,
        `operation:${item.grantOperationId}`,
        `ledger:${item.ledgerEntryId}`,
      ]))
      if (page.grantHistory.items.some((item) => [
        `grant:${item.grantId}`,
        `operation:${item.grantOperationId}`,
        `ledger:${item.ledgerEntryId}`,
      ].some((identity) => identities.has(identity)))) {
        throw new BillingSubscriptionContractError('grant continuation contains a duplicate grant identity')
      }
      const previous = existingItems[existingItems.length - 1]
      const next = page.grantHistory.items[0]
      if (previous && next) {
        const timeOrder = Date.parse(previous.cycleStart) - Date.parse(next.cycleStart)
        if (timeOrder < 0 || (timeOrder === 0 && previous.grantId.localeCompare(next.grantId) < 0)) {
          throw new BillingSubscriptionContractError('grant continuation is not in server order')
        }
      }
      const updated = [...pages, page]
      continuationPagesRef.current = updated
      setContinuationPages(updated)
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return
      const nextError = error instanceof Error || (error && typeof error === 'object')
        ? error as Error | ApiError
        : new Error('Grant history continuation failed')
      setContinuationError(nextError)
      if (isDurablePermissionError(nextError)) {
        await clearPrivateBillingQueries(queryClient)
        if (nextError.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
      }
      throw nextError
    } finally {
      if (continuationAbortRef.current === controller) continuationAbortRef.current = null
      loadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [clientId, query.data, queryClient])

  return {
    ...query,
    data: mergedData,
    error: durableError ?? query.error,
    isError: Boolean(durableError) || query.isError,
    hasNextPage: Boolean(mergedData?.grantHistory.nextCursor),
    loadMore,
    isLoadingMore,
    continuationError,
  }
}

export function useClientCapabilities(clientId: string | null) {
  const queryClient = useQueryClient()
  const previousClientId = useRef<string | null>(null)
  const generationRef = useRef(0)
  const renderedClientIdRef = useRef(clientId)

  if (renderedClientIdRef.current !== clientId) {
    renderedClientIdRef.current = clientId
    generationRef.current += 1
  }

  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId
    if (previous && previous !== clientId) void clearPrivateClientScope(queryClient, previous)
  }, [clientId, queryClient])

  const query = useQuery<ClientCapabilities, Error | ApiError>({
    queryKey: clientCapabilityKeys.client(clientId ?? 'invalid-client'),
    enabled: Boolean(clientId),
    queryFn: async ({ signal }) => {
      if (!clientId) throw new Error('A valid Client is required')
      const generation = generationRef.current
      const result = await billingApi.getClientCapabilities(clientId, signal)
      if (generation !== generationRef.current || result.clientId !== clientId) {
        throw new ClientCapabilitiesContractError('late or cross-Client response was fenced')
      }
      return result
    },
    retry: (failureCount, error) => {
      if (error instanceof ClientCapabilitiesContractError) return false
      const status = getErrorStatus(error)
      if (status && status >= 400 && status < 500 && status !== 429) return false
      return failureCount < 1
    },
    retryDelay: 250,
  })

  useEffect(() => {
    if (!clientId) return
    if (query.error instanceof ClientCapabilitiesContractError) {
      void clearPrivateClientScope(queryClient, clientId)
      return
    }
    if (getErrorStatus(query.error) === 404) {
      void clearPrivateClientScope(queryClient, clientId)
      return
    }
    if (isDurablePermissionError(query.error)) {
      void clearPrivateClientScope(queryClient, clientId)
      if (query.error.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
    }
  }, [clientId, query.error, queryClient])

  return query
}

export function useResourceAccessConsequences(clientId: string | null) {
  const queryClient = useQueryClient()
  const previousClientId = useRef<string | null>(null)
  const generationRef = useRef(0)
  const renderedClientIdRef = useRef(clientId)

  if (renderedClientIdRef.current !== clientId) {
    renderedClientIdRef.current = clientId
    generationRef.current += 1
  }

  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId
    if (previous && previous !== clientId) void clearPrivateClientScope(queryClient, previous)
  }, [clientId, queryClient])

  const query = useQuery<ResourceAccessConsequence[], Error | ApiError>({
    queryKey: resourceAccessKeys.consequences(clientId ?? 'invalid-client'),
    enabled: Boolean(clientId),
    queryFn: async ({ signal }) => {
      if (!clientId) throw new Error('A valid Client is required')
      const generation = generationRef.current
      const result = await billingApi.getResourceAccessConsequences(clientId, signal)
      if (generation !== generationRef.current) {
        throw new BillingSubscriptionContractError('late consequence response was fenced')
      }
      return result
    },
    retry: (failureCount, error) => {
      if (error instanceof BillingSubscriptionContractError) return false
      const status = getErrorStatus(error)
      if (status && status >= 400 && status < 500 && status !== 429) return false
      return failureCount < 1
    },
    retryDelay: 250,
  })

  useEffect(() => {
    if (!clientId) return
    if (query.error instanceof BillingSubscriptionContractError) {
      void clearPrivateClientScope(queryClient, clientId)
      return
    }
    if (getErrorStatus(query.error) === 404) {
      void clearPrivateClientScope(queryClient, clientId)
      return
    }
    if (isDurablePermissionError(query.error)) {
      void clearPrivateClientScope(queryClient, clientId)
      if (query.error.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
    }
  }, [clientId, query.error, queryClient])

  return query
}

export function useResourceAccessPreviewMutation(
  clientId: string,
  subscriptionId: string
) {
  return useMutation<
    ResourceAccessPreview,
    Error | ApiError,
    { request: ResourceAccessPreviewRequest; signal?: AbortSignal }
  >({
    mutationKey: resourceAccessKeys.preview(clientId, subscriptionId),
    mutationFn: ({ request, signal }) =>
      billingApi.getResourceAccessPreview(clientId, subscriptionId, request, signal),
    retry: false,
  })
}

export function useBillingSubscriptionTierChangeMutation(
  clientId: string,
  subscriptionId: string,
  action: BillingSubscriptionTierAction
) {
  return useMutation<
    BillingSubscriptionTierChangeResponse,
    Error | ApiError,
    {
      request: BillingSubscriptionTierChangeRequest
      serializedBody: string
      signal?: AbortSignal
      onAuthReplay?: () => void
    }
  >({
    mutationKey: billingSubscriptionKeys.tierChange(clientId, subscriptionId, action),
    mutationFn: ({ request, serializedBody, signal, onAuthReplay }) =>
      billingApi.postSubscriptionTierChange(
        clientId, subscriptionId, action, request, signal, serializedBody, onAuthReplay
      ),
    retry: false,
  })
}

export function useCreateBillingSubscription(clientId: string) {
  return useMutation<
    BillingSubscriptionCreationReceipt,
    Error | ApiError,
    { request: CreateBillingSubscriptionRequest; serializedBody: string; signal?: AbortSignal }
  >({
    mutationKey: billingSubscriptionKeys.create(clientId),
    mutationFn: ({ request, serializedBody, signal }) =>
      legacyBillingApi.createSubscription(clientId, request, signal, serializedBody),
    retry: false,
  })
}

export function useBillingSubscriptionLifecycleMutation(
  clientId: string
) {
  return useMutation<
    BillingSubscriptionLifecycleReceipt,
    Error | ApiError,
    {
      request: BillingSubscriptionLifecycleRequest
      subscriptionId: string
      serializedBody: string
      validTo: string | null
      signal?: AbortSignal
      onAuthReplay?: () => void
    }
  >({
    mutationKey: [...billingSubscriptionKeys.client(clientId), 'lifecycle'] as const,
    mutationFn: ({ request, subscriptionId, serializedBody, validTo, signal, onAuthReplay }) =>
      billingApi.postSubscriptionLifecycle(
        clientId, subscriptionId, request, signal, serializedBody, validTo, onAuthReplay
      ),
    retry: false,
  })
}

function validateContinuation(
  existing: InfiniteData<BillingLedgerPage, string | null> | undefined,
  page: BillingLedgerPage
): void {
  const first = existing?.pages[0]
  if (!first || JSON.stringify(page.asOf) !== JSON.stringify(first.asOf)) {
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
    const timeOrder = Date.parse(localInstantDateTime(previous.createdAt)) -
      Date.parse(localInstantDateTime(next.createdAt))
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

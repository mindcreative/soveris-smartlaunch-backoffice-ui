import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { contentApi } from '../api/endpoints'
import type {
  CreateProductRequest,
  ProductFilters,
  PublishProductContentRequest,
  SaveProductContentDraftRequest,
  UpdateProductRequest,
  ValidateProductContentRequest,
} from '../types/content'

const privateProductsRoot = ['backoffice', 'private', 'products'] as const

export const productKeys = {
  all: privateProductsRoot,
  client: (clientId: string) => [...privateProductsRoot, clientId] as const,
  listRoot: (clientId: string) => [...privateProductsRoot, clientId, 'list'] as const,
  list: (clientId: string, filters: ProductFilters) =>
    [...privateProductsRoot, clientId, 'list', filters] as const,
  detail: (clientId: string, productId: string) =>
    [...privateProductsRoot, clientId, 'detail', productId] as const,
  content: (clientId: string, productId: string) =>
    [...privateProductsRoot, clientId, 'content', productId] as const,
  command: (clientId: string, productId: string, command: string) =>
    [...privateProductsRoot, clientId, 'command', productId, command] as const,
}

function startsWithKey(value: readonly unknown[] | undefined, prefix: readonly unknown[]): boolean {
  return Boolean(value && prefix.every((part, index) => value[index] === part))
}

export async function clearPrivateProductQueries(
  queryClient: QueryClient,
  clientId?: string,
): Promise<void> {
  const queryKey = clientId ? productKeys.client(clientId) : productKeys.all
  await queryClient.cancelQueries({ queryKey })
  queryClient.removeQueries({ queryKey })
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (startsWithKey(mutation.options.mutationKey, queryKey)) {
      queryClient.getMutationCache().remove(mutation)
    }
  }
}

async function invalidateProductScope(
  queryClient: QueryClient,
  clientId: string,
  productId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: productKeys.listRoot(clientId) }),
    queryClient.invalidateQueries({ queryKey: productKeys.detail(clientId, productId) }),
    queryClient.invalidateQueries({ queryKey: productKeys.content(clientId, productId) }),
  ])
}

export function useProducts(clientId: string, filters: ProductFilters) {
  const queryClient = useQueryClient()
  const previousClientId = useRef<string | null>(null)
  const teardownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const previous = previousClientId.current
    previousClientId.current = clientId || null
    if (previous && previous !== clientId) void clearPrivateProductQueries(queryClient, previous)
  }, [clientId, queryClient])
  useEffect(() => {
    if (teardownTimer.current) clearTimeout(teardownTimer.current)
    return () => {
      if (!clientId) return
      // Defer teardown by one task so React StrictMode's development-only
      // effect replay can cancel it, while real route unmounts still purge.
      teardownTimer.current = setTimeout(() => {
        void clearPrivateProductQueries(queryClient, clientId)
      }, 0)
    }
  }, [clientId, queryClient])
  return useQuery({
    queryKey: productKeys.list(clientId || 'invalid-client', filters),
    queryFn: ({ signal }) => contentApi.getProducts(clientId, filters, signal),
    enabled: Boolean(clientId),
  })
}

export function useProduct(clientId: string, productId: string) {
  return useQuery({
    queryKey: productKeys.detail(clientId || 'invalid-client', productId || 'invalid-product'),
    queryFn: ({ signal }) => contentApi.getProduct(productId, signal),
    enabled: Boolean(clientId && productId),
  })
}

export function useProductContent(clientId: string, productId: string) {
  return useQuery({
    queryKey: productKeys.content(clientId || 'invalid-client', productId || 'invalid-product'),
    queryFn: ({ signal }) => contentApi.getContent(productId, signal),
    enabled: Boolean(clientId && productId),
  })
}

export function useCreateProduct(clientId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: productKeys.command(clientId, 'new', 'create'),
    mutationFn: (request: CreateProductRequest) => contentApi.createProduct(clientId, request),
    onSuccess: async (product) => {
      queryClient.setQueryData(productKeys.detail(clientId, product.id), product)
      await queryClient.invalidateQueries({ queryKey: productKeys.listRoot(clientId) })
    },
  })
}

export function useUpdateProduct(clientId: string, productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: productKeys.command(clientId, productId, 'update'),
    mutationFn: (request: UpdateProductRequest) => contentApi.updateProduct(productId, request),
    onSuccess: async (product) => {
      queryClient.setQueryData(productKeys.detail(clientId, productId), product)
      await invalidateProductScope(queryClient, clientId, productId)
    },
  })
}

export function useValidateProductContent(clientId: string, productId: string) {
  return useMutation({
    mutationKey: productKeys.command(clientId, productId, 'validate'),
    mutationFn: (request: ValidateProductContentRequest) => contentApi.validateContent(productId, request),
  })
}

export function useSaveProductDraft(clientId: string, productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: productKeys.command(clientId, productId, 'save-draft'),
    mutationFn: (request: SaveProductContentDraftRequest) => contentApi.saveContentDraft(productId, request),
    onSuccess: async (content) => {
      queryClient.setQueryData(productKeys.content(clientId, productId), content)
      await invalidateProductScope(queryClient, clientId, productId)
    },
  })
}

export function usePublishProductContent(clientId: string, productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: productKeys.command(clientId, productId, 'publish'),
    mutationFn: (request: PublishProductContentRequest) => contentApi.publishContent(productId, request),
    onSuccess: async () => {
      await invalidateProductScope(queryClient, clientId, productId)
    },
  })
}

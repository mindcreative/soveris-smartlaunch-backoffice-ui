import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AxiosProgressEvent } from 'axios'
import type { ApiError } from '../api/apiClient'
import {
  getProductImagePreview,
  getProductImageUploadStatus,
  uploadProductImage,
} from '../api/productImageApi'
import { createUuidV7 } from '../lib/uuidV7'
import type {
  CompletedProductImageUpload,
  ProductImageRole,
  ProductImageUploadResponse,
} from '../types/productImages'
import { productKeys } from './productQueries'

export type ProductImageUploadPhase =
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'uncertain'
  | 'error'

export interface ProductImageUploadView {
  operationId: string
  role: ProductImageRole
  fileName: string
  phase: ProductImageUploadPhase
  progress: number | null
  message: string
  previewUrl?: string
  assetId?: string
  assetUrl?: string
}

interface RetainedUpload {
  operationId: string
  role: ProductImageRole
  file: File
}

export const productImageKeys = {
  scope: (clientId: string, productId: string) =>
    [...productKeys.client(clientId), 'assets', productId] as const,
  upload: (clientId: string, productId: string, operationId: string) =>
    [...productImageKeys.scope(clientId, productId), 'upload', operationId] as const,
  preview: (clientId: string, productId: string, assetId: string) =>
    [...productImageKeys.scope(clientId, productId), 'preview', assetId] as const,
}

export function useProductImageUploads(
  clientId: string,
  productId: string,
  onCompleted: (pointer: string, result: CompletedProductImageUpload) => void,
) {
  const queryClient = useQueryClient()
  const [uploads, setUploads] = useState<Record<string, ProductImageUploadView>>({})
  const retained = useRef(new Map<string, RetainedUpload>())
  const controllers = useRef(new Map<string, AbortController>())
  const objectUrls = useRef(new Map<string, string>())
  const appliedAssets = useRef(new Map<string, string>())
  const generation = useRef(0)
  const completionRef = useRef(onCompleted)
  const ownAuthReplay = useRef(false)
  completionRef.current = onCompleted

  const revoke = useCallback((pointer: string) => {
    const url = objectUrls.current.get(pointer)
    if (url) URL.revokeObjectURL(url)
    objectUrls.current.delete(pointer)
  }, [])

  const clear = useCallback((pointer: string) => {
    const retainedUpload = retained.current.get(pointer)
    const assetId = appliedAssets.current.get(pointer)
    controllers.current.get(pointer)?.abort()
    controllers.current.delete(pointer)
    retained.current.delete(pointer)
    appliedAssets.current.delete(pointer)
    revoke(pointer)
    if (retainedUpload) {
      queryClient.removeQueries({
        queryKey: productImageKeys.upload(clientId, productId, retainedUpload.operationId),
      })
    }
    if (assetId) {
      queryClient.removeQueries({
        queryKey: productImageKeys.preview(clientId, productId, assetId),
      })
    }
    setUploads((current) => {
      const next = { ...current }
      delete next[pointer]
      return next
    })
  }, [clientId, productId, queryClient, revoke])

  const clearAll = useCallback(() => {
    generation.current += 1
    for (const controller of controllers.current.values()) controller.abort()
    for (const url of objectUrls.current.values()) URL.revokeObjectURL(url)
    controllers.current.clear()
    objectUrls.current.clear()
    retained.current.clear()
    appliedAssets.current.clear()
    setUploads({})
    queryClient.removeQueries({ queryKey: productImageKeys.scope(clientId, productId) })
  }, [clientId, productId, queryClient])

  useEffect(() => clearAll, [clearAll])

  useEffect(() => {
    const clearForBoundary = (event: Event) => {
      if (event.type === 'auth:refreshed' && ownAuthReplay.current) {
        ownAuthReplay.current = false
        return
      }
      clearAll()
    }
    window.addEventListener('auth:cleared', clearForBoundary)
    window.addEventListener('auth:refreshed', clearForBoundary)
    window.addEventListener('popstate', clearForBoundary)
    return () => {
      window.removeEventListener('auth:cleared', clearForBoundary)
      window.removeEventListener('auth:refreshed', clearForBoundary)
      window.removeEventListener('popstate', clearForBoundary)
    }
  }, [clearAll])

  const update = useCallback((pointer: string, value: ProductImageUploadView) => {
    setUploads((current) => ({ ...current, [pointer]: value }))
  }, [])

  const complete = useCallback(async (
    pointer: string,
    retainedUpload: RetainedUpload,
    result: CompletedProductImageUpload,
    controller: AbortController,
    expectedGeneration: number,
  ) => {
    if (expectedGeneration !== generation.current || controller.signal.aborted) return
    queryClient.setQueryData(
      productImageKeys.upload(clientId, productId, retainedUpload.operationId), result)
    if (appliedAssets.current.get(pointer) !== result.asset.id) {
      appliedAssets.current.set(pointer, result.asset.id)
      completionRef.current(pointer, result)
    }
    update(pointer, {
      operationId: retainedUpload.operationId,
      role: retainedUpload.role,
      fileName: retainedUpload.file.name,
      phase: 'completed',
      progress: 100,
      message: 'Upload complete. Save the draft to attach it.',
      assetId: result.asset.id,
      assetUrl: result.asset.url,
    })
    try {
      const blob = await getProductImagePreview(productId, result.asset.id, controller.signal)
      if (expectedGeneration !== generation.current || controller.signal.aborted) return
      revoke(pointer)
      const previewUrl = URL.createObjectURL(blob)
      objectUrls.current.set(pointer, previewUrl)
      queryClient.setQueryData(
        productImageKeys.preview(clientId, productId, result.asset.id), blob)
      setUploads((current) => current[pointer]?.assetId === result.asset.id
        ? { ...current, [pointer]: { ...current[pointer]!, previewUrl } }
        : current)
    } catch (error) {
      if (controller.signal.aborted || expectedGeneration !== generation.current) return
      const apiError = error as ApiError
      if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) {
        clear(pointer)
        return
      }
      setUploads((current) => current[pointer]?.assetId === result.asset.id
        ? { ...current, [pointer]: { ...current[pointer]!, message: 'Upload complete. Private preview is temporarily unavailable.' } }
        : current)
    }
  }, [clear, clientId, productId, queryClient, revoke, update])

  const resolveResponse = useCallback(async (
    pointer: string,
    retainedUpload: RetainedUpload,
    response: ProductImageUploadResponse,
    controller: AbortController,
    expectedGeneration: number,
  ) => {
    if (response.status === 'completed') {
      await complete(pointer, retainedUpload, response, controller, expectedGeneration)
      return
    }
    update(pointer, {
      operationId: retainedUpload.operationId,
      role: retainedUpload.role,
      fileName: retainedUpload.file.name,
      phase: 'processing',
      progress: null,
      message: 'Server processing continues. Check status when ready.',
    })
  }, [complete, update])

  const handleFailure = useCallback((
    pointer: string,
    retainedUpload: RetainedUpload,
    error: unknown,
    controller: AbortController,
    expectedGeneration: number,
  ) => {
    if (controller.signal.aborted || expectedGeneration !== generation.current) return
    const apiError = error as ApiError
    if (apiError.status === 401 || apiError.status === 403 || apiError.status === 404) {
      clear(pointer)
      return
    }
    const uncertain = apiError.code === 'NETWORK_ERROR' || apiError.status === 503
    update(pointer, {
      operationId: retainedUpload.operationId,
      role: retainedUpload.role,
      fileName: retainedUpload.file.name,
      phase: uncertain ? 'uncertain' : 'error',
      progress: null,
      message: uncertain
        ? 'Upload result is uncertain. Check server status before retrying.'
        : apiError.message || 'The image could not be uploaded.',
    })
  }, [clear, update])

  const send = useCallback(async (
    pointer: string,
    retainedUpload: RetainedUpload,
    controller: AbortController,
    expectedGeneration: number,
  ) => {
    update(pointer, {
      operationId: retainedUpload.operationId,
      role: retainedUpload.role,
      fileName: retainedUpload.file.name,
      phase: 'uploading',
      progress: 0,
      message: 'Uploading image…',
    })
    try {
      const response = await uploadProductImage(
        productId,
        retainedUpload.operationId,
        retainedUpload.role,
        retainedUpload.file,
        controller.signal,
        (event: AxiosProgressEvent) => {
          if (controller.signal.aborted || expectedGeneration !== generation.current) return
          const progress = event.total && event.total > 0
            ? Math.min(100, Math.round((event.loaded / event.total) * 100))
            : null
          setUploads((current) => current[pointer]?.operationId === retainedUpload.operationId
            ? { ...current, [pointer]: { ...current[pointer]!, progress } }
            : current)
        },
        () => { ownAuthReplay.current = true },
      )
      await resolveResponse(pointer, retainedUpload, response, controller, expectedGeneration)
    } catch (error) {
      handleFailure(pointer, retainedUpload, error, controller, expectedGeneration)
    }
  }, [handleFailure, productId, resolveResponse, update])

  const start = useCallback((pointer: string, role: ProductImageRole, file: File) => {
    clear(pointer)
    const retainedUpload = { operationId: createUuidV7(), role, file }
    const controller = new AbortController()
    const expectedGeneration = generation.current
    retained.current.set(pointer, retainedUpload)
    controllers.current.set(pointer, controller)
    void send(pointer, retainedUpload, controller, expectedGeneration)
  }, [clear, send])

  const retry = useCallback(async (pointer: string) => {
    const retainedUpload = retained.current.get(pointer)
    if (!retainedUpload) return
    controllers.current.get(pointer)?.abort()
    const controller = new AbortController()
    controllers.current.set(pointer, controller)
    const expectedGeneration = generation.current
    update(pointer, {
      operationId: retainedUpload.operationId,
      role: retainedUpload.role,
      fileName: retainedUpload.file.name,
      phase: 'processing',
      progress: null,
      message: 'Checking retained operation status…',
    })
    try {
      const response = await getProductImageUploadStatus(
        productId, retainedUpload.operationId, controller.signal)
      await resolveResponse(pointer, retainedUpload, response, controller, expectedGeneration)
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.status === 404 && !controller.signal.aborted
        && expectedGeneration === generation.current) {
        await send(pointer, retainedUpload, controller, expectedGeneration)
        return
      }
      handleFailure(pointer, retainedUpload, error, controller, expectedGeneration)
    }
  }, [handleFailure, productId, resolveResponse, send, update])

  return { uploads, start, retry, cancel: clear, clearAll }
}

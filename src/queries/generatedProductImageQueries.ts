import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adoptGeneratedProductImage, getGeneratedProductImageStatus } from '../api/generatedProductImageApi'
import type { GeneratedProductImageScope } from '../types/generatedProductImages'
import { productKeys } from './productQueries'

export function useGeneratedProductImageCommands(clientId: string, productId: string) {
  const queryClient = useQueryClient(); const generation = useRef(0); const controller = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const clear = useCallback(() => {
    generation.current += 1; controller.current?.abort(); controller.current = null; busy.current = false
    const queryKey = [...productKeys.client(clientId), 'generated-images', productId]
    void queryClient.cancelQueries({ queryKey }); queryClient.removeQueries({ queryKey })
  }, [clientId, productId, queryClient])
  useEffect(() => { window.addEventListener('auth:refreshed', clear); window.addEventListener('popstate', clear)
    return () => { clear(); window.removeEventListener('auth:refreshed', clear); window.removeEventListener('popstate', clear) } }, [clear, clientId, productId])
  const execute = useCallback(async (scope: GeneratedProductImageScope, statusOnly: boolean) => {
    if (busy.current || scope.productId !== productId) throw new Error('An adoption request is already pending or its destination changed.')
    busy.current = true; const captured = generation.current; const abort = new AbortController(); controller.current = abort
    try {
      const result = await (statusOnly ? getGeneratedProductImageStatus : adoptGeneratedProductImage)(scope, abort.signal)
      if (abort.signal.aborted || captured !== generation.current) throw new Error('The image selection is no longer current.')
      const key = [...productKeys.client(clientId), 'generated-images', productId, scope.operationId]
      queryClient.setQueryData(key, result)
      return result
    } finally { if (captured === generation.current) { busy.current = false; controller.current = null } }
  }, [clientId, productId, queryClient])
  return { execute, clear }
}

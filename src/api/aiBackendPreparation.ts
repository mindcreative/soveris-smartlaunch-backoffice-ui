import { apiClient } from './apiClient'
import { useAuthStore } from '../stores/authStore'

export class AiBackendPreparationError extends Error {
  constructor() { super('AI preparation did not finish. No generation was submitted.'); this.name = 'AiBackendPreparationError' }
}

// Preparation may poll; generation and retained command recovery never retry here.
export async function prepareAiBackend(kind: 'content' | 'image', signal?: AbortSignal): Promise<void> {
  const actor = useAuthStore.getState().user
  const until = Date.now() + 120_000
  const requireScope = () => {
    const current = useAuthStore.getState().user
    if (current?.id !== actor?.id || current?.clientId !== actor?.clientId) throw new AiBackendPreparationError()
    signal?.throwIfAborted()
  }
  while (Date.now() < until) {
    requireScope()
    const response = await apiClient.postApiRoot<string>('/api/ai/backend-preparations', JSON.stringify({ kind }), {
      responseType: 'text', signal, timeout: 7_000, retryOnUnauthorized: false, headers: { 'Content-Type': 'application/json' },
    })
    requireScope()
    const match = typeof response.data === 'string' && response.data.length <= 256
      ? /^\s*\{\s*"state"\s*:\s*"(ready|preparing|not_required)"\s*\}\s*$/u.exec(response.data) : null
    if (!match) throw new AiBackendPreparationError()
    const state = match[1]
    if (response.status === 200 && (state === 'ready' || state === 'not_required')) return
    if (response.status !== 202 || state !== 'preparing') throw new AiBackendPreparationError()
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 2_000)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  throw new AiBackendPreparationError()
}

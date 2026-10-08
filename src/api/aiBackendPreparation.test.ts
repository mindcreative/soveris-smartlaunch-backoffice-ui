import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import { prepareAiBackend } from './aiBackendPreparation'
import { useAuthStore } from '../stores/authStore'

describe('AI backend preparation', () => {
  beforeEach(() => { vi.useFakeTimers(); useAuthStore.setState({ user: { id: 'actor', clientId: 'client' } as never }) })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('polls preparation only and never submits generation', async () => {
    const post = vi.spyOn(apiClient, 'postApiRoot')
      .mockResolvedValueOnce({ status: 202, data: '{"state":"preparing"}' })
      .mockResolvedValueOnce({ status: 200, data: '{"state":"ready"}' })
    const result = prepareAiBackend('content')
    await vi.advanceTimersByTimeAsync(2_000)
    await result
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.every(call => call[0] === '/api/ai/backend-preparations' && call[1] === '{"kind":"content"}')).toBe(true)
  })

  it('accepts a server-owned preparation no-op without polling', async () => {
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ status: 200, data: '{"state":"not_required"}' })
    await prepareAiBackend('content')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('rejects false readiness and duplicate fields', async () => {
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ status: 200, data: '{"state":"preparing"}' })
    await expect(prepareAiBackend('image')).rejects.toThrow('No generation was submitted')
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ status: 200, data: '{"state":"preparing","state":"ready"}' })
    await expect(prepareAiBackend('image')).rejects.toThrow('No generation was submitted')
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ status: 200, data: '{"state":"preparing","\\u0073tate":"ready"}' })
    await expect(prepareAiBackend('image')).rejects.toThrow('No generation was submitted')
  })

  it('stops polling after Client scope changes', async () => {
    const post = vi.spyOn(apiClient, 'postApiRoot').mockImplementation(async () => {
      useAuthStore.setState({ user: { id: 'actor', clientId: 'other-client' } as never })
      return { status: 202, data: '{"state":"preparing"}' }
    })
    await expect(prepareAiBackend('image')).rejects.toThrow('No generation was submitted')
    expect(post).toHaveBeenCalledTimes(1)
  })
})

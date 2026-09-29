import type { PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { AiContentAdmission, AiGenerationMaterial, AiJobStatusDto } from '../types/aiContent'
import { AiContentContractError } from '../api/aiContentApi'
import { buildAiContentRequest, useAiContentGeneration, type AiWorkflowDependencies } from './aiContentQueries'

const ACTOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const KEY = '01995d88-7740-73f1-8000-000000000099'
const REGENERATE_KEY = '01995d88-7740-73f1-8000-000000000100'

const material: AiGenerationMaterial = {
  target: 'hero', currentValue: 'Frozen hero copy', productSlug: 'origin',
  targetPointer: '/hero/title', targetValue: 'Frozen hero title', draftRevision: 7,
  productName: 'Origin', targetAudience: 'Teams', tone: 'professional',
  variations: 1, instructions: 'Be precise',
}

const admission: AiContentAdmission = {
  kind: 'accepted', jobId: JOB_ID,
  reservationId: '01995d88-7740-73f1-8000-000000000002',
  attemptId: '01995d88-7740-73f1-8000-000000000003',
  quotedCredits: '1.0000', status: 'reserved',
  correlationId: '01995d88-7740-73f1-8000-000000000004', replay: false,
}

function job(status: 'reserved' | 'completed' | 'failed' | 'execution_unknown' | 'cancelled' = 'reserved'): AiJobStatusDto {
  const terminal = status !== 'reserved'
  const codes = {
    reserved: { code: 'pending', poll: true, action: 'wait' },
    completed: { code: 'complete', poll: false, action: 'view_result' },
    failed: { code: 'failed', poll: false, action: 'contact_support' },
    execution_unknown: { code: 'outcome_unknown', poll: false, action: 'contact_support' },
    cancelled: { code: 'cancelled', poll: false, action: 'contact_support' },
  } as const
  return {
    jobId: JOB_ID, clientId: CLIENT_ID, requestType: 'content_generation', status,
    correlationId: '01995d88-7740-73f1-8000-000000000004', submittedByUserId: ACTOR_ID,
    createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:01Z',
    processingStartedAt: null, completedAt: terminal ? '2026-09-28T10:00:01Z' : null,
    result: status === 'completed' ? { resultId: '01995d88-7740-73f1-8000-000000000005', variations: ['Persisted result'], providerName: 'fixture', modelName: 'fixture-v1', observedAt: '2026-09-28T10:00:01Z', createdAt: '2026-09-28T10:00:01Z' } : null,
    attempt: { attemptId: '01995d88-7740-73f1-8000-000000000003', attemptNumber: 1, outcomeStatus: status === 'completed' ? 'succeeded' : status === 'execution_unknown' ? 'execution_unknown' : status === 'reserved' ? 'processing' : 'failed', executionPhase: status === 'reserved' ? 'pre_dispatch' : 'resolved', providerName: null, failureCategory: status === 'execution_unknown' ? 'timeout' : status === 'failed' ? 'validation_error' : status === 'cancelled' ? 'cancelled' : null, retryDisposition: status === 'execution_unknown' ? 'unknown' : terminal && status !== 'completed' ? 'non_retryable' : null, startedAt: '2026-09-28T10:00:00Z', completedAt: terminal ? '2026-09-28T10:00:01Z' : null },
    reservation: { reservationId: '01995d88-7740-73f1-8000-000000000002', state: status === 'completed' ? 'committed' : terminal && status !== 'execution_unknown' ? 'released' : 'active', estimatedCredits: '1.0000', actualCredits: status === 'completed' ? '1.0000' : null, createdAt: '2026-09-28T10:00:00Z', expiresAt: '2026-09-28T10:05:00Z', committedAt: status === 'completed' ? '2026-09-28T10:00:01Z' : null, releasedAt: terminal && status !== 'completed' && status !== 'execution_unknown' ? '2026-09-28T10:00:01Z' : null },
    usage: null, providerCost: null, guidance: codes[status],
  }
}

function harness(overrides: Partial<AiWorkflowDependencies> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const dependencies: Partial<AiWorkflowDependencies> = {
    now: () => 0, uuid: () => KEY, sleep: async () => undefined,
    post: vi.fn().mockResolvedValue(admission), get: vi.fn().mockResolvedValue(job('completed')),
    ...overrides,
  }
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const rendered = renderHook((props: { clientId: string; authorized: boolean; productId?: string }) => useAiContentGeneration({ actorId: ACTOR_ID, clientId: props.clientId, productId: props.productId ?? PRODUCT_ID, classification: 'customer', authorized: props.authorized, dependencies }), { wrapper, initialProps: { clientId: CLIENT_ID, authorized: true } as { clientId: string; authorized: boolean; productId?: string } })
  return { ...rendered, dependencies, client }
}

describe('retained AI content workflow', () => {
  it.each([
    ['hero', 'generate_content', 'hero'], ['features', 'generate_content', 'features'],
    ['faq', 'generate_content', 'faq'], ['cta', 'generate_content', 'cta'],
    ['description', 'generate_content', 'description'], ['headline', 'generate_headline', 'headline'],
    ['meta_title', 'generate_seo', 'meta_title'], ['meta_description', 'generate_seo', 'meta_description'],
    ['rewrite', 'rewrite_content', 'description'], ['image_prompt', 'generate_image_prompt', 'image_prompt'],
  ] as const)('maps %s only to delivered %s/%s', (target, operation, contentType) => {
    const request = buildAiContentRequest({ ...material, target, currentValue: 'At least ten characters' }, KEY)
    expect(request).toMatchObject({ operation, contentType })
    expect(request.content).toBe(target === 'rewrite' ? 'At least ten characters' : null)
  })

  it('suppresses duplicate activation synchronously', async () => {
    let release!: (value: AiContentAdmission) => void
    const post = vi.fn(() => new Promise<AiContentAdmission>((resolve) => { release = resolve }))
    const flow = harness({ post })
    act(() => {
      expect(flow.result.current.generate(material)).toBe(true)
      expect(flow.result.current.generate(material)).toBe(false)
    })
    expect(post).toHaveBeenCalledTimes(1)
    act(() => release(admission))
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
  })

  it('reuses the exact UUID and serialized body after uncertain pre-Job admission', async () => {
    const post = vi.fn().mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'offline' }).mockResolvedValueOnce(admission)
    const flow = harness({ post })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('admission_unknown'))
    const retained = flow.result.current.state.attempt
    act(() => { expect(flow.result.current.recover()).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]?.[0]).toBe(post.mock.calls[1]?.[0])
    expect(flow.result.current.state.attempt?.idempotencyKey).toBe(retained?.idempotencyKey)
    expect(flow.result.current.state.attempt?.serializedBody).toBe(retained?.serializedBody)
  })

  it('starts a confirmed regeneration with one fresh key while retaining the completed result', async () => {
    const keys = [KEY, REGENERATE_KEY]
    let releaseSecond!: (value: AiContentAdmission) => void
    const post = vi.fn()
      .mockResolvedValueOnce(admission)
      .mockImplementationOnce(() => new Promise<AiContentAdmission>((resolve) => { releaseSecond = resolve }))
    const flow = harness({ uuid: () => keys.shift()!, post })
    act(() => { expect(flow.result.current.generate(material)).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    const completed = flow.result.current.state

    act(() => { expect(flow.result.current.regenerate({ ...material, instructions: 'A fresh confirmed request' })).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('submitting'))
    expect(flow.result.current.state.prior).toMatchObject({
      jobId: completed.jobId,
      job: { result: { resultId: completed.job?.result?.resultId } },
    })
    const first = JSON.parse(post.mock.calls[0]?.[0] as string)
    const second = JSON.parse(post.mock.calls[1]?.[0] as string)
    expect(first.idempotencyKey).toBe(KEY)
    expect(second.idempotencyKey).toBe(REGENERATE_KEY)
    expect(second.instructions).toBe('A fresh confirmed request')

    act(() => releaseSecond(admission))
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    expect(flow.result.current.state.prior?.jobId).toBe(completed.jobId)
  })

  it('never creates a regeneration key while admission of the retained attempt is uncertain', async () => {
    const uuid = vi.fn().mockReturnValueOnce(KEY).mockReturnValueOnce(REGENERATE_KEY)
    const flow = harness({ uuid, post: vi.fn().mockRejectedValue({ code: 'NETWORK_ERROR', message: 'offline' }) })
    act(() => { expect(flow.result.current.generate(material)).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('admission_unknown'))
    act(() => { expect(flow.result.current.regenerate(material)).toBe(false) })
    expect(uuid).toHaveBeenCalledTimes(1)
  })

  it('rechecks a completed Job by GET before returning durable Apply evidence', async () => {
    const get = vi.fn().mockResolvedValue(job('completed'))
    const flow = harness({ get })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    const automaticGets = get.mock.calls.length
    let verified: AiJobStatusDto | null = null
    await act(async () => { verified = await flow.result.current.recheckCompleted() })
    expect(verified).toMatchObject({
      jobId: JOB_ID,
      status: 'completed',
      guidance: { code: 'complete', poll: false, action: 'view_result' },
      result: { variations: ['Persisted result'] },
    })
    expect(get).toHaveBeenCalledTimes(automaticGets + 1)
  })

  it('dismisses only local AI preview state without another request', async () => {
    const post = vi.fn().mockResolvedValue(admission)
    const get = vi.fn().mockResolvedValue(job('completed'))
    const flow = harness({ post, get })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    const calls = { post: post.mock.calls.length, get: get.mock.calls.length }
    act(() => { expect(flow.result.current.dismiss()).toBe(true) })
    expect(flow.result.current.state).toMatchObject({ phase: 'idle', attempt: null, job: null, jobId: null, prior: null })
    expect(post).toHaveBeenCalledTimes(calls.post)
    expect(get).toHaveBeenCalledTimes(calls.get)
  })

  it('retains only its own byte-identical POST through auth replay and purges unrelated refreshes', async () => {
    const post = vi.fn(async (_body, _signal, onAuthReplay) => {
      onAuthReplay?.()
      window.dispatchEvent(new CustomEvent('auth:refreshed'))
      return admission
    })
    const flow = harness({ post })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    expect(post.mock.calls[0]?.[0]).toBe(flow.result.current.state.attempt?.serializedBody)
    act(() => window.dispatchEvent(new CustomEvent('auth:refreshed')))
    await waitFor(() => expect(flow.result.current.state.attempt).toBeNull())
    expect(flow.result.current.state.message).toContain('session or navigation context changed')
  })

  it('uses bounded 1-2-4 polling and stops on persisted completion', async () => {
    let now = 0
    const delays: number[] = []
    const get = vi.fn().mockResolvedValueOnce(job()).mockResolvedValueOnce(job()).mockResolvedValueOnce(job('completed'))
    const flow = harness({ now: () => now, sleep: async (ms) => { delays.push(ms); now += ms }, get })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    expect(delays).toEqual([1_000, 2_000, 4_000])
    expect(get).toHaveBeenCalledTimes(3)
    expect(flow.result.current.state.lastCheckedAt).toBe(7_000)
  })

  it('stops at the 60-second page budget and manual checks are GET-only', async () => {
    let now = 0
    const delays: number[] = []
    const post = vi.fn().mockResolvedValue(admission)
    const get = vi.fn().mockResolvedValue(job())
    const flow = harness({ now: () => now, sleep: async (ms) => { delays.push(ms); now += ms }, post, get })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('delayed'))
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000])
    const posts = post.mock.calls.length
    act(() => { expect(flow.result.current.recover()).toBe(false); expect(flow.result.current.checkStatus()).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('polling'))
    expect(post).toHaveBeenCalledTimes(posts)
    expect(get.mock.calls.length).toBe(delays.length + 1)
  })

  it.each([
    ['failed', 'failed'], ['execution_unknown', 'execution_unknown'], ['cancelled', 'cancelled'],
  ] as const)('renders authoritative %s as terminal %s', async (status, phase) => {
    const flow = harness({ get: vi.fn().mockResolvedValue(job(status)) })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe(phase))
    expect(flow.result.current.generate(material)).toBe(false)
    expect(flow.result.current.recover()).toBe(false)
  })

  it.each([
    [{ status: 422, code: 'invalid_content_request', message: 'Invalid content' }, 'validation'],
    [{ status: 402, code: 'insufficient_credits', message: 'No credits' }, 'insufficient_credits'],
    [{ status: 409, code: 'idempotency_conflict', message: 'Conflict' }, 'contract_invalid'],
    [{ status: 503, code: 'admission_outcome_unknown', message: 'Unknown' }, 'admission_unknown'],
  ] as const)('maps pre-Job failure to %s without inventing a Job identity', async (failure, phase) => {
    const flow = harness({ post: vi.fn().mockRejectedValue(failure) })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe(phase))
    expect(flow.result.current.state.jobId).toBeNull()
  })

  it('honors Retry-After and recovers only the same rate-limited admission', async () => {
    let now = 1_000
    const post = vi.fn().mockRejectedValueOnce({ status: 429, code: 'limit_reached', message: 'limited', retryAfterSeconds: 8 }).mockResolvedValueOnce(admission)
    const flow = harness({ now: () => now, post })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('rate_limited'))
    expect(flow.result.current.recover()).toBe(false)
    now = 9_000
    act(() => { expect(flow.result.current.recover()).toBe(true) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    expect(post.mock.calls[0]?.[0]).toBe(post.mock.calls[1]?.[0])
  })

  it.each([
    [{ status: 403, code: 'forbidden', message: 'denied' }, 'permission_lost', false],
    [{ status: 404, code: 'job_not_found', message: 'missing' }, 'unavailable', false],
    [{ status: 429, code: 'rate_limit_exceeded', message: 'limited', retryAfterSeconds: 2 }, 'rate_limited', true],
    [{ status: 503, code: 'dependency_unavailable', message: 'down' }, 'delayed', true],
    [new AiContentContractError('malformed'), 'contract_invalid', true],
  ] as const)('maps Job lookup failure to %s with private identity retention=%s', async (failure, phase, retained) => {
    const post = vi.fn().mockResolvedValue(admission)
    const flow = harness({ post, get: vi.fn().mockRejectedValue(failure) })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe(phase))
    expect(Boolean(flow.result.current.state.jobId)).toBe(retained)
    expect(post).toHaveBeenCalledTimes(1)
    if (!retained) expect(flow.result.current.generate(material)).toBe(false)
  })

  it('fences late POST completion and clears state on Client change and permission loss', async () => {
    let release!: (value: AiContentAdmission) => void
    const post = vi.fn(() => new Promise<AiContentAdmission>((resolve) => { release = resolve }))
    const flow = harness({ post })
    act(() => { flow.result.current.generate(material) })
    flow.rerender({ clientId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', authorized: true })
    act(() => release(admission))
    await waitFor(() => expect(flow.result.current.state.jobId).toBeNull())
    expect(flow.result.current.state.message).toContain('Client or product changed')
    flow.rerender({ clientId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', authorized: false })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('permission_lost'))
    expect(flow.result.current.state.attempt).toBeNull()
  })

  it('clears AI-only state on AI permission loss without purging an authorized product draft cache', async () => {
    const flow = harness()
    const productKey = ['backoffice', 'private', 'products', CLIENT_ID, 'content', PRODUCT_ID]
    flow.client.setQueryData(productKey, { draft: 'retained product working context' })
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    flow.rerender({ clientId: CLIENT_ID, authorized: false })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('permission_lost'))
    expect(flow.result.current.state.job).toBeNull()
    expect(flow.client.getQueryData(productKey)).toEqual({ draft: 'retained product working context' })
  })

  it('fences product changes and browser-history traversal before another private frame renders', async () => {
    const flow = harness()
    act(() => { flow.result.current.generate(material) })
    await waitFor(() => expect(flow.result.current.state.phase).toBe('completed'))
    flow.rerender({ clientId: CLIENT_ID, authorized: true, productId: '22222222-3333-4444-5555-666666666666' })
    await waitFor(() => expect(flow.result.current.state.attempt).toBeNull())
    expect(flow.result.current.state.message).toContain('Client or product changed')

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(flow.result.current.state.attempt).toBeNull()
    expect(flow.result.current.state.message).toContain('session or navigation context changed')
  })
})

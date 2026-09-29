import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import origin from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import type { AiGenerationState } from '../../queries/aiContentQueries'
import type { ClientCapabilities } from '../../types/billing'
import type { Product, ProductContentV1 } from '../../types/content'
import { useAuthStore } from '../../stores/authStore'
import type { AiApplyOutcome, VerifiedAiApplySelection } from './productAiApply'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(), workflow: vi.fn(), generate: vi.fn(), regenerate: vi.fn(), recover: vi.fn(), checkStatus: vi.fn(), recheckCompleted: vi.fn(), dismiss: vi.fn(), clear: vi.fn(),
}))

vi.mock('../../queries/billingQueries', async (load) => ({
  ...await load<typeof import('../../queries/billingQueries')>(),
  useClientCapabilities: mocks.capabilities,
}))
vi.mock('../../queries/aiContentQueries', async (load) => ({
  ...await load<typeof import('../../queries/aiContentQueries')>(),
  useAiContentGeneration: mocks.workflow,
}))

import { ProductAiGenerationPanel } from './ProductAiGenerationPanel'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555'
const ACTOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const content = origin as unknown as ProductContentV1
const product: Product = { id: PRODUCT_ID, clientId: CLIENT_ID, name: 'Origin', slug: 'origin', status: 'active', publicationStatus: 'draft', revision: 1, contentSchemaVersion: 1, contentRevision: 1, draftSchemaVersion: 1, draftRevision: 1, completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null, createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:00Z' }

function capability(classification: 'customer' | 'soveris_internal' = 'customer'): ClientCapabilities {
  return { clientId: CLIENT_ID, classificationSource: 'back_office.clients', classification, classificationRevision: '1', policySource: classification === 'customer' ? 'customer_subscription' : 'internal', policyVersion: 'v1', subscription: null, flags: [], limits: [], usage: [], operations: [{ key: 'ai_content_generation', outcome: 'eligible', permission: 'satisfied', feature: 'satisfied', entitlement: classification === 'customer' ? 'satisfied' : 'not_applicable', resourceLimit: 'satisfied', provider: 'satisfied', pricing: 'satisfied', funding: 'available_requires_quote', denialConditions: [] }], evaluatedAt: '2026-09-28T10:00:00Z', nextBoundary: null }
}

const idle: AiGenerationState = { phase: 'idle', attempt: null, job: null, jobId: null, lastCheckedAt: null, message: '', retryAfterUntil: null, prior: null }

function renderPanel(working: ProductContentV1 = content, options: { dirty?: boolean; onApply?: (selection: VerifiedAiApplySelection) => Promise<AiApplyOutcome> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const onApply = options.onApply ?? vi.fn().mockResolvedValue({ kind: 'saved' })
  return { ...render(<ProductAiGenerationPanel clientId={CLIENT_ID} product={product} working={working} draftRevision={1} dirty={options.dirty ?? false} applyPending={false} onApply={onApply} />, { wrapper }), onApply }
}

describe('ProductAiGenerationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: ACTOR_ID, clientId: CLIENT_ID, email: 'editor@example.test', displayName: 'Editor', role: 'Editor', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 }, isAuthenticated: true })
    mocks.capabilities.mockReturnValue({ data: capability(), isLoading: false, isFetching: false, isError: false })
    mocks.workflow.mockReturnValue({ state: idle, generate: mocks.generate, regenerate: mocks.regenerate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
  })

  it('provides labeled native controls and freezes the selected current projection on Generate', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByRole('heading', { name: 'AI content generation' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Generation target'), 'headline')
    await user.selectOptions(screen.getByLabelText('Tone'), 'friendly')
    await user.type(screen.getByLabelText('Target audience'), 'Founders')
    await user.type(screen.getByLabelText('Instructions'), 'Use plain text')
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      target: 'headline', currentValue: content.hero.title, productSlug: content.slug,
      productName: content.name, targetAudience: 'Founders', tone: 'friendly',
      instructions: 'Use plain text', variations: 1,
    }))
  })

  it('shows only persisted read-only variations and labels a moved draft', () => {
    const attempt = { actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID, idempotencyKey: '01995d88-7740-73f1-8000-000000000099', request: {} as never, serializedBody: '{}', material: { target: 'headline' as const, currentValue: content.hero.title, targetPointer: '/hero/title', targetValue: content.hero.title, draftRevision: 1, productSlug: content.slug, productName: content.name, targetAudience: '', tone: null, variations: 1, instructions: '' }, startedAt: 0 }
    const changed = structuredClone(content); changed.hero.title = 'New local headline'
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'completed', attempt, jobId: '01995d88-7740-73f1-8000-000000000001', lastCheckedAt: 1, message: 'ready', job: { status: 'completed', result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['Persisted variation'], providerName: 'fixture', modelName: 'fixture-v1' } } }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    renderPanel(changed)
    expect(screen.getByText('The working draft has moved on. The comparison below is “Current at generation start”.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Current at generation start' })).toBeVisible()
    expect(screen.getByText('Persisted variation')).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Select variation 1' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Dismiss preview' })).toBeVisible()
  })

  it('fails closed for missing permissions and gives internal funding guidance without upgrade copy', () => {
    useAuthStore.setState((state) => ({ ...state, user: state.user ? { ...state.user, role: 'Viewer' } : null }))
    const internal = capability('soveris_internal')
    internal.operations[0] = { ...internal.operations[0]!, outcome: 'denied', funding: 'wallet_missing', denialConditions: ['wallet_missing'] }
    mocks.capabilities.mockReturnValue({ data: internal, isLoading: false, isFetching: false, isError: false })
    renderPanel()
    expect(screen.getByText(/requires both ai:create and ai:view/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    expect(document.body.textContent?.toLowerCase()).not.toContain('upgrade')
  })

  it('labels image prompts as text and exposes only GET status recovery once a Job exists', () => {
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'delayed', attempt: { material: { target: 'image_prompt', currentValue: 'Existing alt' } }, jobId: '01995d88-7740-73f1-8000-000000000001', message: 'Status not confirmed.' }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    renderPanel()
    expect(screen.getByRole('button', { name: 'Check status' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Recover this attempt' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Image prompt (text only)' })).toBeInTheDocument()
  })

  it('keeps Generate disabled after server permission loss even if the local role is stale', () => {
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'permission_lost', message: 'AI permission changed.' }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    renderPanel()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  })

  it('keeps Regenerate release-gated without fabricating a credit amount', () => {
    const attempt = { actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID, idempotencyKey: '01995d88-7740-73f1-8000-000000000099', request: {} as never, serializedBody: '{}', material: { target: 'headline' as const, currentValue: content.hero.title, targetPointer: '/hero/title', targetValue: content.hero.title, draftRevision: 1, productSlug: content.slug, productName: content.name, targetAudience: '', tone: null, variations: 1, instructions: '' }, startedAt: 0 }
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'completed', attempt, jobId: '01995d88-7740-73f1-8000-000000000001', lastCheckedAt: 1, message: 'ready', job: { status: 'completed', result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['Persisted variation'], providerName: 'fixture', modelName: 'fixture-v1' } } }, generate: mocks.generate, regenerate: mocks.regenerate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    renderPanel()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getByText(/server-owned pre-submit credit amount or bound/i)).toBeVisible()
    expect(mocks.regenerate).not.toHaveBeenCalled()
  })

  it('requires explicit variation review and rechecks exact durable evidence before Apply', async () => {
    const attempt = { actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID, idempotencyKey: '01995d88-7740-73f1-8000-000000000099', request: {} as never, serializedBody: '{}', material: { target: 'headline' as const, currentValue: content.hero.title, targetPointer: '/hero/title', targetValue: content.hero.title, draftRevision: 1, productSlug: content.slug, productName: content.name, targetAudience: '', tone: null, variations: 2, instructions: '' }, startedAt: 0 }
    const job = { jobId: '01995d88-7740-73f1-8000-000000000001', status: 'completed', guidance: { code: 'complete', poll: false, action: 'view_result' }, result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['First durable variation', 'Second durable variation'], providerName: 'fixture', modelName: 'fixture-v1' } }
    mocks.recheckCompleted.mockResolvedValue(job)
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'completed', attempt, jobId: job.jobId, lastCheckedAt: 1, message: 'ready', job }, generate: mocks.generate, regenerate: mocks.regenerate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    const user = userEvent.setup()
    const onApply = vi.fn().mockResolvedValue({ kind: 'saved' })
    renderPanel(content, { onApply })

    expect(screen.getByRole('button', { name: 'Review Apply' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Select variation 2' }))
    await user.click(screen.getByRole('button', { name: 'Review Apply' }))
    const review = screen.getByRole('heading', { name: 'Confirm Apply' }).closest('section')!
    expect(review).toHaveTextContent(CLIENT_ID)
    expect(review).toHaveTextContent('Hero title')
    expect(review).toHaveTextContent('Second durable variation')
    expect(review).toHaveTextContent(/will not publish or debit credits/i)
    await user.click(screen.getByRole('button', { name: 'Confirm Apply' }))

    expect(mocks.recheckCompleted).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID,
      targetPointer: '/hero/title', targetValue: content.hero.title,
      jobId: job.jobId, resultId: job.result.resultId,
      variationIndex: 1, variation: 'Second durable variation', job,
    }))
  })

  it('keeps Apply disabled while unrelated edits are dirty', async () => {
    const attempt = { actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID, idempotencyKey: '01995d88-7740-73f1-8000-000000000099', request: {} as never, serializedBody: '{}', material: { target: 'headline' as const, currentValue: content.hero.title, targetPointer: '/hero/title', targetValue: content.hero.title, draftRevision: 1, productSlug: content.slug, productName: content.name, targetAudience: '', tone: null, variations: 1, instructions: '' }, startedAt: 0 }
    const job = { jobId: '01995d88-7740-73f1-8000-000000000001', status: 'completed', guidance: { code: 'complete', poll: false, action: 'view_result' }, result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['Persisted variation'], providerName: 'fixture', modelName: 'fixture-v1' } }
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'completed', attempt, jobId: job.jobId, lastCheckedAt: 1, message: 'ready', job }, generate: mocks.generate, regenerate: mocks.regenerate, recover: mocks.recover, checkStatus: mocks.checkStatus, recheckCompleted: mocks.recheckCompleted, dismiss: mocks.dismiss, clear: mocks.clear })
    const user = userEvent.setup()
    renderPanel(content, { dirty: true })
    await user.click(screen.getByRole('radio', { name: 'Select variation 1' }))
    expect(screen.getByRole('button', { name: 'Review Apply' })).toBeDisabled()
    expect(screen.getByText(/save or resolve unrelated working-draft edits/i)).toBeVisible()
  })
})

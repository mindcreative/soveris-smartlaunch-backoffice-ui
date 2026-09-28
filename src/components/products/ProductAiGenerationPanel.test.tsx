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

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(), workflow: vi.fn(), generate: vi.fn(), recover: vi.fn(), checkStatus: vi.fn(), clear: vi.fn(),
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

const idle: AiGenerationState = { phase: 'idle', attempt: null, job: null, jobId: null, lastCheckedAt: null, message: '', retryAfterUntil: null }

function renderPanel(working: ProductContentV1 = content) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<ProductAiGenerationPanel clientId={CLIENT_ID} product={product} working={working} />, { wrapper })
}

describe('ProductAiGenerationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: ACTOR_ID, clientId: CLIENT_ID, email: 'editor@example.test', displayName: 'Editor', role: 'Editor', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 }, isAuthenticated: true })
    mocks.capabilities.mockReturnValue({ data: capability(), isLoading: false, isFetching: false, isError: false })
    mocks.workflow.mockReturnValue({ state: idle, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, clear: mocks.clear })
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
    const attempt = { actorId: ACTOR_ID, clientId: CLIENT_ID, productId: PRODUCT_ID, idempotencyKey: '01995d88-7740-73f1-8000-000000000099', request: {} as never, serializedBody: '{}', material: { target: 'headline' as const, currentValue: content.hero.title, productSlug: content.slug, productName: content.name, targetAudience: '', tone: null, variations: 1, instructions: '' }, startedAt: 0 }
    const changed = structuredClone(content); changed.hero.title = 'New local headline'
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'completed', attempt, jobId: '01995d88-7740-73f1-8000-000000000001', lastCheckedAt: 1, message: 'ready', job: { status: 'completed', result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['Persisted variation'], providerName: 'fixture', modelName: 'fixture-v1' } } }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, clear: mocks.clear })
    renderPanel(changed)
    expect(screen.getByText('The working draft has moved on. The comparison below is “Current at generation start”.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Current at generation start' })).toBeVisible()
    expect(screen.getByText('Persisted variation')).toBeVisible()
    expect(screen.queryByRole('button', { name: /apply|regenerate|dismiss/i })).not.toBeInTheDocument()
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
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'delayed', attempt: { material: { target: 'image_prompt', currentValue: 'Existing alt' } }, jobId: '01995d88-7740-73f1-8000-000000000001', message: 'Status not confirmed.' }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, clear: mocks.clear })
    renderPanel()
    expect(screen.getByRole('button', { name: 'Check status' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Recover this attempt' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Image prompt (text only)' })).toBeInTheDocument()
  })

  it('keeps Generate disabled after server permission loss even if the local role is stale', () => {
    mocks.workflow.mockReturnValue({ state: { ...idle, phase: 'permission_lost', message: 'AI permission changed.' }, generate: mocks.generate, recover: mocks.recover, checkStatus: mocks.checkStatus, clear: mocks.clear })
    renderPanel()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  })
})

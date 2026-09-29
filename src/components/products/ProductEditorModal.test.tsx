import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import origin from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import { contentApi } from '../../api/endpoints'
import * as productImageApi from '../../api/productImageApi'
import type { ApiError } from '../../api/apiClient'
import { useAuthStore } from '../../stores/authStore'
import type { Product, ProductContentEnvelope, ProductContentV1 } from '../../types/content'
import type { VerifiedAiApplySelection } from './productAiApply'

const aiMocks = vi.hoisted(() => ({ selection: null as unknown as VerifiedAiApplySelection }))

vi.mock('./ProductAiGenerationPanel', () => ({
  ProductAiGenerationPanel: ({ onApply }: { onApply: (selection: VerifiedAiApplySelection) => Promise<unknown> }) =>
    <button type="button" onClick={() => void onApply(aiMocks.selection)}>Apply verified fixture</button>,
}))

import { ProductEditorModal } from './ProductEditorModal'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555'
const full = origin as unknown as ProductContentV1

const product: Product = {
  id: PRODUCT_ID, clientId: CLIENT_ID, name: 'Origin', slug: 'origin', status: 'active',
  publicationStatus: 'draft', revision: 3, contentSchemaVersion: null, contentRevision: 1,
  draftSchemaVersion: 1, draftRevision: 7,
  completeness: { isComplete: true, missingRequirements: [] }, canonicalUrl: null,
  createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
}

function envelope(): ProductContentEnvelope {
  return {
    productId: PRODUCT_ID, schemaVersion: null, revision: 1, content: {},
    draft: { schemaVersion: 1, revision: 7, content: structuredClone(full) },
  }
}

function applySelection(overrides: Partial<VerifiedAiApplySelection> = {}): VerifiedAiApplySelection {
  const job = {
    jobId: '01995d88-7740-73f1-8000-000000000001', status: 'completed',
    submittedByUserId: null,
    guidance: { code: 'complete', poll: false, action: 'view_result' },
    result: { resultId: '01995d88-7740-73f1-8000-000000000002', variations: ['Applied durable headline'] },
  } as unknown as VerifiedAiApplySelection['job']
  return {
    actorId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientId: CLIENT_ID,
    productId: PRODUCT_ID, target: 'headline', targetPointer: '/hero/title', targetLabel: 'Hero title',
    targetValue: full.hero.title, draftRevision: 7, jobId: job.jobId,
    resultId: job.result!.resultId, variationIndex: 0,
    variation: job.result!.variations[0]!, job, ...overrides,
  }
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<ProductEditorModal clientId={CLIENT_ID} product={product} onClose={vi.fn()} />, {
    wrapper: wrapper(queryClient),
  })
  return queryClient
}

describe('ProductEditorModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState({ user: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientId: CLIENT_ID, email: 'editor@example.test', displayName: 'Editor', role: 'Editor', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 }, isAuthenticated: true })
    vi.spyOn(contentApi, 'getProduct').mockResolvedValue(product)
    vi.spyOn(contentApi, 'getContent').mockResolvedValue(envelope())
    aiMocks.selection = applySelection()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:private-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('uses a wide responsive editing surface', async () => {
    renderEditor()

    const dialog = await screen.findByRole('dialog', { name: 'Edit Origin' })
    expect(dialog).toHaveClass('w-full', 'max-w-5xl')
  })

  it('loads retained canonical draft losslessly and Ctrl+S saves the exact draft token', async () => {
    const saved = envelope()
    saved.draft = { schemaVersion: 1, revision: 8, content: structuredClone(full) }
    vi.spyOn(contentApi, 'saveContentDraft').mockResolvedValue(saved)
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByLabelText('Hero title')).toHaveValue(full.hero.title)
    expect(screen.getByText('Form field: email')).toBeVisible()
    expect(screen.getByText('Form field: role')).toBeVisible()
    expect(screen.getByText('Form field: tools')).toBeVisible()
    expect(screen.getByText('Form field: notes')).toBeVisible()

    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(contentApi.saveContentDraft).toHaveBeenCalledTimes(1))
    expect(contentApi.saveContentDraft).toHaveBeenCalledWith(PRODUCT_ID, {
      schemaVersion: 1,
      expectedRevision: 7,
      content: full,
    })
    expect(await screen.findByText('Draft saved at revision 8.')).toBeVisible()
  })

  it('preserves edits and links structured 422 errors to their field', async () => {
    const problem: ApiError = {
      code: 'validation_failed', message: 'Validation failed.', status: 422,
      errors: [{ path: '/hero/title', keyword: 'maxLength', code: 'title_too_long', message: 'Use a shorter hero title.' }],
    }
    vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue(problem)
    const user = userEvent.setup()
    renderEditor()

    const title = await screen.findByLabelText('Hero title')
    await user.clear(title)
    await user.type(title, 'Changed title')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const summary = await screen.findByRole('alert')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(title).toHaveValue('Changed title')
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-describedby', expect.stringContaining('-error'))
    await user.click(screen.getByRole('button', { name: 'Use a shorter hero title.' }))
    expect(title).toHaveFocus()
  })

  it('publishes only authoritative revision tokens and keeps lifecycle separate', async () => {
    vi.spyOn(contentApi, 'publishContent').mockResolvedValue({
      productId: PRODUCT_ID, schemaVersion: 1, revision: 2, content: structuredClone(full),
      publicationStatus: 'published', draft: { schemaVersion: 1, revision: 7, content: structuredClone(full) },
    })
    vi.spyOn(contentApi, 'updateProduct').mockResolvedValue({ ...product, status: 'archived', revision: 4 })
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(contentApi.publishContent).toHaveBeenCalledWith(PRODUCT_ID, {
      expectedDraftRevision: 7,
      expectedRevision: 1,
    }))
    expect(contentApi.publishContent).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Archive product' }))
    await waitFor(() => expect(contentApi.updateProduct).toHaveBeenCalledWith(PRODUCT_ID, expect.objectContaining({
      expectedRevision: 3, name: 'Origin', slug: 'origin', status: 'archived',
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })))
  })

  it('uploads a hero image into only the local working copy and focuses alternative text', async () => {
    const assetUrl = '/assets/product-images/01995d88-7740-73f1-8000-000000000002.webp'
    vi.spyOn(productImageApi, 'uploadProductImage').mockResolvedValue({
      operationId: '01995d88-7740-73f1-8000-000000000001',
      status: 'completed',
      asset: {
        id: '01995d88-7740-73f1-8000-000000000002',
        productId: PRODUCT_ID,
        role: 'hero',
        url: assetUrl,
        mediaType: 'image/webp',
        byteLength: 1200,
        width: 1200,
        height: 630,
        visibility: 'private',
        createdAt: '2026-09-14T12:00:00Z',
      },
      storage: { usedBytes: 1200, limitBytes: 5000, remainingBytes: 3800 },
    })
    vi.spyOn(productImageApi, 'getProductImagePreview')
      .mockResolvedValue(new Blob(['preview'], { type: 'image/webp' }))
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const publish = vi.spyOn(contentApi, 'publishContent')
    const user = userEvent.setup()
    renderEditor()

    const picker = await screen.findByLabelText('Replace hero image')
    await user.upload(picker, new File(['image'], 'hero.webp', { type: 'image/webp' }))

    await waitFor(() => expect(screen.getByLabelText('Background image path')).toHaveValue(assetUrl))
    await waitFor(() => expect(screen.getByLabelText('Background image alternative text')).toHaveFocus())
    expect(screen.getByAltText(`Private preview: ${full.hero.backgroundImage.alt}`)).toHaveAttribute('src', 'blob:private-preview')
    expect(screen.getByText(/Save the draft to attach it/i)).toBeVisible()
    expect(save).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('checks uncertain operation status before retrying retained bytes', async () => {
    const result = {
      operationId: '01995d88-7740-73f1-8000-000000000001',
      status: 'completed' as const,
      asset: {
        id: '01995d88-7740-73f1-8000-000000000002', productId: PRODUCT_ID,
        role: 'hero' as const, url: '/assets/product-images/01995d88-7740-73f1-8000-000000000002.webp',
        mediaType: 'image/webp' as const, byteLength: 100, width: 1200, height: 630,
        visibility: 'private' as const, createdAt: '2026-09-14T12:00:00Z',
      },
      storage: { usedBytes: 100, limitBytes: 1000, remainingBytes: 900 },
    }
    const upload = vi.spyOn(productImageApi, 'uploadProductImage')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'offline' } satisfies ApiError)
    const status = vi.spyOn(productImageApi, 'getProductImageUploadStatus').mockResolvedValue(result)
    vi.spyOn(productImageApi, 'getProductImagePreview').mockResolvedValue(new Blob(['preview']))
    const user = userEvent.setup()
    renderEditor()

    await user.upload(await screen.findByLabelText('Replace hero image'), new File(['same'], 'hero.webp', { type: 'image/webp' }))
    expect(await screen.findByText(/result is uncertain/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Check status and retry safely' }))

    await waitFor(() => expect(status).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(await screen.findByLabelText('Background image path')).toHaveValue(result.asset.url)
  })

  it('keeps feature uploads role-scoped and removal local until draft save', async () => {
    const featureUrl = '/assets/product-images/01995d88-7740-73f1-8000-000000000003.png'
    const upload = vi.spyOn(productImageApi, 'uploadProductImage').mockResolvedValue({
      operationId: '01995d88-7740-73f1-8000-000000000001', status: 'completed',
      asset: {
        id: '01995d88-7740-73f1-8000-000000000003', productId: PRODUCT_ID,
        role: 'feature', url: featureUrl, mediaType: 'image/png', byteLength: 50,
        width: 400, height: 400, visibility: 'private', createdAt: '2026-09-14T12:00:00Z',
      },
      storage: { usedBytes: 50, limitBytes: 1000, remainingBytes: 950 },
    })
    vi.spyOn(productImageApi, 'getProductImagePreview').mockResolvedValue(new Blob(['preview']))
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    const selectors = await screen.findAllByLabelText('Replace feature image')
    await user.upload(selectors[0]!, new File(['png'], 'feature.png', { type: 'image/png' }))

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      PRODUCT_ID,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      'feature',
      expect.objectContaining({ name: 'feature.png' }),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
    ))
    expect(screen.getAllByLabelText('Feature image path')[0]).toHaveValue(featureUrl)
    await user.click(screen.getAllByRole('button', { name: 'Remove feature image' })[0]!)
    expect(screen.getAllByLabelText('Feature image path')).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview')
    expect(save).not.toHaveBeenCalled()
  })

  it('rechecks, validates and revision-saves exactly one selected scalar without publishing', async () => {
    const merged = structuredClone(full)
    merged.hero.title = aiMocks.selection.variation
    const saved = envelope()
    saved.draft = { schemaVersion: 1, revision: 8, content: merged }
    const validate = vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockResolvedValue(saved)
    const publish = vi.spyOn(contentApi, 'publishContent')
    const update = vi.spyOn(contentApi, 'updateProduct')
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(validate).toHaveBeenCalledWith(PRODUCT_ID, { schemaVersion: 1, content: merged, target: 'draft' })
    expect(save).toHaveBeenCalledWith(PRODUCT_ID, { schemaVersion: 1, expectedRevision: 7, content: merged })
    expect(await screen.findByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(screen.getByText(/draft saved at revision 8/i)).toBeVisible()
    expect(publish).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses Apply while unrelated local edits are dirty and sends no validation or write', async () => {
    const validate = vi.spyOn(contentApi, 'validateContent')
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    const subtitle = await screen.findByLabelText('Hero subtitle')
    await user.clear(subtitle)
    await user.type(subtitle, 'Unrelated unsaved edit')
    await user.click(screen.getByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/save or resolve unrelated working-draft edits/i)).toBeVisible()
    expect(subtitle).toHaveValue('Unrelated unsaved edit')
    expect(validate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('blocks a stale target or draft revision and enters server review without a write', async () => {
    const stale = envelope()
    stale.draft = { schemaVersion: 1, revision: 8, content: structuredClone(full) }
    stale.draft.content.hero.title = 'Server winner'
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValueOnce(stale)
    const validate = vi.spyOn(contentApi, 'validateContent')
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/apply is stale/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Use server version' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Keep local edits' })).toBeVisible()
    expect(validate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('preserves the merged working copy and linked pointer errors after server validation rejection', async () => {
    vi.spyOn(contentApi, 'validateContent').mockRejectedValue({
      status: 422, code: 'content_invalid', message: 'invalid',
      errors: [{ path: '/hero/title', keyword: 'maxLength', code: 'title_too_long', message: 'Use a shorter generated title.' }],
    } satisfies ApiError)
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    const summary = await screen.findByRole('alert')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.getByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(screen.getByRole('button', { name: 'Use a shorter generated title.' })).toBeVisible()
    expect(save).not.toHaveBeenCalled()
  })

  it('treats a successful invalid validation report as review-only and sends no save', async () => {
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({
      schemaVersion: 1,
      isValid: false,
      errors: [{ path: '/hero/title', keyword: 'maxLength', code: 'title_too_long', message: 'Shorten the generated title.' }],
      warnings: [],
    })
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByRole('button', { name: 'Shorten the generated title.' })).toBeVisible()
    expect(screen.getByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not verify an uncertain save when server validation fails before the draft PUT', async () => {
    const merged = structuredClone(full)
    merged.hero.title = aiMocks.selection.variation
    const verified = envelope()
    verified.draft = { schemaVersion: 1, revision: 8, content: merged }
    vi.mocked(contentApi.getContent)
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(verified)
    vi.spyOn(contentApi, 'validateContent').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'offline' } satisfies ApiError)
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/result is uncertain because the network request failed/i)).toBeVisible()
    expect(screen.getByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(screen.queryByText(/verified at draft revision 8/i)).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(contentApi.getContent).toHaveBeenCalledTimes(2)
  })

  it('preserves the merged working copy when the save response cannot prove the committed revision', async () => {
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const unverified = envelope()
    unverified.draft = { schemaVersion: 1, revision: 7, content: structuredClone(full) }
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockResolvedValue(unverified)
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/save response could not be verified/i)).toBeVisible()
    expect(screen.getByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(screen.getByRole('button', { name: 'Refresh and review server version' })).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('preserves the merged draft and revision evidence after a save conflict', async () => {
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({
      status: 409, code: 'stale_draft_revision', message: 'stale',
      currentSchemaVersion: 1, currentRevision: 2,
      currentDraftSchemaVersion: 1, currentDraftRevision: 8,
    } satisfies ApiError)
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/current live revision 2; current draft revision 8/i)).toBeVisible()
    expect(screen.getByLabelText('Hero title')).toHaveValue('Applied durable headline')
    expect(screen.getByRole('button', { name: 'Refresh and review server version' })).toBeVisible()
  })

  it('uses GET comparison after an uncertain PUT and never repeats the write', async () => {
    const merged = structuredClone(full)
    merged.hero.title = aiMocks.selection.variation
    const verified = envelope()
    verified.draft = { schemaVersion: 1, revision: 8, content: merged }
    vi.mocked(contentApi.getContent)
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(verified)
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'offline' } satisfies ApiError)
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Apply verified fixture' }))
    expect(await screen.findByText(/verified at draft revision 8/i)).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1)
    expect(contentApi.getContent).toHaveBeenCalledTimes(3)
  })
})

import { editorFixturePermissions } from '../../test/authorityFixtures'
import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import origin from '../../contracts/product-content/v1/fixtures/valid/origin-full.json'
import { contentApi } from '../../api/endpoints'
import * as productImageApi from '../../api/productImageApi'
import type { ApiError } from '../../api/apiClient'
import { useAuthStore } from '../../stores/authStore'
import type { Product, ProductContentEnvelope, ProductContentV1 } from '../../types/content'
import type { VerifiedAiApplySelection } from './productAiApply'
import type { VerifiedGeneratedImageSelection } from './productImageApply'
import { captureGeneratedImageTarget } from './productImageApply'
import * as generatedImageApi from '../../api/generatedProductImageApi'

const aiMocks = vi.hoisted(() => ({ selection: null as unknown as VerifiedAiApplySelection, image: null as unknown as VerifiedGeneratedImageSelection, imageOutcome: null as unknown, imageAbort: null as AbortController | null }))

vi.mock('./ProductAiGenerationPanel', () => ({
  ProductAiGenerationPanel: ({ onApply }: { onApply: (selection: VerifiedAiApplySelection) => Promise<unknown> }) =>
    <button type="button" onClick={() => void onApply(aiMocks.selection)}>Apply verified fixture</button>,
}))
vi.mock('./ProductGeneratedImagePanel', () => ({ ProductGeneratedImagePanel: ({ onApply }: { onApply: (selection: VerifiedGeneratedImageSelection, signal: AbortSignal) => Promise<unknown> }) =>
  <button type="button" onClick={() => { aiMocks.imageAbort = new AbortController(); void onApply(aiMocks.image, aiMocks.imageAbort.signal).then(outcome => { aiMocks.imageOutcome = outcome }) }}>Apply verified image fixture</button> }))

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

function renderEditor(selectedProduct: Product = product) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<ProductEditorModal clientId={CLIENT_ID} product={selectedProduct} onClose={vi.fn()} />, {
    wrapper: wrapper(queryClient),
  })
  return queryClient
}

describe('ProductEditorModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState({ user: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientId: CLIENT_ID, email: 'editor@example.test', displayName: 'Editor', role: 'Editor', permissions: editorFixturePermissions, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 }, isAuthenticated: true })
    vi.spyOn(contentApi, 'getProduct').mockResolvedValue(product)
    vi.spyOn(contentApi, 'getContent').mockResolvedValue(envelope())
    aiMocks.imageOutcome = null
    aiMocks.selection = applySelection()
    aiMocks.image = { actorId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientId: CLIENT_ID, productId: PRODUCT_ID,
      draftRevision: 7, target: captureGeneratedImageTarget(full, '/hero/backgroundImage')!, alt: 'Chosen user-owned image description',
      receipt: { operationId: '018f0000-0000-7000-8000-000000000011', status: 'completed', jobId: '018f0000-0000-7000-8000-000000000012',
        resultId: '018f0000-0000-7000-8000-000000000013', asset: { id: '018f0000-0000-7000-8000-000000000014', productId: PRODUCT_ID, role: 'hero',
          url: '/assets/product-images/018f0000-0000-7000-8000-000000000014.webp', mediaType: 'image/webp', byteLength: 1000, width: 1200, height: 630,
          visibility: 'private', createdAt: '2026-10-10T00:00:00Z' }, storage: { usedBytes: 1000, limitBytes: 2000, remainingBytes: 1000 } } }
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:private-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('reopens an archived product read-only and reactivates before allowing content commands', async () => {
    const archived: Product = { ...product, status: 'archived', revision: 4 }
    vi.mocked(contentApi.getProduct).mockResolvedValue(archived)
    const update = vi.spyOn(contentApi, 'updateProduct').mockImplementation(async () => {
      const active: Product = { ...product, revision: 5 }
      vi.mocked(contentApi.getProduct).mockResolvedValue(active)
      return active
    })
    const save = vi.spyOn(contentApi, 'saveContentDraft')
    const publish = vi.spyOn(contentApi, 'publishContent')
    const user = userEvent.setup()
    renderEditor(archived)
    expect(await screen.findByLabelText('Hero title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    await user.keyboard('{Control>}s{/Control}')
    expect(save).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reactivate product' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(PRODUCT_ID, expect.objectContaining({
      expectedRevision: 4, status: 'active', name: 'Origin', slug: 'origin',
    })))
    await waitFor(() => expect(screen.getByLabelText('Hero title')).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive product' })).toBeEnabled()
  })

  it('image Apply reauthorizes retained adoption after source loss and saves only chosen src/alt', async () => {
    const candidate = structuredClone(full); candidate.hero.backgroundImage = { src: aiMocks.image.receipt.asset.url, alt: aiMocks.image.alt }
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    vi.spyOn(contentApi, 'saveContentDraft').mockResolvedValue({ ...envelope(), draft: { schemaVersion: 1, revision: 8, content: candidate } })
    const publish = vi.spyOn(contentApi, 'publishContent'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title')
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    await waitFor(() => expect(contentApi.saveContentDraft).toHaveBeenCalledWith(PRODUCT_ID,
      { schemaVersion: 1, expectedRevision: 7, content: candidate }, expect.any(AbortSignal)))
    expect(publish).not.toHaveBeenCalled(); expect(generatedImageApi.getGeneratedProductImageStatus).toHaveBeenCalled()
  })

  it.each(['uploading', 'processing', 'uncertain'] as const)('image Apply waits for an ordinary upload in %s state', async phase => {
    const upload = vi.spyOn(productImageApi, 'uploadProductImage')
    if (phase === 'uploading') upload.mockImplementation(() => new Promise(() => {}))
    else if (phase === 'processing') upload.mockResolvedValue({ operationId: 'upload', status: 'processing', retryAfterSeconds: 1 } as never)
    else upload.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Response lost' })
    const proof = vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    const save = vi.spyOn(contentApi, 'saveContentDraft'); const user = userEvent.setup(); renderEditor()
    await user.upload(await screen.findByLabelText('Replace hero image'), new File(['image'], 'hero.webp', { type: 'image/webp' }))
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(proof).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
    expect(aiMocks.imageOutcome).toEqual({ kind: 'review' })
  })

  it.each([500, 502, 503, 504])('verifies a possibly committed image PUT after HTTP %s without another write', async status => {
    const candidate = structuredClone(full); candidate.hero.backgroundImage = { src: aiMocks.image.receipt.asset.url, alt: aiMocks.image.alt }
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope())
      .mockResolvedValue({ ...envelope(), draft: { schemaVersion: 1, revision: 8, content: candidate } })
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({ status, code: 'server_error', message: 'Response lost' })
    const user = userEvent.setup(); renderEditor(); await screen.findByLabelText('Hero title')
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    await waitFor(() => expect(aiMocks.imageOutcome).toEqual({ kind: 'saved' }))
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Background image path')).toHaveValue(candidate.hero.backgroundImage.src)
  })

  it.each([401, 403, 404])('clears private image state when uncertain-save verification returns HTTP %s', async status => {
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope())
      .mockRejectedValue({ status, code: 'unavailable', message: 'Unavailable' })
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Response lost' })
    const user = userEvent.setup(); renderEditor(); await screen.findByLabelText('Hero title')
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    await waitFor(() => expect(aiMocks.imageOutcome).toEqual({ kind: 'permission_lost' }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('image Apply preserves unrelated dirty edits without a receipt read or write', async () => {
    const proof = vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus')
    const save = vi.spyOn(contentApi, 'saveContentDraft'); const user = userEvent.setup(); renderEditor()
    const title = await screen.findByLabelText('Hero title'); await user.clear(title); await user.type(title, 'Unsaved title')
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(title).toHaveValue('Unsaved title'); expect(proof).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  })

  it('image Apply rejects a changed revision before validation or PUT', async () => {
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValue({ ...envelope(), draft: { schemaVersion: 1, revision: 8, content: full } })
    const validate = vi.spyOn(contentApi, 'validateContent'); const save = vi.spyOn(contentApi, 'saveContentDraft')
    const user = userEvent.setup(); renderEditor(); await screen.findByLabelText('Hero title')
    await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(await screen.findByText(/image destination or draft revision changed/i)).toBeVisible()
    expect(validate).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  })

  it.each(['removed', 'reordered', 'renamed', 'replaced'] as const)('image Apply refuses a %s feature target and preserves the original working copy', async change => {
    aiMocks.image.target = captureGeneratedImageTarget(full, '/features/items/0/image')!
    aiMocks.image.receipt.asset.role = 'feature'
    const remote = envelope()
    const features = remote.draft!.content.features!.items
    if (change === 'removed') features.splice(0, 1)
    if (change === 'reordered') features.reverse()
    if (change === 'renamed') features[0]!.title = 'Changed remotely'
    if (change === 'replaced') features[0]!.image = { src: '/other.webp', alt: 'Other image' }
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValue(remote)
    const validate = vi.spyOn(contentApi, 'validateContent'); const save = vi.spyOn(contentApi, 'saveContentDraft')
    const publish = vi.spyOn(contentApi, 'publishContent'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title'); await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(await screen.findByText(/image destination or draft revision changed/i)).toBeVisible()
    expect(screen.getAllByLabelText('Feature title')[0]).toHaveValue(full.features!.items[0]!.title)
    expect(validate).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled()
  })

  it('uncertain image PUT with a newer different remote draft preserves local content and never repeats the write', async () => {
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    const remote = envelope(); remote.draft!.revision = 9; remote.draft!.content.hero.title = 'Other editor winner'
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope()).mockResolvedValue(remote)
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Response lost' })
    const publish = vi.spyOn(contentApi, 'publishContent'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title'); await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    await screen.findByText('Your working copy has not been replaced.')
    expect(screen.getByLabelText('Hero title')).toHaveValue(full.hero.title)
    expect(screen.queryByText('Image Apply was verified. Live content is unchanged.')).not.toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled()
  })

  it('image Apply keeps canonical content and receipt after unsafe whole-draft validation', async () => {
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.spyOn(contentApi, 'validateContent').mockRejectedValue({ status: 422, code: 'content_invalid', message: 'Unsafe draft',
      errors: [{ path: '/hero/backgroundImage/src', keyword: 'asset', code: 'asset_invalid', message: 'Image is unavailable.' }] })
    const save = vi.spyOn(contentApi, 'saveContentDraft'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title'); await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(await screen.findByRole('button', { name: 'Image is unavailable.' })).toBeVisible()
    expect(screen.getByLabelText('Background image path')).toHaveValue(full.hero.backgroundImage.src)
    expect(save).not.toHaveBeenCalled()
  })

  it('image Apply verifies a lost PUT response with GET without another write', async () => {
    const candidate = structuredClone(full); candidate.hero.backgroundImage = { src: aiMocks.image.receipt.asset.url, alt: aiMocks.image.alt }
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    vi.mocked(contentApi.getContent).mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce({ ...envelope(), draft: { schemaVersion: 1, revision: 8, content: candidate } })
    vi.spyOn(contentApi, 'validateContent').mockResolvedValue({ schemaVersion: 1, isValid: true, errors: [], warnings: [] })
    const save = vi.spyOn(contentApi, 'saveContentDraft').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Response lost' })
    const publish = vi.spyOn(contentApi, 'publishContent'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title'); await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    expect(await screen.findByText('Image Apply was verified. Live content is unchanged.')).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1); expect(vi.mocked(contentApi.getContent).mock.calls.filter(call => call[1] === aiMocks.imageAbort!.signal)).toHaveLength(2); expect(publish).not.toHaveBeenCalled()
  })

  it('aborts the complete image Apply request sequence without a late draft write', async () => {
    vi.spyOn(generatedImageApi, 'getGeneratedProductImageStatus').mockResolvedValue(aiMocks.image.receipt)
    let complete!: (value: never) => void
    const validate = vi.spyOn(contentApi, 'validateContent').mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const save = vi.spyOn(contentApi, 'saveContentDraft'); const user = userEvent.setup(); renderEditor()
    await screen.findByLabelText('Hero title'); await user.click(screen.getByRole('button', { name: 'Apply verified image fixture' }))
    await waitFor(() => expect(validate).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(contentApi.validateContent).mock.lastCall![2]!
    expect(signal).toBe(aiMocks.imageAbort!.signal)
    await act(async () => { aiMocks.imageAbort!.abort(); complete({ schemaVersion: 1, isValid: true, errors: [], warnings: [] } as never) })
    expect(signal.aborted).toBe(true); expect(save).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Background image path')).toHaveValue(full.hero.backgroundImage.src)
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductGeneratedImagePanel } from './ProductGeneratedImagePanel'
import { getAiImageJob, redeemAiImageResult } from '../../api/aiImageApi'
import { adoptGeneratedProductImage } from '../../api/generatedProductImageApi'
import type { CompletedGeneratedProductImage } from '../../types/generatedProductImages'
import type { ProductContentV1 } from '../../types/content'

const authority = vi.hoisted(() => ({ user: { id: 'actor', clientId: 'client' } as { id: string; clientId: string } | null, permitted: true }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authority.user, hasPermission: () => authority.permitted }) }))
vi.mock('../../api/aiImageApi', async () => ({ ...await vi.importActual('../../api/aiImageApi'), getAiImageJob: vi.fn(), redeemAiImageResult: vi.fn() }))
vi.mock('../../api/generatedProductImageApi', () => ({ adoptGeneratedProductImage: vi.fn(), getGeneratedProductImageStatus: vi.fn() }))
const content: ProductContentV1 = { name: 'Product', slug: 'product', hero: { title: 'Title', subtitle: 'Subtitle',
  cta: { label: 'Join', href: '/join' }, backgroundImage: { src: '/old.webp', alt: 'Old image' } } }
const job = '018f0000-0000-7000-8000-000000000003'
const result = '018f0000-0000-7000-8000-000000000004'
const receipt: CompletedGeneratedProductImage = { operationId: 'operation', status: 'completed', jobId: job, resultId: result,
  asset: { id: 'asset', productId: 'product', role: 'hero', url: '/assets/product-images/asset.webp', mediaType: 'image/webp',
    byteLength: 4, width: 1200, height: 630, visibility: 'private', createdAt: '2026-10-10T10:00:00Z' },
  storage: { usedBytes: 4, limitBytes: 100, remainingBytes: 96 } }
function completedJob() { return { jobId: job, clientId: 'client', status: 'completed', targetRole: 'hero', result: {
  resultId: result, byteSize: 4, expiresAt: '2099-01-01T00:00:00Z' }, resultAccess: { reference: 'private-reference-fixture' } } as never }
describe('generated image source selection', () => {
  beforeEach(() => {
    authority.user = { id: 'actor', clientId: 'client' }; authority.permitted = true
    vi.clearAllMocks()
    vi.mocked(getAiImageJob).mockResolvedValue(completedJob())
    vi.mocked(adoptGeneratedProductImage).mockResolvedValue(receipt)
    vi.mocked(redeemAiImageResult).mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:private-image'), revokeObjectURL: vi.fn() })
  })

  it('discards a private preview response that arrives after source expiry while preserving adoption recovery', async () => {
    vi.useFakeTimers()
    try {
      const expiresAt = new Date(Date.now() + 1000).toISOString()
      vi.mocked(getAiImageJob).mockResolvedValue({ ...completedJob() as object, result: { resultId: result, byteSize: 4, expiresAt } } as never)
      let complete!: (blob: Blob) => void
      vi.mocked(redeemAiImageResult).mockImplementation(() => new Promise(resolve => { complete = resolve }))
      render(<QueryClientProvider client={new QueryClient()}><ProductGeneratedImagePanel clientId="client" productId="product"
        working={content} draftRevision={1} dirty={false} applyPending={false} onApply={vi.fn()} /></QueryClientProvider>)
      fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find completed image' })) })
      fireEvent.click(screen.getByRole('button', { name: 'View private image' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(1001); complete(new Blob(['webp'], { type: 'image/webp' })) })
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Check adoption status' })).toBeEnabled()
    } finally { vi.useRealTimers() }
  })

  it('focuses a linked error summary and associates source validation with its input', async () => {
    render(<QueryClientProvider client={new QueryClient()}><ProductGeneratedImagePanel clientId="client" productId="product"
      working={content} draftRevision={1} dirty={false} applyPending={false} onApply={vi.fn()} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
    const summary = await screen.findByRole('alert')
    expect(summary).toHaveFocus()
    const source = screen.getByLabelText('Completed image Job ID')
    expect(source).toHaveAttribute('aria-invalid', 'true')
    expect(source).toHaveAccessibleDescription(/canonical completed image Job ID/)
    fireEvent.click(screen.getByRole('button', { name: 'Enter a canonical completed image Job ID.' }))
    expect(source).toHaveFocus()
  })

  it('links oversized alternative text to its focused correction without losing the saved receipt', async () => {
    const apply = vi.fn().mockResolvedValue({ kind: 'saved' })
    render(<QueryClientProvider client={new QueryClient()}><ProductGeneratedImagePanel clientId="client" productId="product"
      working={content} draftRevision={1} dirty={false} applyPending={false} onApply={apply} /></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
    await screen.findByLabelText('Alternative text for generated image')
    fireEvent.click(screen.getByRole('button', { name: 'Save private asset' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply generated image' })).toBeEnabled())
    const alt = screen.getByLabelText('Alternative text for generated image')
    fireEvent.change(alt, { target: { value: 'x'.repeat(121) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply generated image' }))
    expect(await screen.findByRole('alert')).toHaveFocus(); expect(alt).toHaveAttribute('aria-invalid', 'true')
    expect(alt).toHaveAccessibleDescription('Enter meaningful alternative text before Apply.')
    fireEvent.click(screen.getByRole('button', { name: 'Enter meaningful alternative text before Apply.' }))
    expect(alt).toHaveFocus(); expect(apply).not.toHaveBeenCalled()
    fireEvent.change(alt, { target: { value: 'Corrected user-owned description' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply generated image' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ receipt, alt: 'Corrected user-owned description' }), expect.any(AbortSignal)))
    expect(adoptGeneratedProductImage).toHaveBeenCalledTimes(1)
  })

  it.each(['job', 'adopt', 'preview'] as const)('fences deferred %s responses across every authority/scope teardown', async phase => {
    for (const boundary of ['close', 'history', 'refresh', 'logout', 'token-loss', 'permission', 'client', 'product', 'actor']) {
      authority.user = { id: 'actor', clientId: 'client' }; authority.permitted = true
      vi.mocked(getAiImageJob).mockResolvedValue(completedJob()); vi.mocked(adoptGeneratedProductImage).mockResolvedValue(receipt)
      vi.mocked(redeemAiImageResult).mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }))
      let release!: (value: never) => void
      const deferred = () => new Promise<never>(resolve => { release = resolve })
      if (phase === 'job') vi.mocked(getAiImageJob).mockImplementation(deferred)
      if (phase === 'adopt') vi.mocked(adoptGeneratedProductImage).mockImplementation(deferred)
      if (phase === 'preview') vi.mocked(redeemAiImageResult).mockImplementation(deferred)
      const query = new QueryClient(); const apply = vi.fn()
      const panel = (clientId = 'client', productId = 'product') => <QueryClientProvider client={query}><ProductGeneratedImagePanel
        clientId={clientId} productId={productId} working={content} draftRevision={1} dirty={false} applyPending={false} onApply={apply} /></QueryClientProvider>
      const rendered = render(panel())
      fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
      fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
      if (phase !== 'job') {
        await screen.findByLabelText('Alternative text for generated image')
        fireEvent.click(screen.getByRole('button', { name: phase === 'adopt' ? 'Save private asset' : 'View private image' }))
      }
      const signal = phase === 'job' ? vi.mocked(getAiImageJob).mock.lastCall![2]! : phase === 'adopt'
        ? vi.mocked(adoptGeneratedProductImage).mock.lastCall![1]! : vi.mocked(redeemAiImageResult).mock.lastCall![3]!
      if (boundary === 'close') rendered.unmount()
      else if (boundary === 'history' || boundary === 'refresh') fireEvent(window, new Event(boundary === 'history' ? 'popstate' : 'auth:refreshed'))
      else {
        if (boundary === 'logout' || boundary === 'token-loss') authority.user = null
        if (boundary === 'permission') authority.permitted = false
        if (boundary === 'actor') authority.user = { id: 'new-actor', clientId: 'client' }
        if (boundary === 'client') authority.user = { id: 'actor', clientId: 'client-b' }
        rendered.rerender(panel(boundary === 'client' ? 'client-b' : 'client', boundary === 'product' ? 'product-b' : 'product'))
      }
      expect(signal.aborted, `${phase}/${boundary}`).toBe(true)
      await act(async () => { release((phase === 'job' ? completedJob() : phase === 'adopt' ? receipt : new Blob(['webp'], { type: 'image/webp' })) as never) })
      expect(screen.queryByLabelText('Alternative text for generated image'), boundary).not.toBeInTheDocument()
      expect(screen.queryByRole('img'), boundary).not.toBeInTheDocument()
      expect(query.getQueryCache().getAll(), boundary).toHaveLength(0)
      expect(apply).not.toHaveBeenCalled()
      rendered.unmount()
    }
  })
  it('uses the labelled known-Job input and authorized GET without changing canonical content', async () => {
    const job = '018f0000-0000-7000-8000-000000000003'
    vi.mocked(getAiImageJob).mockResolvedValue({ jobId: job, clientId: 'client', status: 'completed', targetRole: 'hero',
      result: { resultId: '018f0000-0000-7000-8000-000000000004', expiresAt: '2099-01-01T00:00:00Z' } } as never)
    const apply = vi.fn(); const original = structuredClone(content)
    render(<QueryClientProvider client={new QueryClient()}><ProductGeneratedImagePanel clientId="client" productId="product"
      working={content} draftRevision={1} dirty={false} applyPending={false} onApply={apply} /></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
    await waitFor(() => expect(getAiImageJob).toHaveBeenCalledWith('client', job, expect.any(AbortSignal)))
    expect(content).toEqual(original); expect(apply).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Alternative text for generated image'), { target: { value: 'Pending alt' } })
    expect(content).toEqual(original)
  })
  it('aborts a deferred private Job read on history change and rejects its late result', async () => {
    let release!: (value: never) => void
    vi.mocked(getAiImageJob).mockImplementation(() => new Promise(resolve => { release = resolve }))
    render(<QueryClientProvider client={new QueryClient()}><ProductGeneratedImagePanel clientId="client" productId="product"
      working={content} draftRevision={1} dirty={false} applyPending={false} onApply={vi.fn()} /></QueryClientProvider>)
    const job = '018f0000-0000-7000-8000-000000000003'
    fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
    const signal = vi.mocked(getAiImageJob).mock.lastCall![2]!
    fireEvent(window, new PopStateEvent('popstate')); expect(signal.aborted).toBe(true)
    await act(async () => { release({ jobId: job, status: 'completed', targetRole: 'hero', result: {
      resultId: '018f0000-0000-7000-8000-000000000004', expiresAt: '2099-01-01T00:00:00Z' } } as never) })
    expect(screen.queryByLabelText('Alternative text for generated image')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Completed image Job ID')).toHaveValue('')
  })

  it.each(['auth:refreshed', 'popstate'])('revokes private Blob/reference and receipt on %s', async event => {
    const client = new QueryClient()
    const rendered = render(<QueryClientProvider client={client}><ProductGeneratedImagePanel clientId="client" productId="product"
      working={content} draftRevision={1} dirty={false} applyPending={false} onApply={vi.fn()} /></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' }))
    await screen.findByLabelText('Alternative text for generated image')
    fireEvent.click(screen.getByRole('button', { name: 'View private image' }))
    await screen.findByAltText('Old image')
    expect(rendered.container.innerHTML).not.toContain('private-reference-fixture')
    fireEvent(window, new Event(event))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-image')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Alternative text for generated image')).not.toBeInTheDocument()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })

  it('explicit recapture reuses the saved receipt after unrelated edits without another allocation or source read', async () => {
    const client = new QueryClient(); const apply = vi.fn().mockResolvedValue({ kind: 'saved' })
    const panel = (working: ProductContentV1, revision: number, dirty: boolean) => <QueryClientProvider client={client}><ProductGeneratedImagePanel
      clientId="client" productId="product" working={working} draftRevision={revision} dirty={dirty} applyPending={false} onApply={apply} /></QueryClientProvider>
    const rendered = render(panel(content, 1, false))
    fireEvent.change(screen.getByLabelText('Completed image Job ID'), { target: { value: job } })
    fireEvent.click(screen.getByRole('button', { name: 'Find completed image' })); await screen.findByLabelText('Alternative text for generated image')
    fireEvent.click(screen.getByRole('button', { name: 'Save private asset' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply generated image' })).toBeEnabled())
    const modified = structuredClone(content); modified.hero.title = 'Separately saved title'
    rendered.rerender(panel(modified, 1, true)); expect(screen.getByRole('button', { name: 'Apply generated image' })).toBeDisabled()
    rendered.rerender(panel(modified, 2, false))
    fireEvent.click(screen.getByRole('button', { name: 'Recapture destination' }))
    fireEvent.change(screen.getByLabelText('Alternative text for generated image'), { target: { value: 'Chosen alt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply generated image' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ draftRevision: 2, receipt, alt: 'Chosen alt' }), expect.any(AbortSignal)))
    expect(adoptGeneratedProductImage).toHaveBeenCalledTimes(1); expect(getAiImageJob).toHaveBeenCalledTimes(1)
    expect(modified.hero.title).toBe('Separately saved title')
  })

})

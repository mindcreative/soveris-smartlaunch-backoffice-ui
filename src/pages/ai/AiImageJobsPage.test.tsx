import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiImageJobsPage } from './AiImageJobsPage'
import { useAuthStore } from '../../stores/authStore'
import type { AiImageJob } from '../../types/aiImages'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  tracker: vi.fn(),
  quote: vi.fn(),
  admit: vi.fn(),
}))

vi.mock('../../api/aiImageApi', async (original) => {
  const actual = await original<typeof import('../../api/aiImageApi')>()
  return { ...actual, postAiImageAdmissionQuote: mocks.quote, postAiImageAdmission: mocks.admit }
})

vi.mock('../../queries/billingQueries', async (original) => {
  const actual = await original<typeof import('../../queries/billingQueries')>()
  return { ...actual, useClientCapabilities: mocks.capabilities }
})
vi.mock('../../queries/aiImageQueries', async (original) => {
  const actual = await original<typeof import('../../queries/aiImageQueries')>()
  return { ...actual, useAiImageJobTracker: mocks.tracker }
})

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'

function capability(outcome: 'eligible' | 'denied' = 'eligible') {
  return {
    clientId: CLIENT_ID, classification: 'customer', nextBoundary: null,
    flags: [{ key: 'ai_image_generation', enabled: outcome === 'eligible' }],
    operations: [{
      key: 'ai_image_generation', outcome,
      funding: outcome === 'eligible' ? 'available_requires_quote' : 'wallet_missing',
      denialConditions: outcome === 'eligible' ? [] : ['wallet_missing'],
    }],
  }
}

function completedJob(): AiImageJob {
  return {
    jobId: JOB_ID, clientId: CLIENT_ID, requestType: 'image_generation', targetRole: 'feature', status: 'completed', attemptCount: 1,
    createdAt: '2026-10-02T08:00:00+00:00', updatedAt: '2026-10-02T08:00:05+00:00', processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:05+00:00', completedAt: '2026-10-02T08:00:05+00:00',
    quote: { credits: '2.2500', ruleVersion: 'server-rule' },
    reservation: { reservationId: '01995d88-7740-73f1-8000-000000000002', state: 'committed', estimatedCredits: '2.2500', actualCredits: '2.0000', createdAt: '2026-10-02T08:00:00+00:00', expiresAt: '2026-10-02T08:05:00+00:00', committedAt: '2026-10-02T08:00:05+00:00', releasedAt: null },
    result: { resultId: '01995d88-7740-73f1-8000-000000000005', mediaType: 'image/webp', width: 1024, height: 768, byteSize: 4, observedAt: '2026-10-02T08:00:04+00:00', createdAt: '2026-10-02T08:00:05+00:00', expiresAt: '2026-10-09T08:00:05+00:00' },
    resultAccess: null,
    guidance: { code: 'completed', poll: false },
  }
}

function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ai" element={<AiImageJobsPage />} />
          <Route path="/ai/image-jobs/:jobId" element={<AiImageJobsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AI image page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: {
      id: 'actor', email: 'actor@example.test', displayName: 'Operator', role: 'Admin', clientId: CLIENT_ID,
      accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
    } })
    mocks.capabilities.mockReturnValue({ data: capability(), isLoading: false, isFetching: false, isError: false })
    mocks.quote.mockImplementation(async (targetRole: 'hero' | 'feature') => {
      const issued = new Date(Date.now() - 1_000).toISOString()
      const expires = new Date(Date.now() + 120_000).toISOString()
      return {
        quoteId: 'iaq1_private-opaque-quote', operation: 'image_generation' as const, targetRole,
        quotedCredits: '1.2345', ruleVersion: 'pricing-v9', issuedAt: issued, expiresAt: expires,
      }
    })
    mocks.admit.mockImplementation(() => new Promise(() => undefined))
    mocks.tracker.mockReturnValue({
      state: { phase: 'completed', job: completedJob(), lastCheckedAt: 1, message: 'Completed.', retryAfterUntil: null, previewPhase: 'idle', previewUrl: null },
      checkStatus: vi.fn(), viewResult: vi.fn(() => true), clear: vi.fn(),
    })
  })

  it('requests and renders an exact fractional quote before enabling submission', async () => {
    renderRoute('/ai')
    expect(screen.getByRole('heading', { name: 'AI image generation' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'Private launch visual' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Feature image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    await screen.findByRole('heading', { name: 'Confirm image Job' })
    expect(mocks.quote).toHaveBeenCalledWith('feature', expect.any(AbortSignal))
    expect(screen.getByText('1.2345 abstract credits')).toBeVisible()
    expect(screen.getByText('pricing-v9')).toBeVisible()
    expect(screen.getByText(/not a reservation or charge/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit image Job' })).toBeEnabled()
    expect(screen.getByText(/current Client/i)).toBeVisible()
    expect(document.body.textContent).not.toContain('iaq1_private-opaque-quote')
  })

  it('explains capability denial separately from the quote release gate', () => {
    mocks.capabilities.mockReturnValue({ data: capability('denied'), isLoading: false, isFetching: false, isError: false })
    renderRoute('/ai')
    expect(screen.getByRole('alert')).toHaveTextContent(/funding/i)
    expect(screen.getByRole('button', { name: 'Review and quote' })).toBeDisabled()
    expect(mocks.quote).not.toHaveBeenCalled()
  })

  it('links local validation errors and moves focus without sending a command', async () => {
    renderRoute('/ai')
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    const summary = screen.getByRole('alert')
    expect(mocks.quote).not.toHaveBeenCalled()
    expect(summary).toHaveTextContent('Enter a prompt before review')
    await waitFor(() => expect(summary).toHaveFocus())
    fireEvent.click(screen.getByRole('link', { name: /Image prompt/ }))
    expect(screen.getByLabelText('Image prompt')).toHaveFocus()
  })

  it('clears prompt and closes confirmation when the session boundary changes', async () => {
    renderRoute('/ai')
    fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'Private prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    expect(await screen.findByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
    fireEvent(window, new Event('auth:refreshed'))
    await waitFor(() => expect(screen.getByLabelText('Image prompt')).toHaveValue(''))
    expect(screen.queryByRole('heading', { name: 'Confirm image Job' })).not.toBeInTheDocument()
  })

  it('remounts the private form for a new Client scope', async () => {
    renderRoute('/ai')
    fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'Private prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    expect(await screen.findByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
    useAuthStore.setState((current) => ({ ...current, user: current.user ? {
      ...current.user, clientId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
    } : null }))
    await waitFor(() => expect(screen.getByLabelText('Image prompt')).toHaveValue(''))
    expect(screen.queryByRole('heading', { name: 'Confirm image Job' })).not.toBeInTheDocument()
  })

  it('clears a reviewed quote on input, role, and permission changes', async () => {
    renderRoute('/ai')
    const prompt = screen.getByLabelText('Image prompt')
    fireEvent.change(prompt, { target: { value: 'Private prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    expect(await screen.findByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
    fireEvent.change(prompt, { target: { value: 'Changed private prompt' } })
    expect(screen.queryByRole('heading', { name: 'Confirm image Job' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    expect(await screen.findByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: 'Feature image' }))
    expect(screen.queryByRole('heading', { name: 'Confirm image Job' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review and quote' }))
    expect(await screen.findByRole('heading', { name: 'Confirm image Job' })).toBeVisible()
    useAuthStore.setState((current) => ({ ...current, user: current.user ? { ...current.user, role: 'Viewer' } : null }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Confirm image Job' })).not.toBeInTheDocument())
    expect(prompt).toHaveValue('')
  })

  it('rejects a malformed or non-canonical route before starting the tracker', () => {
    renderRoute('/ai/image-jobs/01995D88-7740-73F1-8000-000000000001')
    expect(screen.getByRole('heading', { name: 'Invalid image Job link' })).toBeVisible()
    expect(mocks.tracker).not.toHaveBeenCalled()
  })

  it('reconstructs a direct tracker for audit:view without requiring ai:create', () => {
    useAuthStore.setState((current) => ({ ...current, user: current.user ? { ...current.user, role: 'Viewer' } : null }))
    renderRoute(`/ai/image-jobs/${JOB_ID}`)
    expect(mocks.tracker).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
    }))
    expect(screen.getByRole('heading', { name: 'Image Job' })).toBeVisible()
    expect(screen.getAllByText(JOB_ID)).toHaveLength(2)
    expect(screen.getAllByText('2.2500 abstract credits')).toHaveLength(2)
    expect(screen.getByText('2.0000 abstract credits')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View result' })).toBeEnabled()
    expect(document.body.textContent).not.toContain('private-reference')
  })

  it('renders a labelled private preview with no attachment or save action', () => {
    mocks.tracker.mockReturnValue({
      state: { phase: 'completed', job: completedJob(), lastCheckedAt: 1, message: 'Private preview loaded.', retryAfterUntil: null, previewPhase: 'ready', previewUrl: 'blob:private' },
      checkStatus: vi.fn(), viewResult: vi.fn(), clear: vi.fn(),
    })
    renderRoute(`/ai/image-jobs/${JOB_ID}`)
    expect(screen.getByRole('img', { name: /private generated feature image preview/i })).toHaveAttribute('src', 'blob:private')
    expect(screen.getByText(/not attached to a product/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /apply|save|attach/i })).not.toBeInTheDocument()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { billingApi, BillingLedgerExportContractError } from '../../api/billingApi'
import type {
  BillingLedgerExportAccepted,
  BillingLedgerExportStatusMetadata,
  BillingLedgerFilters,
} from '../../types/billing'
import { billingExportKeys } from '../../queries/billingQueries'
import { LedgerExportPanel } from './LedgerExportPanel'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'
const EXPORT_ID = '0198d2b0-1234-7abc-8abc-1234567890ab'
const sourceFilters: BillingLedgerFilters = {
  creditAccountId: ACCOUNT_ID,
  transactionType: 'promotion',
  pageSize: 100,
}
const accepted: BillingLedgerExportAccepted = {
  exportId: EXPORT_ID,
  clientId: CLIENT_ID,
  filters: {
    creditAccountId: ACCOUNT_ID, from: null, to: null, transactionType: 'promotion',
    actorUserId: null, jobId: null, reservationId: null,
  },
  requestedAt: '2026-08-27T10:00:00+00:00',
  asOf: '2026-08-27T10:00:00+00:00',
  status: 'pending',
}

function metadata(status: BillingLedgerExportStatusMetadata['status']): BillingLedgerExportStatusMetadata {
  return {
    ...accepted,
    status,
    rowCount: status === 'completed' || status === 'expired' ? '9007199254740993' : null,
    byteSize: status === 'completed' || status === 'expired' ? '9223372036854775807' : null,
    artifactExpiresAt: status === 'completed' || status === 'expired' ? '2099-08-27T11:00:00+00:00' : null,
    failureCode: status === 'failed' ? 'generation_failed' : null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup(filters: BillingLedgerFilters = sourceFilters) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onPermissionDenied = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LedgerExportPanel clientId={CLIENT_ID} filters={filters} onPermissionDenied={onPermissionDenied} />
    </QueryClientProvider>
  )
  return { ...view, queryClient, onPermissionDenied }
}

describe('LedgerExportPanel', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('confirms the visible normalized scope, excludes traversal inputs, and synchronously single-flights POST', async () => {
    const pending = deferred<BillingLedgerExportAccepted>()
    const request = vi.spyOn(billingApi, 'requestLedgerExport').mockReturnValue(pending.promise)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({ metadata: metadata('pending'), reference: null })
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm ledger CSV export' })
    expect(dialog).toHaveTextContent(CLIENT_ID)
    expect(dialog).toHaveTextContent(ACCOUNT_ID)
    expect(dialog).toHaveTextContent('promotion')
    expect(dialog).toHaveTextContent('Page size, loaded pages, cursors')
    expect(dialog).toHaveTextContent('new point-in-time export snapshot')
    expect(dialog).not.toHaveTextContent('100')

    const confirm = screen.getByRole('button', { name: 'Confirm CSV export' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(request.mock.calls[0]?.[1]).toEqual({ creditAccountId: ACCOUNT_ID, transactionType: 'promotion' })

    pending.resolve(accepted)
    const statusHeading = await screen.findByRole('heading', { name: 'Export status: pending' })
    await waitFor(() => expect(statusHeading).toHaveFocus())
    expect(screen.getByText(EXPORT_ID)).toBeInTheDocument()
    expect(screen.getByText('Queued for generation. Ledger review remains available.')).toBeInTheDocument()
  })

  it('keeps accepted scope immutable when visible filters change and performs fresh-reference download without persistence', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    const getStatus = vi.spyOn(billingApi, 'getLedgerExportStatus')
      .mockResolvedValueOnce({ metadata: metadata('completed'), reference: { value: 'poll-reference-must-be-discarded', expiresAt: '2099-08-27T10:05:00+00:00' } })
      .mockResolvedValueOnce({ metadata: metadata('completed'), reference: { value: 'fresh-download-reference', expiresAt: '2099-08-27T10:06:00+00:00' } })
    const redeem = vi.spyOn(billingApi, 'redeemLedgerExport').mockResolvedValue(
      new Blob(['ledger_id,amount\n1,2\n'], { type: 'text/csv' })
    )
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const view = setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByRole('heading', { name: 'Export status: completed' })).toBeInTheDocument()

    view.rerender(<QueryClientProvider client={view.queryClient}>
      <LedgerExportPanel clientId={CLIENT_ID} filters={{ actorUserId: '66666666-6666-6666-6666-666666666666' }} onPermissionDenied={view.onPermissionDenied} />
    </QueryClientProvider>)
    expect(screen.getAllByText(ACCOUNT_ID).length).toBeGreaterThan(0)
    expect(screen.queryByText('66666666-6666-6666-6666-666666666666')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download ledger CSV' }))
    await waitFor(() => expect(redeem).toHaveBeenCalledTimes(1))
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(redeem.mock.calls[0]?.[1].value).toBe('fresh-download-reference')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-download')
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(view.queryClient.getQueryData(billingExportKeys.detail(CLIENT_ID, EXPORT_ID)))).not.toContain('reference')
    expect(document.body.textContent).not.toContain('fresh-download-reference')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(window.location.href).not.toContain('reference')
    expect(billingApi.requestLedgerExport).toHaveBeenCalledTimes(1)
  })

  it('retains accepted identity after transient status failure and offers GET-only manual refresh', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    const getStatus = vi.spyOn(billingApi, 'getLedgerExportStatus')
      .mockRejectedValueOnce({ code: 'HTTP_500', message: 'Unavailable', status: 500 })
      .mockResolvedValueOnce({ metadata: metadata('processing'), reference: null })
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(/Automatic status checks paused/)).toBeInTheDocument()
    expect(screen.getByText(EXPORT_ID)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh export status' }))
    expect(await screen.findByRole('heading', { name: 'Export status: processing' })).toBeInTheDocument()
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(billingApi.requestLedgerExport).toHaveBeenCalledTimes(1)
  })

  it('treats a lost POST response as unknown and warns before a deliberate replacement', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Connection lost' })
      .mockResolvedValueOnce(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({ metadata: metadata('pending'), reference: null })
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText('Export acceptance is unknown')).toBeInTheDocument()
    expect(screen.getByText(/server may have accepted an export/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Request a new CSV export' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('This is a deliberate new export')
    expect(screen.getByRole('dialog')).toHaveTextContent('Another export may already exist')
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(EXPORT_ID)).toBeInTheDocument()
    expect(billingApi.requestLedgerExport).toHaveBeenCalledTimes(2)
  })

  it('warns that a replacement may duplicate an accepted export after a status contract failure', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockRejectedValue(
      new BillingLedgerExportContractError('status scope does not match the accepted export')
    )
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(/status response did not match/)).toBeInTheDocument()
    expect(screen.queryByText(EXPORT_ID)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Request a new CSV export' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Another export may already exist')
    expect(screen.getByRole('dialog')).toHaveTextContent('exactly one new request')
  })

  it.each(['failed', 'expired'] as const)('renders safe %s terminal guidance with no download control', async (terminalStatus) => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({ metadata: metadata(terminalStatus), reference: null })
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByRole('heading', { name: `Export status: ${terminalStatus}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download ledger CSV' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request a new CSV export' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('generation_failed')
    if (terminalStatus === 'failed') expect(screen.getByText(/No partial data is available/)).toBeInTheDocument()
    else expect(screen.getByText(/Request a new point-in-time export/)).toBeInTheDocument()
  })

  it('clears former-Client export metadata synchronously on a Client switch', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({ metadata: metadata('pending'), reference: null })
    const user = userEvent.setup()
    const view = setup()
    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(EXPORT_ID)).toBeInTheDocument()

    const clientB = 'ffffffff-1111-2222-3333-444444444444'
    view.rerender(<QueryClientProvider client={view.queryClient}>
      <LedgerExportPanel clientId={clientB} filters={{}} onPermissionDenied={view.onPermissionDenied} />
    </QueryClientProvider>)
    expect(screen.queryByText(EXPORT_ID)).not.toBeInTheDocument()
    expect(screen.queryByText(CLIENT_ID)).not.toBeInTheDocument()
    await waitFor(() => expect(view.queryClient.getQueryData(billingExportKeys.detail(CLIENT_ID, EXPORT_ID))).toBeUndefined())
  })

  it('collapses a revoked status check to one non-disclosing permission outcome', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockRejectedValue({
      code: 'HTTP_403', message: 'Insufficient permissions', status: 403,
    })
    const user = userEvent.setup()
    const view = setup()
    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))

    await waitFor(() => expect(view.onPermissionDenied).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(EXPORT_ID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download ledger CSV' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Insufficient permissions')
    await waitFor(() => expect(
      view.queryClient.getQueryCache().findAll({ queryKey: ['backoffice', 'private', 'billing'] })
        .every((query) => query.state.data === undefined)
    ).toBe(true))
  })

  it('aborts and ignores a late POST response after route disposal', async () => {
    const pending = deferred<BillingLedgerExportAccepted>()
    const request = vi.spyOn(billingApi, 'requestLedgerExport').mockReturnValue(pending.promise)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({ metadata: metadata('pending'), reference: null })
    const user = userEvent.setup()
    const view = setup()
    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const signal = request.mock.calls[0]?.[2]

    view.unmount()
    expect(signal?.aborted).toBe(true)
    pending.resolve(accepted)
    await Promise.resolve()
    expect(view.queryClient.getQueryData(billingExportKeys.detail(CLIENT_ID, EXPORT_ID))).toBeUndefined()
  })

  it('retains the successful replacement mutation while removing the former status query', async () => {
    const replacement = { ...accepted, exportId: '0198d2b0-1234-7abc-8abc-1234567890ac' }
    vi.spyOn(billingApi, 'requestLedgerExport')
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(replacement)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockImplementation(async (attempt) => ({
      metadata: { ...metadata('completed'), ...attempt, status: 'completed' }, reference: null,
    }))
    const user = userEvent.setup()
    const view = setup()

    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(EXPORT_ID)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Request a new CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByText(replacement.exportId)).toBeInTheDocument()
    await waitFor(() => expect(view.queryClient.getQueryData(
      billingExportKeys.detail(CLIENT_ID, EXPORT_ID)
    )).toBeUndefined())
    expect(view.queryClient.getMutationCache().getAll().some(
      (mutation) => (mutation.state.data as BillingLedgerExportAccepted | undefined)?.exportId === replacement.exportId
    )).toBe(true)
  })

  it('removes download eligibility when a completed artifact expires without another response', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({
      metadata: {
        ...metadata('completed'),
        artifactExpiresAt: new Date(Date.now() + 500).toISOString(),
      },
      reference: null,
    })
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByRole('button', { name: 'Download ledger CSV' })).toBeInTheDocument()

    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Download ledger CSV' })
    ).not.toBeInTheDocument())
    expect(screen.getByText(/no longer download-eligible/)).toBeInTheDocument()
  })

  it('never offers download for an already ineligible completed response', async () => {
    vi.spyOn(billingApi, 'requestLedgerExport').mockResolvedValue(accepted)
    vi.spyOn(billingApi, 'getLedgerExportStatus').mockResolvedValue({
      metadata: {
        ...metadata('completed'),
        artifactExpiresAt: new Date(Date.now() - 1).toISOString(),
      },
      reference: null,
    })
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Request ledger CSV export' }))
    await user.click(screen.getByRole('button', { name: 'Confirm CSV export' }))
    expect(await screen.findByRole('heading', { name: 'Export status: completed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download ledger CSV' })).not.toBeInTheDocument()
    expect(screen.getByText(/no longer download-eligible/)).toBeInTheDocument()
  })
})

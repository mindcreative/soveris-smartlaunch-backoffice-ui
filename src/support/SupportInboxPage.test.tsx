import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SupportInboxPage } from './SupportInboxPage'
import { SupportBoundary } from './SupportBoundary'
import { supportApi } from './client'
import { supportAuthority } from './authority'
import { SupportAccessError } from './errors'
import { useAuthStore } from '../stores/authStore'
import type { AuthUser } from '../types/auth'
import type { SupportMetadata } from './models'

vi.mock('./client', () => ({ supportApi: { list: vi.fn(), detail: vi.fn(), approve: vi.fn(), revoke: vi.fn(), create: vi.fn(), exit: vi.fn(), challenge: vi.fn(), activate: vi.fn(), customers: vi.fn(), products: vi.fn() } }))
const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
let metadata: SupportMetadata
beforeEach(() => {
  supportAuthority.retire()
  const now = new Date().toISOString()
  metadata = { id: grant, operatorId: product, operatorName: 'Named operator', targetClientId: product, targetClientName: 'Customer A',
    products: [{ id: product, name: 'Selected product', slug: 'selected' }], originalWorkspaceName: 'Operator workspace', supportCaseReference: 'case:123', createdAt: new Date().toISOString(), productIds: [product], operations: ['product.draft.read'], scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64), revision: '1', state: 'requested',
    startsAt: null, expiresAt: null, durationMinutes: 60, reason: 'Synthetic consent case',
    clock: { serverMilliseconds: Date.now(), monotonicMilliseconds: performance.now() }, labelReviewHash: 'b'.repeat(64), requestLabels: null, currentLabels: null, labelsChanged: false, requestExpiresAt: new Date(Date.now() + 86400000).toISOString(), approvedAt: null, activationDeadline: null, endedAt: null, terminalReason: null }
  useAuthStore.setState({ accessToken: 'fixture-access', refreshTokenValue: 'fixture-refresh', user: { id: grant, clientId: product, role: 'ClientOwner', platformPermissions: [], permissions: [] } as unknown as AuthUser,
    isAuthenticated: true, isInitialized: true, isLoading: false })
  metadata.currentLabels = { operatorId: metadata.operatorId, operatorName: metadata.operatorName, targetClientId: metadata.targetClientId, targetClientName: metadata.targetClientName, products: [...metadata.products] }
  vi.mocked(supportApi.list).mockResolvedValue({ items: [metadata], nextCursor: grant })
  vi.mocked(supportApi.detail).mockImplementation(async () => metadata)
  vi.mocked(supportApi.approve).mockImplementation(async () => {
    metadata = { ...metadata, state: 'approved', revision: '2', approvedAt: now, activationDeadline: new Date(Date.now() + 86400000).toISOString() }
    return { id: grant, state: 'approved', revision: '2', createdAt: now, approvedAt: now, startsAt: null, expiresAt: null, endedAt: null }
  })
})
afterEach(() => { supportAuthority.retire(); vi.resetAllMocks() })

it('accepts the initial server page after the parent route boundary retires the previous scope', async () => {
  render(<MemoryRouter initialEntries={['/settings/support-access']}><SupportBoundary><SupportInboxPage mode="owner" /></SupportBoundary></MemoryRouter>)
  expect(await screen.findByRole('button', { name: /^Review request / })).toBeVisible()
  expect(supportApi.list).toHaveBeenCalledTimes(1)
})

it('retains only the operators unsent input across focus retirement and clears it when the original actor changes', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, platformPermissions: ['platform:support:operate'] } })
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/platform/support']}><SupportBoundary><SupportInboxPage mode="operator" /></SupportBoundary></MemoryRouter>)
  await screen.findByRole('button', { name: /^Review request / })
  await user.type(screen.getByLabelText('Support reason'), product)
  await user.type(screen.getByLabelText('Support case reference'), grant)
  fireEvent(window, new Event('blur'))
  expect(screen.getByRole('button', { name: 'Request exact scope' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /^Review request / })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Reload current requests' }))
  await screen.findByRole('button', { name: /^Review request / })
  expect(screen.getByLabelText('Support reason')).toHaveValue(product)
  expect(screen.getByLabelText('Support case reference')).toHaveValue(grant)
  expect(supportApi.create).not.toHaveBeenCalled()
  act(() => {
    supportAuthority.retire()
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: product } })
  })
  await user.click(screen.getByRole('button', { name: 'Reload current requests' }))
  await screen.findByRole('button', { name: /^Review request / })
  expect(screen.getByLabelText('Support reason')).toHaveValue('')
  expect(screen.getByLabelText('Support case reference')).toHaveValue('')
})

it('requires explicit exact-scope consent and sends only command identity, revision and immutable scope hash', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><SupportInboxPage mode="owner" /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /^Review request / }))
  const checkbox = await screen.findByRole('checkbox', { name: /I approve this exact operator/ })
  const approve = screen.getByRole('button', { name: 'Approve exact scope' })
  expect(approve).toBeDisabled()
  expect(supportApi.approve).not.toHaveBeenCalled()
  expect(screen.getByText('Synthetic consent case')).toBeInTheDocument()
  expect(screen.getAllByText(/Draft content/).length).toBeGreaterThan(0)
  await user.click(checkbox)
  await user.click(approve)
  await waitFor(() => expect(supportApi.approve).toHaveBeenCalledTimes(1))
  const command = vi.mocked(supportApi.approve).mock.calls[0]![1]
  expect(command).toMatchObject({ expectedRevision: '1', scopeHash: 'a'.repeat(64) })
  expect(Object.keys(command).sort()).toEqual(['expectedRevision', 'labelReviewHash', 'operationId', 'scopeHash'])
  expect(command.operationId).toMatch(/^[a-f0-9-]{14}7[a-f0-9-]{21}$/)
  expect(await screen.findByText('approved', { exact: true })).toBeInTheDocument()
})

it.each(['Editor', 'Viewer', 'ClientAdmin'] as const)('does not mount owner queries for %s or internal management for a customer owner', async role => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role } })
  const view = render(<MemoryRouter><SupportInboxPage mode="owner" /></MemoryRouter>)
  expect(supportApi.list).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied')
  view.unmount()
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role: 'ClientOwner' } })
  render(<MemoryRouter><SupportInboxPage mode="operator" /></MemoryRouter>)
  expect(supportApi.list).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied')
})


it.each([403, 503])('hides all consent/request mutations while the server gate or dependency returns %s', async status => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, platformPermissions: ['platform:support:operate'] } })
  vi.mocked(supportApi.list).mockRejectedValue(new SupportAccessError(status))
  render(<MemoryRouter><SupportInboxPage mode="operator" /></MemoryRouter>)
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Request exact scope' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Approve exact scope' })).toBeNull()
  expect(supportApi.create).not.toHaveBeenCalled()
  expect(supportApi.approve).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox', { name: 'Customer' })).toBeDisabled()
  expect(screen.getAllByText(status === 403 ? 'This action is not currently permitted. Check current access and request status.' : 'Lookup unavailable. Check the connection and retry verification.')[0]).toBeVisible()

  if (status === 403) {
    expect(screen.queryByRole('link', { name: /Verify.*authenticator/ })).toBeNull()
  }
})

it('AV7 refreshes selected owner lifecycle metadata on focus without reopening or a private read or mutation', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/settings/support-access']}><SupportBoundary><SupportInboxPage mode="owner" /></SupportBoundary></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /^Review request / }))
  await screen.findByRole('region', { name: 'Exact support request' })
  metadata = { ...metadata, revision: '3', state: 'active', startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Exact support request' })).toHaveTextContent('active'))
  expect(supportApi.approve).not.toHaveBeenCalled()
  expect(supportApi.activate).not.toHaveBeenCalled()
  expect(screen.getByText(/Remaining time:/)).toBeVisible()
  expect(screen.getByText(/Last verified/)).toBeVisible()
})

it('AV6 missing labels block consent but retain a safely bound rejection action without GUID fallbacks', async () => {
  metadata = { ...metadata, products: [], currentLabels: null, labelReviewHash: null }
  const user = userEvent.setup()
  render(<MemoryRouter><SupportInboxPage mode="owner" /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /^Review request / }))
  await user.click(await screen.findByRole('checkbox', { name: /I approve this exact operator/ }))
  expect(screen.getByRole('button', { name: 'Approve exact scope' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reject request' })).toBeEnabled()
  expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
})

it('AV6 a rename refresh invalidates checked consent before the new review can be submitted', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><SupportInboxPage mode="owner" /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /^Review request / }))
  await user.click(await screen.findByRole('checkbox', { name: /I approve this exact operator/ }))
  expect(screen.getByRole('button', { name: 'Approve exact scope' })).toBeEnabled()
  metadata = { ...metadata, labelReviewHash: 'c'.repeat(64), labelsChanged: true, operatorName: 'Renamed operator' }
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(screen.getByText('Renamed operator', { exact: true })).toBeVisible())
  expect(screen.getByRole('button', { name: 'Approve exact scope' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /I approve this exact operator/ })).not.toBeChecked()
  expect(supportApi.approve).not.toHaveBeenCalled()
})

it.each([403, 503])('AV3 a support %s preserves unsent input while a confirmed security change clears it', async status => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, platformPermissions: ['platform:support:operate'] } })
  const user = userEvent.setup()
  render(<MemoryRouter><SupportInboxPage mode="operator" /></MemoryRouter>)
  await screen.findByRole('button', { name: /^Review request / })
  await user.type(screen.getByLabelText('Support reason'), 'Same-context unsent reason')
  vi.mocked(supportApi.list).mockRejectedValueOnce(new SupportAccessError(status))
  await user.click(screen.getByRole('button', { name: 'Reload current requests' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Support reason')).toHaveValue('Same-context unsent reason')
  act(() => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, securityRevision: '99' } }))
  expect(screen.getByLabelText('Support reason')).toHaveValue('')
})

it('AV10 composed retirement disables lookup and verification resumes Cedar without retyping or mutation', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, platformPermissions: ['platform:support:operate'] } })
  vi.mocked(supportApi.customers).mockResolvedValue({ items: [{ id: product, name: 'Cedar customer' }], nextCursor: null })
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/platform/support']}><SupportBoundary><SupportInboxPage mode="operator" /></SupportBoundary></MemoryRouter>)
  await screen.findByRole('button', { name: /^Review request / })
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await screen.findByRole('option', { name: 'Cedar customer' })
  await user.type(screen.getByLabelText('Support reason'), 'Permitted unsent input')
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  fireEvent(window, new Event('blur'))
  expect(screen.getByRole('combobox', { name: 'Customer' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Customer' })).toBeDisabled()
  expect(screen.queryByRole('option')).toBeNull()
  expect(screen.getByText('Verify access to load available values. Your permitted unsent input is retained.')).toBeVisible()
  const calls = vi.mocked(supportApi.customers).mock.calls.length
  let finish!: (value: { items: SupportMetadata[]; nextCursor: null }) => void
  vi.mocked(supportApi.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await user.click(screen.getByRole('button', { name: 'Verify access to load options' }))
  expect(screen.getByRole('button', { name: 'Verify access to load options' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Customer' })).toBeDisabled()
  expect(supportApi.customers).toHaveBeenCalledTimes(calls)
  await act(async () => finish({ items: [metadata], nextCursor: null }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Customer' })).toBeEnabled())
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  expect(await screen.findByRole('option', { name: 'Cedar customer' })).toBeVisible()
  expect(vi.mocked(supportApi.customers).mock.calls.slice(-1)[0]?.[0]).toBeUndefined()
  expect(screen.getByLabelText('Support reason')).toHaveValue('Permitted unsent input')
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  expect(supportApi.create).not.toHaveBeenCalled()
  expect(supportApi.approve).not.toHaveBeenCalled()
  expect(supportApi.activate).not.toHaveBeenCalled()
})


it('AV10 composed rate limit disables verification until Retry-After then recovers without retyping', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, platformPermissions: ['platform:support:operate'] } })
  vi.mocked(supportApi.customers).mockResolvedValue({ items: [{ id: product, name: 'Cedar customer' }], nextCursor: null })
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/platform/support']}><SupportBoundary><SupportInboxPage mode="operator" /></SupportBoundary></MemoryRouter>)
  await screen.findByRole('button', { name: /^Review request / })
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await screen.findByRole('option', { name: 'Cedar customer' })
  vi.mocked(supportApi.list).mockRejectedValueOnce(new SupportAccessError(429, 1))
  await user.click(screen.getByRole('button', { name: 'Reload current requests' }))
  const verify = await screen.findByRole('button', { name: 'Verify access to load options' })
  expect(verify).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Customer' })).toBeDisabled()
  expect(screen.getByText('Lookup rate limit reached. Wait before verifying access again.')).toBeVisible()
  const calls = vi.mocked(supportApi.list).mock.calls.length
  await user.click(verify)
  expect(supportApi.list).toHaveBeenCalledTimes(calls)
  await waitFor(() => expect(verify).toBeEnabled(), { timeout: 2500 })
  await user.click(verify)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Customer' })).toBeEnabled())
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  expect(await screen.findByRole('option', { name: 'Cedar customer' })).toBeVisible()
  expect(supportApi.create).not.toHaveBeenCalled()
})

it('UX17 UX25 owner refresh keeps focus and exact consent when the review binding is unchanged', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/settings/support-access']}><SupportBoundary><SupportInboxPage mode="owner" /></SupportBoundary></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /^Review request / }))
  const consent = await screen.findByRole('checkbox', { name: /I approve this exact operator/ })
  await user.click(consent)
  expect(consent).toHaveFocus()
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve exact scope' })).toBeEnabled())
  expect(consent).toBeChecked()
  expect(consent).toHaveFocus()
  expect(supportApi.approve).not.toHaveBeenCalled()
})

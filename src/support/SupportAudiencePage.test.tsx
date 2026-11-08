import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SupportAudiencePage } from './SupportAudiencePage'
import { SupportBoundary } from './SupportBoundary'
import { supportAuthority } from './authority'
import { createUuidV7 } from '../lib/uuidV7'
import { supportApi } from './client'
import { useAuthStore } from '../stores/authStore'
import type { AuthUser } from '../types/auth'
import type { SupportContext, SupportDraft } from './models'

vi.mock('./client', () => ({ supportApi: { context: vi.fn(), draft: vi.fn(), identity: vi.fn(), exit: vi.fn() } }))
let grant = ''
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
const actor = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d6'
let context: SupportContext
const draft: SupportDraft = { kind: 'draft', productId: product, draftSchemaVersion: 1, draftRevision: '1', draftJson: '{"text":"draft-canary 019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5 <img src=https://untrusted.invalid/private>"}' }

beforeEach(() => {
  grant = createUuidV7()
  supportAuthority.retire()
  const expires = new Date(Date.now() + 60000).toISOString()
  const user = { id: actor, clientId: '0149620b-af5c-47c9-8290-95edde45ef8f', sessionId: grant, securityRevision: '2', clientRoleId: product,
    displayName: 'Real operator', email: 'synthetic@support.invalid', role: 'ClientOwner', platformPermissions: ['platform:support:operate'],
    permissions: [], timeZoneId: 'Europe/Belgrade', mfaState: 'enrolled', stepUpRequired: false, assuranceExpiresAt: expires,
    freshAssuranceExpiresAt: expires, assuranceGeneration: product, accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresIn: 60 } as AuthUser
  useAuthStore.setState({ user, accessToken: user.accessToken, isAuthenticated: true, isInitialized: true, isLoading: false })
  context = { clock: { serverMilliseconds: Date.now(), monotonicMilliseconds: performance.now() }, id: grant, operatorId: actor, operatorName: 'Real operator', targetClientId: product, targetClientName: 'Customer A',
    products: [{ id: product, name: 'Selected product', slug: 'selected' }], originalWorkspaceName: 'Operator workspace', supportCaseReference: 'case:123', createdAt: new Date().toISOString(), productIds: [product], operations: ['product.draft.read', 'product.identity.read'], scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64),
    revision: '3', state: 'active', startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: expires }
  vi.mocked(supportApi.context).mockResolvedValue(context)
  vi.mocked(supportApi.draft).mockResolvedValue(draft)
})
afterEach(() => { supportAuthority.retire(); vi.resetAllMocks() })

function page() {
  return render(<MemoryRouter initialEntries={['/support/' + grant]}><SupportBoundary><Routes>
    <Route path="/support/:grantId" element={<SupportAudiencePage />} />
  </Routes></SupportBoundary></MemoryRouter>)
}

it('requires explicit current-context verification and renders only escaped text with continuous real attribution', async () => {
  const user = userEvent.setup()
  const view = page()
  expect(supportApi.context).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Verify support context' }))
  expect(await screen.findByRole('region', { name: 'Temporary support access' })).toHaveTextContent('Real operator')
  expect(screen.getByRole('heading', { name: 'Support access — Customer A' })).toHaveFocus()
  expect(screen.getByRole('region', { name: 'Temporary support access' })).toHaveTextContent('Customer A')
  await user.click(screen.getByRole('button', { name: 'Read draft for Selected product · selected' }))
  expect(await screen.findByText(/draft-canary/)).toHaveTextContent('<img src=https://untrusted.invalid/private>')
  expect(view.container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  expect(draft.draftJson).toContain(product)
  expect(view.container.querySelector('img,iframe,video,audio,object,embed')).toBeNull()
  expect(view.container.querySelector('a[href^="https://untrusted.invalid"]')).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('draft-canary')
  expect(JSON.stringify(sessionStorage)).not.toContain('draft-canary')
  expect(useAuthStore.getState().user!.clientId).toBe('0149620b-af5c-47c9-8290-95edde45ef8f')
})

it('synchronously retires on lost focus and rejects a response that ignores cancellation', async () => {
  const user = userEvent.setup()
  let complete!: (value: SupportDraft) => void
  vi.mocked(supportApi.draft).mockImplementation(() => new Promise(resolve => { complete = resolve }))
  page()
  await user.click(screen.getByRole('button', { name: 'Verify support context' }))
  await screen.findByRole('region', { name: 'Temporary support access' })
  await user.click(screen.getByRole('button', { name: 'Read draft for Selected product · selected' }))
  fireEvent(window, new Event('blur'))
  expect(supportAuthority.snapshot().context).toBeNull()
  expect(screen.queryByRole('region', { name: 'Temporary support access' })).toBeNull()
  await act(async () => { complete(draft) })
  expect(screen.queryByText(/draft-canary/)).toBeNull()
})

it('clears content before sending exit and never automatically retries an uncertain terminal command', async () => {
  const user = userEvent.setup()
  vi.mocked(supportApi.exit).mockImplementation(async () => {
    expect(supportAuthority.snapshot().context).toBeNull()
    expect(supportAuthority.snapshot().projection).toBeNull()
    throw { status: 503, detail: 'private-error-canary' }
  })
  page()
  await user.click(screen.getByRole('button', { name: 'Verify support context' }))
  await screen.findByRole('region', { name: 'Temporary support access' })
  await user.click(screen.getByRole('button', { name: 'Read draft for Selected product · selected' }))
  await screen.findByText(/draft-canary/)
  await user.click(screen.getByRole('button', { name: 'Exit support' }))
  await waitFor(() => expect(supportApi.exit).toHaveBeenCalledTimes(1))
  expect(screen.queryByText(/draft-canary/)).toBeNull()
  expect(screen.queryByText(/private-error-canary/)).toBeNull()
})


it.each(['pagehide', 'pageshow', 'focus', 'popstate', 'storage'])('retires synchronously on %s without automatically restoring positive context', async event => {
  const user = userEvent.setup()
  page()
  await user.click(screen.getByRole('button', { name: 'Verify support context' }))
  await screen.findByRole('region', { name: 'Temporary support access' })
  await user.click(screen.getByRole('button', { name: 'Read draft for Selected product · selected' }))
  await screen.findByText(/draft-canary/)
  fireEvent(window, event === 'storage' ? new StorageEvent(event, { key: 'backoffice_access_token' }) : new Event(event))
  expect(supportAuthority.snapshot().projection).toBeNull()
  expect(screen.queryByText(/draft-canary/)).toBeNull()
  expect(supportApi.context).toHaveBeenCalledTimes(1)
})

it.each([-600000, 600000])('V5 clears mounted private content at server expiry with browser skew %s', async offset => {
  const user = userEvent.setup()
  const serverNow = context.clock.serverMilliseconds
  const monotonic = context.clock.monotonicMilliseconds
  const wall = vi.spyOn(Date, 'now').mockReturnValue(serverNow + offset)
  const clock = vi.spyOn(performance, 'now').mockReturnValue(monotonic)

  try {
    page()
    await user.click(screen.getByRole('button', { name: 'Verify support context' }))
    await screen.findByRole('region', { name: 'Temporary support access' })
    await user.click(screen.getByRole('button', { name: 'Read draft for Selected product · selected' }))
    await screen.findByText(/draft-canary/)
    const captured = supportAuthority.capture()
    // Rebind under fake timers so the actual boundary schedules its expiry timer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => {
      supportAuthority.bind({ ...context }, useAuthStore.getState().user!)
      supportAuthority.retain(draft, supportAuthority.snapshot().generation)
    })
    clock.mockReturnValue(monotonic + 60000)
    act(() => vi.advanceTimersByTime(60000))
    expect(captured.isCurrent()).toBe(false)
    expect(supportAuthority.snapshot().projection).toBeNull()
    expect(screen.queryByText(/draft-canary/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Temporary support access' })).toBeNull()
    expect(supportApi.context).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
    wall.mockRestore()
    clock.mockRestore()
  }
})

import { supportRequestHash } from './commandIdentity'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupportReceiptRecovery } from './SupportReceiptRecovery'
import { executeSupportCommand } from './pendingCommands'
import { supportApi } from './client'
import { supportAuthority } from './authority'
import { SupportAccessError } from './errors'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'

vi.mock('./client', () => ({ supportApi: { create: vi.fn(), approve: vi.fn(), activate: vi.fn(), exit: vi.fn(), receipt: vi.fn(), detail: vi.fn() } }))
const originalRevalidation = useAuthStore.getState().revalidateAuthority
const operationId = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const outcome = { id: operationId, state: 'requested' as const, revision: '1', createdAt: new Date().toISOString(), approvedAt: null, startsAt: null, expiresAt: null, endedAt: null }
const body = { operationId, targetClientId: operationId, productIds: [operationId], operations: ['product.identity.read' as const], durationMinutes: 1, reason: 'Memory only', supportCaseReference: 'lost-create' }
beforeEach(() => {
  useAuthStore.setState({ accessToken: null, user: null })
  useAuthStore.setState({ accessToken: 'owned', user: currentAuthorityFixture() })
  supportAuthority.retire()
  vi.resetAllMocks()
  useAuthStore.setState({ isAuthenticated: true, authorityUnavailable: false, refreshTokenValue: 'owned-refresh', revalidateAuthority: vi.fn().mockResolvedValue(undefined) })
  vi.mocked(supportApi.create).mockRejectedValue(new SupportAccessError(503))
})

it('UX29 lost create recovers exact receipt then current detail without a grant ID or replacement command', async () => {
  const refresh = vi.fn()
  await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 503 })
  await expect(executeSupportCommand('request', { ...body, operationId: 'new' })).rejects.toMatchObject({ status: 409 })
  vi.mocked(supportApi.receipt).mockResolvedValue({ operationId, command: 'request', outcome })
  vi.mocked(supportApi.detail).mockResolvedValue({ ...outcome, state: 'ended' } as never)
  render(<SupportReceiptRecovery refresh={refresh} />)
  await userEvent.click(screen.getByRole('button', { name: 'Inspect exact command receipt' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(outcome.id))
  expect(supportApi.receipt).toHaveBeenCalledWith(operationId, expect.any(AbortSignal))
  expect(supportApi.detail).toHaveBeenCalledWith(outcome.id, false, expect.any(AbortSignal))
  expect(supportApi.create).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('region', { name: 'Unconfirmed command' })).toBeNull()
})

it.each([404, 403, 429, 503])('UX29 receipt %s remains uncertain without replay or replacement', async status => {
  await expect(executeSupportCommand('request', body)).rejects.toBeInstanceOf(SupportAccessError)
  vi.mocked(supportApi.receipt).mockRejectedValue(new SupportAccessError(status))
  render(<SupportReceiptRecovery refresh={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Inspect exact command receipt' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Unconfirmed command' })).toHaveTextContent(status === 404 ? 'does not prove rollback' : 'remains unconfirmed'))
  await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 409 })
  expect(supportApi.create).toHaveBeenCalledTimes(1)
  expect(supportApi.detail).not.toHaveBeenCalled()
})

it('UX09 command identity survives presentation retirement and clears on confirmed session change', async () => {
  await expect(executeSupportCommand('request', body)).rejects.toBeInstanceOf(SupportAccessError)
  render(<SupportReceiptRecovery refresh={vi.fn()} />)
  act(() => supportAuthority.retire())
  expect(screen.getByRole('region', { name: 'Unconfirmed command' })).toBeVisible()
  act(() => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, securityRevision: '99' } }))
  expect(screen.queryByRole('region', { name: 'Unconfirmed command' })).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain('Memory only')
})


it('UX12 a trusted stale-review rejection permits deliberate refreshed approval without treating a lost outcome as rollback', async () => {
  const command = { operationId, expectedRevision: '1', scopeHash: 'original-review', labelReviewHash: 'original-labels' }
  vi.mocked(supportApi.approve).mockRejectedValueOnce(new SupportAccessError(409, 0, 'request_changed'))
    .mockResolvedValueOnce({ ...outcome, state: 'approved' })
  await expect(executeSupportCommand('approve', command, operationId)).rejects.toMatchObject({ safeCode: 'request_changed' })
  // A deliberate newly reviewed command follows the authoritative pre-effect rejection.
  await expect(executeSupportCommand('approve', { ...command, operationId: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5', labelReviewHash: 'refreshed-labels' }, operationId)).resolves.toMatchObject({ state: 'approved' })
  expect(supportApi.approve).toHaveBeenCalledTimes(2)
  expect(supportApi.receipt).not.toHaveBeenCalled()
})


it.each([undefined, 'command_conflict'])('UX29 conflict %s without a pre-effect rejection keeps the exact command pending', async safeCode => {
  const command = { operationId, expectedRevision: '1' }
  vi.mocked(supportApi.approve).mockRejectedValue(new SupportAccessError(409, 0, safeCode))
  await expect(executeSupportCommand('approve', command, operationId)).rejects.toMatchObject({ status: 409 })
  await expect(executeSupportCommand('approve', { ...command, operationId: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5' }, operationId)).rejects.toMatchObject({ status: 409 })
  expect(supportApi.approve).toHaveBeenCalledTimes(1)
  render(<SupportReceiptRecovery refresh={vi.fn()} />)
  expect(screen.getByRole('region', { name: 'Unconfirmed command' })).toBeVisible()
})


it('R3 provisional authority suspension retains exact pending command after same-session recovery', async () => {
  const actor = useAuthStore.getState().user!
  useAuthStore.setState({ refreshTokenValue: 'owned-refresh', authorityUnavailable: false })
  await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 503 })
  await useAuthStore.getState().suspendAuthority()
  expect(useAuthStore.getState().accessToken).toBe('owned')
  expect(useAuthStore.getState().refreshTokenValue).toBe('owned-refresh')
  useAuthStore.setState({ user: actor, isAuthenticated: true, authorityUnavailable: false })
  await expect(executeSupportCommand('request', { ...body, operationId: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5' })).rejects.toMatchObject({ status: 409 })
  expect(supportApi.create).toHaveBeenCalledTimes(1)
  useAuthStore.setState({ accessToken: null, refreshTokenValue: null, user: null })
})


afterEach(() => { vi.unstubAllGlobals(); useAuthStore.setState({ revalidateAuthority: originalRevalidation }) })

it.each([true, false])('R1 lost429 receipt clears pending only for exact body: %s', async exact => {
  vi.stubGlobal('crypto', (await vi.importActual<{ webcrypto: Crypto }>('node:crypto')).webcrypto)
  await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 503 })
  const requestHash = await supportRequestHash('/requests', JSON.stringify(exact ? body : { ...body, reason: 'Other body' }))
  vi.mocked(supportApi.receipt).mockResolvedValue({ operationId, command: 'request',
    outcome: { status: 429, code: 'rate_limited_before_effect', requestHash, retryAfter: 30 } })
  const refresh = vi.fn()
  render(<SupportReceiptRecovery refresh={refresh} />)
  await userEvent.click(screen.getByRole('button', { name: 'Inspect exact command receipt' }))

  if (exact) {
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unconfirmed command' })).toBeNull())
    expect(supportAuthority.snapshot().notice).toMatchObject({ status: 429, code: 'rate_limited_before_effect' })
    expect(supportAuthority.snapshot().notice!.retryAt).toBeGreaterThan(Date.now())
  } else {
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unconfirmed command' })).toHaveTextContent('remains unconfirmed'))
    await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 409 })
  }

  expect(supportApi.create).toHaveBeenCalledTimes(1)
  expect(supportApi.detail).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})

it.each(['approve', 'activate', 'exit'] as const)('R6 lost %s recovers exact outcome and current state without replay', async kind => {
  const command = { operationId, expectedRevision: '2' }
  vi.mocked(supportApi[kind]).mockRejectedValue(new SupportAccessError(503))
  await expect(executeSupportCommand(kind, command, operationId)).rejects.toMatchObject({ status: 503 })
  vi.mocked(supportApi.receipt).mockResolvedValue({ operationId, command: kind, outcome })
  vi.mocked(supportApi.detail).mockResolvedValue({ ...outcome, state: 'ended' } as never)
  const refresh = vi.fn()
  render(<SupportReceiptRecovery refresh={refresh} />)
  await userEvent.click(screen.getByRole('button', { name: 'Inspect exact command receipt' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(operationId))
  expect(supportApi.detail).toHaveBeenCalledWith(operationId, kind === 'approve', expect.any(AbortSignal))
  expect(supportApi[kind]).toHaveBeenCalledTimes(1)
})

it.each([true, false])('R1 inline rejection releases the exact pending identity only: %s', async exact => {
  vi.mocked(supportApi.create).mockRejectedValue(new SupportAccessError(429, 30, 'rate_limited_before_effect', undefined,
    exact ? operationId : '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'))
  await expect(executeSupportCommand('request', body)).rejects.toMatchObject({ status: 429 })
  render(<SupportReceiptRecovery refresh={vi.fn()} />)
  expect(Boolean(screen.queryByRole('region', { name: 'Unconfirmed command' }))).toBe(!exact)
  expect(supportApi.create).toHaveBeenCalledTimes(1)
})


it.each(['same', 'changed-session', 'round-trip', 'unavailable', 'unmounted'] as const)('R6 recovered activation revalidates MFA before returning within the original authority: %s', async change => {
  const actor = useAuthStore.getState().user!
  let finish!: () => void
  const revalidateAuthority = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  useAuthStore.setState({ revalidateAuthority })
  vi.mocked(supportApi.activate).mockRejectedValue(new SupportAccessError(503))
  await expect(executeSupportCommand('activate', { operationId, expectedRevision: '2' }, operationId)).rejects.toMatchObject({ status: 503 })
  vi.mocked(supportApi.receipt).mockResolvedValue({ operationId, command: 'activate', outcome: { ...outcome, state: 'active' } })
  vi.mocked(supportApi.detail).mockResolvedValue({ ...outcome, state: 'active' } as never)
  const refresh = vi.fn()
  const view = render(<SupportReceiptRecovery refresh={refresh} />)
  await userEvent.click(screen.getByRole('button', { name: 'Inspect exact command receipt' }))
  await waitFor(() => expect(revalidateAuthority).toHaveBeenCalledTimes(1))
  expect(refresh).not.toHaveBeenCalled()

  await act(async () => {
    supportAuthority.retire()

    if (change === 'changed-session' || change === 'round-trip') {
      useAuthStore.setState({ user: { ...actor, sessionId: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5' } })
    }

    if (change === 'unmounted') {
      view.unmount()
    }

    if (change === 'same' || change === 'round-trip' || change === 'unmounted') {
      useAuthStore.setState({ user: { ...actor, assuranceGeneration: '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d6' } })
    }

    if (change === 'unavailable') {
      useAuthStore.setState({ user: null, authorityUnavailable: true })
    }

    finish()
  })
  expect(refresh).toHaveBeenCalledTimes(change === 'same' ? 1 : 0)
  expect(supportApi.activate).toHaveBeenCalledTimes(1)
})

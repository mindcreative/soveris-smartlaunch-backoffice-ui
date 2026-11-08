import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupportActivation } from './SupportActivation'
import { supportApi } from './client'
import { mfaApi } from '../account/mfaApi'
import { supportAuthority } from './authority'
import { useAuthStore } from '../stores/authStore'
import type { AuthUser } from '../types/auth'
import type { SupportMetadata } from './models'

vi.mock('./client', () => ({ supportApi: { detail: vi.fn(), challenge: vi.fn(), activate: vi.fn() } }))
vi.mock('../account/mfaApi', () => ({ mfaApi: { verifyChallenge: vi.fn(), cancelChallenge: vi.fn() } }))
const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
const proof = { challenge: { id: grant, secret: 'A'.repeat(43), purpose: 'support_activation' as const,
  expiresAt: new Date(Date.now() + 299000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'B'.repeat(42) + 'A' }
const metadata = { id: grant, revision: '2', state: 'approved', durationMinutes: 60 } as SupportMetadata
beforeEach(() => {
  supportAuthority.retire()
  const user = { id: product, clientId: product, sessionId: grant, securityRevision: '2', role: 'ClientOwner', freshAssuranceExpiresAt: new Date(Date.now() + 300000).toISOString(), assuranceGeneration: 'fresh-support', platformPermissions: ['platform:support:operate'] } as unknown as AuthUser
  useAuthStore.setState({ user, isAuthenticated: true, accessToken: 'owned-token', refreshTokenValue: null })
  vi.mocked(supportApi.detail).mockResolvedValue(metadata)
  vi.mocked(supportApi.challenge).mockResolvedValue(proof)
  vi.mocked(mfaApi.verifyChallenge).mockResolvedValue(user)
  vi.mocked(mfaApi.cancelChallenge).mockResolvedValue()
  vi.mocked(supportApi.activate).mockResolvedValue({ id: grant, revision: '3', state: 'active', createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(),
    startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), endedAt: null })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); supportAuthority.retire(); vi.resetAllMocks() })

it('verifies purpose-bound TOTP without automatically activating, then sends one explicit activation', async () => {
  const user = userEvent.setup()
  const refresh = vi.fn()
  render(<SupportActivation grant={metadata} refresh={refresh} />)
  await user.click(screen.getByRole('button', { name: 'Start grant-bound TOTP' }))
  const input = await screen.findByLabelText('Authenticator code')
  await user.type(input, '012345')
  await user.click(screen.getByRole('button', { name: 'Verify TOTP' }))
  expect(await screen.findByRole('button', { name: 'Activate approved grant' })).toBeInTheDocument()
  expect(mfaApi.verifyChallenge).toHaveBeenCalledWith(proof, '012345', expect.any(AbortSignal))
  expect(supportApi.activate).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Authenticator code')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Activate approved grant' }))
  await waitFor(() => expect(supportApi.activate).toHaveBeenCalledTimes(1))
  expect(vi.mocked(supportApi.activate).mock.calls[0]![1]).toMatchObject({ expectedRevision: '2' })
  expect(Object.keys(vi.mocked(supportApi.activate).mock.calls[0]![1]).sort()).toEqual(['expectedRevision', 'operationId'])
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(document.body).not.toHaveTextContent(proof.challenge.secret)
  expect(JSON.stringify(localStorage)).not.toContain(proof.challenge.secret)
})

it('cancels a pending activation challenge on view retirement in the same original session', async () => {
  const user = userEvent.setup()
  const view = render(<SupportActivation grant={metadata} refresh={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Start grant-bound TOTP' }))
  await screen.findByLabelText('Authenticator code')
  view.unmount()
  await waitFor(() => expect(mfaApi.cancelChallenge).toHaveBeenCalledTimes(1))
  expect(supportApi.activate).not.toHaveBeenCalled()
})

it('UX14 removes activation readiness at the strict 300-second boundary and offers safe renewal', async () => {
  let elapsed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  const user = userEvent.setup()
  render(<SupportActivation grant={metadata} refresh={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Start grant-bound TOTP' }))
  await user.type(await screen.findByLabelText('Authenticator code'), '012345')
  await user.click(screen.getByRole('button', { name: 'Verify TOTP' }))
  expect(screen.getByRole('button', { name: 'Activate approved grant' })).toHaveFocus()
  elapsed = 300000
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Activate approved grant' })).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start grant-bound TOTP' })).toHaveFocus())
  expect(supportApi.activate).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('UX15 invalid code stays linked to the input and cancellation returns focus before restart', async () => {
  const user = userEvent.setup()
  vi.mocked(mfaApi.verifyChallenge).mockRejectedValueOnce({ code: 'invalid_mfa_flow', status: 400 })
  render(<SupportActivation grant={metadata} refresh={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Start grant-bound TOTP' }))
  const input = await screen.findByLabelText('Authenticator code')
  expect(input).toHaveFocus()
  await user.type(input, '123456')
  await user.click(screen.getByRole('button', { name: 'Verify TOTP' }))
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('mfa-feedback'))
  expect(input).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Cancel this challenge' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start grant-bound TOTP' })).toHaveFocus())
  await user.click(screen.getByRole('button', { name: 'Start grant-bound TOTP' }))
  expect(await screen.findByLabelText('Authenticator code')).toHaveFocus()
  expect(supportApi.activate).not.toHaveBeenCalled()
})

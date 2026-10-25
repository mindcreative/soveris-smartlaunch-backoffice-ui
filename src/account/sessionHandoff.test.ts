import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../api/endpoints'
import { currentAuthorityEpoch, retireAuthority } from '../auth/authorityEpoch'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import { firstProductHandoff } from './sessionHandoff'

beforeEach(async () => {
  await useAuthStore.getState().clearSession()
  localStorage.clear()
})

describe('activation handoff', () => {
  const user = currentAuthorityFixture({ permissions: ['products:view', 'products:create'] })
  const session = { accessToken: 'activation-access', refreshToken: 'activation-refresh', expiresIn: 3600, user }

  it('accepts through the existing store only after a fresh current projection and consumes intent once', async () => {
    let release!: (value: typeof user) => void
    const current = vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const accepting = useAuthStore.getState().acceptActivationSession(session, currentAuthorityEpoch())
    await vi.waitFor(() => expect(current).toHaveBeenCalledTimes(1))

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    release(user)
    expect(await accepting).toBe(true)
    expect(useAuthStore.getState().user?.securityRevision).toBe(user.securityRevision)
    firstProductHandoff.offer('create_first_product')
    expect(firstProductHandoff.consume()).toBe(true)
    expect(firstProductHandoff.consume()).toBe(false)
  })

  it('does not revive an activation session after authority retirement during current lookup', async () => {
    let release!: (value: typeof user) => void
    vi.spyOn(authApi, 'currentAuthority').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const accepting = useAuthStore.getState().acceptActivationSession(session, currentAuthorityEpoch())
    await vi.waitFor(() => expect(release).toBeDefined())
    await useAuthStore.getState().clearSession()
    release(user)

    expect(await accepting).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(localStorage.getItem('backoffice_access_token')).toBeNull()
  })

  it('fails closed on projection failure and never replaces an existing session', async () => {
    const current = vi.spyOn(authApi, 'currentAuthority').mockRejectedValue({ status: 503 })

    await expect(useAuthStore.getState().acceptActivationSession(session, currentAuthorityEpoch())).rejects.toMatchObject({ loginRequired: true })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    useAuthStore.getState().setTokens('existing', 'existing-refresh')
    useAuthStore.getState().setUser(user)

    expect(await useAuthStore.getState().acceptActivationSession(session, currentAuthorityEpoch())).toBe(false)
    expect(current).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().accessToken).toBe('existing')
  })

  it('does not carry intent across permissions, epochs, unknown actions or another login', () => {
    useAuthStore.getState().setTokens('existing', 'existing-refresh')
    useAuthStore.getState().setUser(user)
    firstProductHandoff.offer('unknown_action')
    expect(firstProductHandoff.consume()).toBe(false)
    firstProductHandoff.offer('create_first_product')
    retireAuthority()
    expect(firstProductHandoff.consume()).toBe(false)
    useAuthStore.getState().setUser({ ...user, permissions: ['products:view'] })
    firstProductHandoff.offer('create_first_product')
    expect(firstProductHandoff.consume()).toBe(false)
  })
})

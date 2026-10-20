import { clientFixturePermissions } from '../../test/authorityFixtures'
import { AppearanceProvider } from '../../appearance/AppearanceProvider'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { AdminShell } from './AdminShell'

beforeEach(() => {
  useAuthStore.setState({
    isAuthenticated: true, isInitialized: true, isLoading: false,
    user: { id: 'actor', clientId: 'client', email: 'a@example.test', displayName: 'Actor',
      role: 'ClientAdmin', permissions: clientFixturePermissions, accessToken: 'token', refreshToken: 'refresh', expiresIn: 1 },
  })
})

describe('authenticated Backoffice shell', () => {
  it('renders private content without a timezone setup screen', async () => {
    render(<MemoryRouter initialEntries={['/dashboard']}>
      <Routes><Route element={<AppearanceProvider userId="test-user"><AdminShell /></AppearanceProvider>}>
        <Route path="/dashboard" element={<p>Private content</p>} />
      </Route></Routes>
    </MemoryRouter>)
    expect(await screen.findByText('Private content')).toBeInTheDocument()
    expect(screen.queryByText('Choose your timezone to continue')).not.toBeInTheDocument()
  })
})

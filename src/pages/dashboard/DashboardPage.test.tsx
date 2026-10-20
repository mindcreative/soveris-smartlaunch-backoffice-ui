import { clientFixturePermissions } from '../../test/authorityFixtures'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import DashboardPage from './DashboardPage'

const health = vi.hoisted(() => vi.fn(() => ({ data: { status: 'healthy', database: 'healthy', redis: 'healthy' } })))
vi.mock('@/hooks/useQueryHooks', () => ({ useHealthCheck: health,
  useClientWorkspaceDashboard: () => ({ data: undefined, isLoading: false, error: null }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { displayName: 'Customer', role: 'ClientAdmin', permissions: clientFixturePermissions } }) }))
afterEach(() => { cleanup(); health.mockClear() })

describe('customer Dashboard health isolation', () => {
  it('never renders or requests the technical inventory, including refresh and warm legacy caches', async () => {
    const client = new QueryClient()
    client.setQueryData(['backoffice', 'health', 'prior-operator'], { status: 'healthy', database: 'healthy' })
    render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>)
    expect(screen.queryByRole('region', { name: 'System Health' })).not.toBeInTheDocument()
    expect(screen.queryByText('Database')).not.toBeInTheDocument()
    expect(health).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(health).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Welcome back, Customer' })).toBeVisible()
  })
})

import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentApi } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import type { Product } from '../../types/content'
import ProductsPage from './ProductsPage'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '11111111-2222-3333-4444-555555555555', clientId: CLIENT_ID,
    name: 'Launch page', slug: 'launch-page', status: 'active',
    publicationStatus: 'draft', revision: 1, contentSchemaVersion: null,
    contentRevision: 1, draftSchemaVersion: null, draftRevision: 0,
    completeness: { isComplete: false, missingRequirements: ['form'] },
    canonicalUrl: null, createdAt: '2026-09-12T00:00:00Z',
    updatedAt: '2026-09-12T00:00:00Z', ...overrides,
  }
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter>
  }
}

describe('ProductsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState({
      user: {
        id: 'operator', email: 'operator@example.com', displayName: 'Operator',
        role: 'Admin', clientId: CLIENT_ID, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
      },
      isAuthenticated: true, isInitialized: true, isLoading: false,
    })
  })

  it('renders distinct product state and creates with a stable exact command', async () => {
    const existing = product()
    const created = product({ id: '99999999-2222-3333-4444-555555555555', name: 'New page', slug: 'new-page' })
    vi.spyOn(contentApi, 'getProducts').mockResolvedValue({
      items: [existing], page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
    })
    vi.spyOn(contentApi, 'createProduct').mockResolvedValue(created)
    vi.spyOn(contentApi, 'getProduct').mockResolvedValue(created)
    vi.spyOn(contentApi, 'getContent').mockResolvedValue({
      productId: created.id, schemaVersion: null, revision: 1, content: {},
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(<ProductsPage />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByRole('heading', { name: 'Products' })).toHaveFocus()
    expect((await screen.findAllByText('Launch page')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unpublished').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Canonical URL unavailable').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Create product' }))
    await user.type(screen.getByLabelText('Product name'), 'New page')
    await user.type(screen.getByLabelText('Product slug'), 'new-page')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    await waitFor(() => expect(contentApi.createProduct).toHaveBeenCalledTimes(1))
    expect(contentApi.createProduct).toHaveBeenCalledWith(CLIENT_ID, {
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'New page', slug: 'new-page',
    })
    expect(await screen.findByRole('dialog', { name: 'Edit New page' })).toBeVisible()
  })

  it('fails closed without products:view', async () => {
    useAuthStore.setState((state) => ({
      ...state,
      user: state.user ? { ...state.user, role: 'Viewer' } : null,
    }))
    // Viewer currently has products:view; use an absent authenticated user to
    // exercise the durable direct-navigation denial.
    useAuthStore.setState({ user: null })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ProductsPage />, { wrapper: wrapper(queryClient) })
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  })
})

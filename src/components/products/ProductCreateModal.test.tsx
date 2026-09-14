import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { contentApi } from '../../api/endpoints'
import type { Product } from '../../types/content'
import { ProductCreateModal } from './ProductCreateModal'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const created: Product = {
  id: '11111111-2222-3333-4444-555555555555', clientId: CLIENT_ID, name: 'Launch', slug: 'launch',
  status: 'active', publicationStatus: 'draft', revision: 1, contentSchemaVersion: null,
  contentRevision: 1, draftSchemaVersion: null, draftRevision: 0,
  completeness: { isComplete: false, missingRequirements: ['canonical_content'] }, canonicalUrl: null,
  createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
}

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ProductCreateModal', () => {
  it('prevents duplicate submission and shows pending acknowledgement', async () => {
    let resolve: ((value: Product) => void) | undefined
    vi.spyOn(contentApi, 'createProduct').mockReturnValue(new Promise((done) => { resolve = done }))
    const user = userEvent.setup()
    render(<ProductCreateModal clientId={CLIENT_ID} isOpen onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: Wrapper })
    await user.type(screen.getByLabelText('Product name'), 'Launch')
    await user.type(screen.getByLabelText('Product slug'), 'launch')
    const submit = screen.getByRole('button', { name: 'Create product' })
    await user.click(submit)
    expect(screen.getByRole('button', { name: 'Creating product…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Creating product…' }))
    expect(contentApi.createProduct).toHaveBeenCalledTimes(1)
    resolve?.(created)
  })

  it('retries an uncertain unchanged command with the same operation identity', async () => {
    const create = vi.spyOn(contentApi, 'createProduct')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'offline' })
      .mockResolvedValueOnce(created)
    const user = userEvent.setup()
    render(<ProductCreateModal clientId={CLIENT_ID} isOpen onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: Wrapper })
    await user.type(screen.getByLabelText('Product name'), 'Launch')
    await user.type(screen.getByLabelText('Product slug'), 'launch')
    await user.click(screen.getByRole('button', { name: 'Create product' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('result is uncertain')
    const firstOperationId = create.mock.calls[0]![1].operationId
    await user.click(screen.getByRole('button', { name: 'Create product' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]![1].operationId).toBe(firstOperationId)
  })
})

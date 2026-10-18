import { useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ProductRemovalHistory, ProductRemovalModal } from './ProductRemovalPanel'
import { useAuthStore } from '../../stores/authStore'
import { productRemovalApi } from '../../api/productRemovalApi'
import { parseRemovalPreview, parseRemovalReceipt, type RemovalCommand } from '../../api/productRemovalContracts'
import { client, product, preview, receipt } from '../../test/fixtures/productRemoval'
import { clearRemovalMaterial } from '../../queries/productRemovalMaterial'
import { readRemovalLocator, readRemovalLocators } from '../../queries/productRemovalLocator'
import { captureDomainScope } from '../../queries/domainScope'
import type { Product } from '../../types/content'

const second = '01990000-0000-7000-8000-000000000099'
function Host() {
  const heading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  return <><h1 ref={heading} tabIndex={-1}>Products</h1>
    <button onClick={() => setSelected(product)}>Remove A</button>
    <button onClick={() => setSelected(second)}>Remove B</button>
    {selected && <ProductRemovalModal key={selected} clientId={client}
      product={{ id: selected, clientId: client, name: selected === product ? 'Product' : 'Other', slug: 'product', status: 'active' } as Product}
      onClose={() => setSelected(null)} returnFocusRef={heading} />}
  </>
}
function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  clearRemovalMaterial()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/products')
  useAuthStore.setState({
    user: { id: '01990000-0000-7000-8000-000000000005', clientId: client, role: 'Admin', email: 'admin@example.test', displayName: 'Admin', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 },
    accessToken: 'token', isAuthenticated: true, isInitialized: true, isLoading: false,
  })
  vi.spyOn(productRemovalApi, 'preview').mockImplementation(async (_client, id) =>
    parseRemovalPreview(JSON.stringify({ ...preview, productId: id }), client, id))
})

it.each([503, 404])('preserves committed removal when cleanup refresh returns %s', async status => {
  const remove = vi.spyOn(productRemovalApi, 'remove').mockImplementation(async (_client, _product, command) =>
    ({ ...parseRemovalReceipt(JSON.stringify(receipt), client), operationId: command.operationId }))
  vi.spyOn(productRemovalApi, 'status').mockRejectedValue({ status, code: status === 404 ? 'product_not_found' : 'dependency_unavailable' })
  const user = userEvent.setup()
  render(<Host />, { wrapper: wrapper() })
  await user.click(screen.getByRole('button', { name: 'Remove A' }))
  await user.click(await screen.findByRole('button', { name: 'Delete product permanently' }))
  expect(await screen.findByRole('heading', { name: 'Product deleted: Product' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Check cleanup status' }))
  expect(await screen.findByText(/Deletion remains confirmed/)).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Product deleted: Product' })).toBeVisible()
  expect(screen.queryByText(/Outcome unknown/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry exact same request' })).not.toBeInTheDocument()
  expect(remove).toHaveBeenCalledTimes(1)
})

it.each([false, true])('recovers A after B and navigation without a new command (storage unavailable: %s)', async unavailable => {
  if (unavailable) {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled') })
  }
  const commands: Array<{ productId: string; command: RemovalCommand }> = []
  const remove = vi.spyOn(productRemovalApi, 'remove').mockImplementation(async (_client, productId, command) => {
    commands.push({ productId, command })
    throw { status: 503, code: 'dependency_unavailable' }
  })
  const user = userEvent.setup()
  const first = render(<Host />, { wrapper: wrapper() })
  for (const name of ['Remove A', 'Remove B']) {
    await user.click(screen.getByRole('button', { name }))
    await user.click(await screen.findByRole('button', { name: 'Delete product permanently' }))
    await screen.findByText(/Outcome unknown/)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  }
  expect(readRemovalLocators()).toHaveLength(2)
  expect(readRemovalLocator(product)?.operationId).toBe(commands[0]!.command.operationId)
  first.unmount()
  window.history.replaceState({}, '', '/products')
  render(<Host />, { wrapper: wrapper() })
  await user.click(screen.getByRole('button', { name: 'Remove A' }))
  expect(screen.queryByRole('button', { name: 'Delete product permanently' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check retained status' })).toBeVisible()
  expect(remove).toHaveBeenCalledTimes(2)
  await user.click(screen.getByRole('button', { name: 'Retry exact same request' }))
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(3))
  expect(commands[2]).toEqual(commands[0])
  expect(productRemovalApi.preview).toHaveBeenCalledTimes(2)
})

it('reload recovery discovers all URL locators and session-only material without sending DELETE', async () => {
  const operationB = '01990000-0000-7000-8000-000000000088'
  window.history.replaceState({}, '', `/products?productRemoval=${receipt.operationId}&removedProduct=${product}&productRemoval=${operationB}&removedProduct=${second}`)
  const command: RemovalCommand = { operationId: receipt.operationId, expectedRevision: '1', policyVersion: 'product-removal-v1', previewFingerprint: preview.previewFingerprint }
  sessionStorage.setItem(`backoffice:product-removal:${client}:${product}:${receipt.operationId}`, JSON.stringify({ actor: useAuthStore.getState().user!.id, role: 'Admin', command }))
  const remove = vi.spyOn(productRemovalApi, 'remove').mockRejectedValue({ status: 503, code: 'dependency_unavailable' })
  const status = vi.spyOn(productRemovalApi, 'status').mockRejectedValue({ status: 404, code: 'product_not_found' })
  vi.spyOn(productRemovalApi, 'list').mockResolvedValue({ items: [], page: '1', pageSize: '20', totalCount: '0', totalPages: '0' })
  const history = render(<ProductRemovalHistory scope={captureDomainScope()} />, { wrapper: wrapper() })
  await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
  expect(status.mock.calls.map(call => call[1]).sort()).toEqual([receipt.operationId, operationB].sort())
  expect(screen.getAllByRole('button', { name: 'Check earlier request' })).toHaveLength(2)
  expect(remove).not.toHaveBeenCalled()
  history.unmount()
  const user = userEvent.setup()
  render(<Host />, { wrapper: wrapper() })
  await user.click(screen.getByRole('button', { name: 'Remove A' }))
  expect(screen.queryByRole('button', { name: 'Delete product permanently' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry exact same request' }))
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  expect(remove.mock.calls[0]![2]).toEqual(command)
})

it('retains GET-only recovery for every URL locator after command material is unavailable', async () => {
  window.history.replaceState({}, '', `/products?productRemoval=${receipt.operationId}&removedProduct=${product}&productRemoval=01990000-0000-7000-8000-000000000088&removedProduct=${second}`)
  const remove = vi.spyOn(productRemovalApi, 'remove')
  vi.spyOn(productRemovalApi, 'status').mockRejectedValue({ status: 404, code: 'product_not_found' })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled') })
  const user = userEvent.setup()
  render(<Host />, { wrapper: wrapper() })
  for (const name of ['Remove A', 'Remove B']) {
    await user.click(screen.getByRole('button', { name }))
    expect(screen.queryByRole('button', { name: 'Delete product permanently' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry exact same request' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check retained status' }))
    expect(await screen.findByText(/No visible committed result/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  }
  expect(remove).not.toHaveBeenCalled()
})

it('recovers by canonical retained GET when preview reports the Product was removed', async () => {
  vi.spyOn(productRemovalApi, 'preview').mockRejectedValue({ status: 409, code: 'product_removed', problemDetails: { statusUrl: receipt.statusUrl } })
  const remove = vi.spyOn(productRemovalApi, 'remove')
  const status = vi.spyOn(productRemovalApi, 'status').mockResolvedValue(parseRemovalReceipt(JSON.stringify(receipt), client))
  const user = userEvent.setup()
  render(<Host />, { wrapper: wrapper() })
  await user.click(screen.getByRole('button', { name: 'Remove A' }))
  await user.click(await screen.findByRole('button', { name: 'Check retained status' }))
  expect(await screen.findByRole('heading', { name: 'Product deleted: Product' })).toBeVisible()
  expect(status).toHaveBeenCalledWith(client, receipt.operationId, expect.any(AbortSignal))
  expect(readRemovalLocator(product)?.operationId).toBe(receipt.operationId)
  expect(remove).not.toHaveBeenCalled()
})

it.each([
  receipt.statusUrl.replace(client, second),
  `https://foreign.example${receipt.statusUrl}`,
  `${receipt.statusUrl}?redirect=elsewhere`,
  `${receipt.statusUrl}/extra`,
  receipt.statusUrl.replace('-7000-', '-4000-'),
])('rejects noncanonical or foreign preview recovery URL: %s', async statusUrl => {
  vi.spyOn(productRemovalApi, 'preview').mockRejectedValue({ status: 409, code: 'product_removed', problemDetails: { statusUrl } })
  const status = vi.spyOn(productRemovalApi, 'status')
  const user = userEvent.setup()
  render(<Host />, { wrapper: wrapper() })
  await user.click(screen.getByRole('button', { name: 'Remove A' }))
  await screen.findByText('The dependency preview could not be verified. Deletion is disabled.')
  expect(screen.queryByRole('button', { name: 'Check retained status' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete product permanently' })).toBeDisabled()
  expect(status).not.toHaveBeenCalled()
  expect(readRemovalLocators()).toEqual([])
})

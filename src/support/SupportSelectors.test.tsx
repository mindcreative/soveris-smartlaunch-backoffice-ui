import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { SupportRequestForm } from './SupportRequestForm'
import { supportApi } from './client'
import { supportAuthority } from './authority'
import { createUuidV7 } from '../lib/uuidV7'
import { resetSupportDraft } from './draft'

vi.mock('./client', () => ({ supportApi: { customers: vi.fn(), products: vi.fn() } }))
const customer = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
const other = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d6'
const product = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d5'
beforeEach(() => {
  resetSupportDraft()
  supportAuthority.retire()
  vi.clearAllMocks()
  vi.mocked(supportApi.customers).mockResolvedValue({ items: [{ id: customer, name: 'Customer A' }, { id: other, name: 'Customer B' }], nextCursor: null })
  vi.mocked(supportApi.products).mockResolvedValue({ items: [{ id: product, name: 'Named product', slug: 'named' }], nextCursor: null })
})

it('AV10 customer and product dropdowns preserve unsent input and clear dependent products immediately on customer change', async () => {
  const user = userEvent.setup()
  const create = vi.fn()
  render(<SupportRequestForm pending={false} blocked={false} create={create} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await user.click(await screen.findByRole('option', { name: 'Named product · named' }))
  await user.type(screen.getByLabelText('Support reason'), 'Unsent input')
  await user.type(screen.getByLabelText('Support case reference'), 'case:selectors')
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer B' }))
  expect(screen.getByLabelText('Support reason')).toHaveValue('Unsent input')
  expect(screen.queryByRole('option', { name: 'Named product · named' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Request exact scope' }))
  expect(create).not.toHaveBeenCalled()
})

it('AV10 rejects an old A response after A to B to A even when abort is ignored', async () => {
  const user = userEvent.setup()
  let finish!: (value: { items: { id: string; name: string; slug: string }[]; nextCursor: null }) => void
  vi.mocked(supportApi.products).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await waitFor(() => expect(supportApi.products).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer B' }))
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await act(async () => finish({ items: [{ id: product, name: 'Stale private label', slug: 'old' }], nextCursor: null }))
  expect(screen.queryByText(/Stale private label/)).toBeNull()
})

it('AV10 blocks indistinguishable customer names without introducing extra lookup fields', async () => {
  vi.mocked(supportApi.customers).mockResolvedValue({ items: [{ id: customer, name: 'Same name' }, { id: other, name: 'Same name' }], nextCursor: null })
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  const radios = await screen.findAllByRole('option')
  expect(radios).toHaveLength(2)
  expect(radios.every(radio => radio.getAttribute('aria-disabled') === 'true')).toBe(true)
  expect(screen.getByText(/indistinguishable/)).toBeVisible()
})

it('AV10 permits twenty named selections and disables a twenty-first selection on the next page', async () => {
  const items = Array.from({ length: 21 }, (_, index) => ({ id: createUuidV7(), name: 'Bounded product ' + (index + 1), slug: 'bounded-' + (index + 1) }))
  vi.mocked(supportApi.products).mockResolvedValueOnce({ items: items.slice(0, 20), nextCursor: 'owned_cursor' })
    .mockResolvedValueOnce({ items: items.slice(20), nextCursor: null })
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await screen.findByRole('option', { name: 'Bounded product 1 · bounded-1' })

  for (let index = 1; index <= 20; index++) {
    await user.click(screen.getByRole('option', { name: 'Bounded product ' + index + ' · bounded-' + index }))
  }

  await user.click(screen.getByRole('button', { name: 'Next options' }))
  expect(await screen.findByRole('option', { name: 'Bounded product 21 · bounded-21' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('option', { name: 'Bounded product 1 · bounded-1' })).toBeNull()
  expect(screen.getAllByRole('button', { name: /^Remove /  })).toHaveLength(20)
})

it('AV10 recovers a retained page-two selection from current authorized pages after retirement', async () => {
  const first = { id: product, name: 'Product First', slug: 'first' }
  const second = { id: other, name: 'Product Second', slug: 'second' }
  vi.mocked(supportApi.products).mockImplementation(async (_customer, cursor) => cursor
    ? { items: [second], nextCursor: null } : { items: [first], nextCursor: 'page-two' })
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await screen.findByRole('option', { name: 'Product First · first' })
  await user.click(screen.getByRole('button', { name: 'Next options' }))
  await user.click(await screen.findByRole('option', { name: 'Product Second · second' }))
  await user.type(screen.getByLabelText('Support reason'), 'Unsent reason')
  await user.type(screen.getByLabelText('Support case reference'), 'case:page-two')
  expect(screen.getByRole('button', { name: 'Request exact scope' })).toBeEnabled()
  act(() => supportAuthority.retire())
  expect(screen.getByRole('button', { name: 'Request exact scope' })).toBeDisabled()
  expect(screen.getAllByText('Selection 1: label unavailable')[0]).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await screen.findByRole('option', { name: 'Customer A' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Products' })).toBeEnabled())
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await screen.findByRole('option', { name: 'Product First · first' })
  await user.click(screen.getByRole('button', { name: 'Next options' }))
  expect(await screen.findByRole('option', { name: 'Product Second · second' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByLabelText('Support reason')).toHaveValue('Unsent reason')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Request exact scope' })).toBeEnabled())
  expect(screen.queryByText('Selection 1: label unavailable')).toBeNull()
})

it('UX02 D8 opens authorized available customers without a query or any search field', async () => {
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  expect(screen.queryByLabelText('Search customers')).toBeNull()
  expect(await screen.findByRole('option', { name: 'Customer A' })).toHaveAttribute('aria-disabled', 'false')
  expect(supportApi.customers).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
})

it('UX06 reaches option 525 through bounded replace pages without preloading or a terminal cap', async () => {
  const all = Array.from({ length: 525 }, (_, index) => ({ id: createUuidV7(), name: `Customer ${String(index + 1).padStart(3, '0')}` }))
  vi.mocked(supportApi.customers).mockImplementation(async cursor => {
    const offset = cursor ? Number(cursor) : 0
    return { items: all.slice(offset, offset + 20), nextCursor: offset + 20 < all.length ? String(offset + 20) : null }
  })
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  expect(supportApi.customers).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  for (let offset = 0; offset < 520; offset += 20) {
    await screen.findByRole('option', { name: all[offset]!.name })
    expect(screen.getAllByRole('option')).toHaveLength(20)
    await user.click(screen.getByRole('button', { name: 'Next options' }))
  }
  await user.click(await screen.findByRole('option', { name: 'Customer 525' }))
  expect(screen.getByRole('combobox', { name: 'Customer' })).toHaveTextContent('Customer 525')
  expect(supportApi.customers).toHaveBeenCalledTimes(27)
})

it('UX24 keyboard focuses options, explicit paging, Escape and removal without submitting', async () => {
  const user = userEvent.setup()
  const create = vi.fn()
  render(<SupportRequestForm pending={false} blocked={false} create={create} />)
  const customerControl = screen.getByRole('combobox', { name: 'Customer' })
  customerControl.focus()
  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('listbox')).toHaveFocus()
  await user.keyboard('{Home}{Enter}')
  expect(customerControl).toHaveFocus()
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  expect(await screen.findByRole('listbox')).toHaveFocus()
  await user.keyboard(' {Escape}')
  expect(screen.getByRole('combobox', { name: 'Products' })).toHaveTextContent('1 of 20')
  await user.click(screen.getByRole('button', { name: 'Remove Named product · named' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Products' })).toHaveFocus())
  await user.click(customerControl)
  await screen.findByRole('option', { name: 'Customer A' })
  await user.tab()
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(create).not.toHaveBeenCalled()
})

it('UX07 same-customer reselection preserves independent selected products after reopening', async () => {
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  await user.click(await screen.findByRole('option', { name: 'Named product · named' }))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.click(await screen.findByRole('option', { name: 'Customer A' }))
  expect(screen.getByRole('combobox', { name: 'Products' })).toHaveTextContent('1 of 20')
  await user.click(screen.getByRole('combobox', { name: 'Products' }))
  expect(await screen.findByRole('option', { name: 'Named product · named' })).toHaveAttribute('aria-selected', 'true')
})

it.each([403, 429, 503])('UX21 UX22 UX23 lookup %s is a failure, never an empty result or automatic retry', async status => {
  const { SupportAccessError } = await import('./errors')
  vi.mocked(supportApi.customers).mockRejectedValueOnce(new SupportAccessError(status, status === 429 ? 1 : 0))
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  const retry = await screen.findByRole('button', { name: 'Retry customers' })
  expect(screen.queryByText('No customers available')).toBeNull()
  expect(screen.queryByRole('option')).toBeNull()
  expect(supportApi.customers).toHaveBeenCalledTimes(1)
  if (status === 429) {
    expect(retry).toBeDisabled()
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 2500 })
    expect(supportApi.customers).toHaveBeenCalledTimes(1)
  }
  await user.click(retry)
  expect(await screen.findByRole('option', { name: 'Customer A' })).toBeVisible()
  expect(supportApi.customers).toHaveBeenCalledTimes(2)
})

it('UX21 query-free opening distinguishes pending and a successful empty eligible list', async () => {
  let finish!: (value: { items: []; nextCursor: null }) => void
  vi.mocked(supportApi.customers).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  expect(screen.getByText('Loading customers…')).toBeVisible()
  expect(screen.queryByText('No customers available')).toBeNull()
  await act(async () => finish({ items: [], nextCursor: null }))
  expect(screen.getByText('No customers available')).toBeVisible()
  expect(screen.queryByRole('option')).toBeNull()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('combobox', { name: 'Customer' })).toHaveFocus()
})

it('UX28 close reopen and security generation reject late customer pages even when abort is ignored', async () => {
  const finish: ((value: { items: { id: string; name: string }[]; nextCursor: null }) => void)[] = []
  vi.mocked(supportApi.customers).mockImplementation(() => new Promise(resolve => finish.push(resolve)))
  const user = userEvent.setup()
  render(<SupportRequestForm pending={false} blocked={false} create={vi.fn()} />)
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('combobox', { name: 'Customer' }))
  await waitFor(() => expect(finish).toHaveLength(2))
  await act(async () => finish[0]!({ items: [{ id: customer, name: 'Closed stale label' }], nextCursor: null }))
  act(() => supportAuthority.retire())
  await act(async () => finish[1]!({ items: [{ id: customer, name: 'Security stale label' }], nextCursor: null }))
  expect(screen.queryByText(/stale label/)).toBeNull()
})

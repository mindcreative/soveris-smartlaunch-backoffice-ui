import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UsersPage from './UsersPage'

const create = vi.hoisted(() => vi.fn().mockResolvedValue({}))

vi.mock('@/hooks/useQueryHooks', () => ({
  useUsers: () => ({ data: { data: [] }, isLoading: false, error: null }),
  useCreateUser: () => ({ mutateAsync: create, isPending: false }),
  useDeactivateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('user creation timezone', () => {
  it('requires an explicit IANA selection in the create request', async () => {
    const user = userEvent.setup()
    render(<UsersPage />)
    await user.click(screen.getByRole('button', { name: 'Create User' }))
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@example.com' } })
    expect(screen.getByPlaceholderText('user@example.com')).toHaveValue('new@example.com')
    await user.type(screen.getByPlaceholderText('John Doe'), 'New User')
    await user.type(screen.getByPlaceholderText('Min. 8 characters'), 'Password123')
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Create User' })
    expect(submit).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('IANA timezone *'), 'UTC')
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ timeZoneId: 'UTC' })))
  })
})

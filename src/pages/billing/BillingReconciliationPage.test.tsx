import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { BillingReconciliationPage } from './BillingReconciliationPage'
import { useAuth } from '../../hooks/useAuth'
import { queryReconciliation, findFreshReconciliationCase } from '../../api/reconciliationApi'
import { CLIENT, reconciliationFixture } from '../../test/reconciliationFixture'
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../api/reconciliationApi', async original => ({ ...await original<typeof import('../../api/reconciliationApi')>(), queryReconciliation: vi.fn(), findFreshReconciliationCase: vi.fn(), resolveReconciliation: vi.fn() }))
function setup(allowed = true) {
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'actor', clientId: CLIENT, role: 'Admin' }, accessToken: 'session', isAuthenticated: true, hasPermission: () => allowed } as never)
  const page = reconciliationFixture()
  vi.mocked(queryReconciliation).mockResolvedValue(page)
  vi.mocked(findFreshReconciliationCase).mockResolvedValue({ item: page.items[0]!, evaluatedAt: page.evaluatedAt })
  const content = () => <MemoryRouter initialEntries={[`/billing/clients/${CLIENT}/reconciliation`]}><Routes><Route path="/billing/clients/:clientId/reconciliation" element={<BillingReconciliationPage />} /></Routes></MemoryRouter>
  const view = render(content())
  return { ...view, rerenderWorkspace: () => view.rerender(content()) }
}
describe('reconciliation workspace', () => {
  it('names filters and confirmation financial effect; links required reason validation', async () => {
    setup(); const user = userEvent.setup()
    await screen.findAllByRole('button', { name: /Inspect case/ })
    await user.click(screen.getAllByRole('button', { name: /Inspect case/ })[0]!)
    await user.click(screen.getByRole('button', { name: 'Release confirmed non-execution' }))
    await screen.findByRole('dialog', { name: 'Confirm case action' })
    expect(screen.getByText(/Return the 2.2500 abstract Soveris credit hold/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm resolution' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    await user.click(screen.getByRole('link', { name: /Reason:/ }))
    expect(screen.getByRole('textbox', { name: 'Reason (required)' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('does not request data without exact permission', () => {
    vi.mocked(queryReconciliation).mockClear(); setup(false)
    expect(screen.getByText(/billing:reconcile/)).toBeInTheDocument()
    expect(queryReconciliation).not.toHaveBeenCalled()
  })
  it('purges open private details when permission is lost', async () => {
    const view = setup()
    await screen.findAllByRole('button', { name: /Inspect case/ })
    await userEvent.click(screen.getAllByRole('button', { name: /Inspect case/ })[0]!)
    expect(screen.getByRole('heading', { name: 'Immutable case evidence' })).toBeInTheDocument()
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'actor', clientId: CLIENT, role: 'Viewer' }, isAuthenticated: true, hasPermission: () => false } as never)
    view.rerender(<MemoryRouter><BillingReconciliationPage /></MemoryRouter>)
    expect(screen.queryByRole('heading', { name: 'Immutable case evidence' })).not.toBeInTheDocument()
  })
})

describe('authority and navigation private-state isolation', () => {
  it('clears confirmation and reason synchronously on automatic auth refresh', async () => {
    setup(); const user = userEvent.setup()
    await screen.findAllByRole('button', { name: /Inspect case/ })
    await user.click(screen.getAllByRole('button', { name: /Inspect case/ })[0]!)
    await user.click(screen.getByRole('button', { name: 'Release confirmed non-execution' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByRole('textbox', { name: 'Reason (required)' }), 'Private audit reason')
    const { act } = await import('@testing-library/react')
    act(() => window.dispatchEvent(new CustomEvent('auth:refreshed')))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Private audit reason')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Immutable case evidence' })).not.toBeInTheDocument()
  })
  it('aborts and ignores an obsolete fresh-state response after an actor change', async () => {
    const view = setup(); const user = userEvent.setup()
    await screen.findAllByRole('button', { name: /Inspect case/ })
    await user.click(screen.getAllByRole('button', { name: /Inspect case/ })[0]!)
    let requestedSignal: AbortSignal | undefined
    let complete!: (value: Awaited<ReturnType<typeof findFreshReconciliationCase>>) => void
    vi.mocked(findFreshReconciliationCase).mockImplementation(async (_client, _finding, signal) => { requestedSignal = signal; return new Promise(resolve => { complete = resolve }) })
    await user.click(screen.getByRole('button', { name: 'Release confirmed non-execution' }))
    await waitFor(() => expect(requestedSignal).toBeDefined())
    const { act } = await import('@testing-library/react')
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'new-actor', clientId: CLIENT, role: 'Admin' }, accessToken: 'another-session', isAuthenticated: true, hasPermission: () => true } as never)
    view.rerenderWorkspace()
    expect(requestedSignal!.aborted).toBe(true)
    const fixture = reconciliationFixture()
    await act(() => { complete({ item: fixture.items[0]!, evaluatedAt: fixture.evaluatedAt }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

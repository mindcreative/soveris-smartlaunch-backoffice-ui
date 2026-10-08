import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const actorClient = '98b71ac3-7f62-4ac8-9b28-30444993a001'
const selectedClient = '0149620b-af5c-47c9-8290-95edde45ef8f'

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { clientId: '98b71ac3-7f62-4ac8-9b28-30444993a001', role: 'Admin' },
    hasPermission: () => true,
  }),
}))

function CurrentRoute() {
  return <output data-testid="current-route">{useLocation().pathname}</output>
}

describe('Billing sidebar Client context', () => {
  it.each(['account', 'adjustments', 'ledger', 'subscriptions', 'reconciliation'])(
    'keeps the selected Client when returning to Account from %s', (section) => {
      render(<MemoryRouter initialEntries={[`/billing/clients/${selectedClient}/${section}`]}>
        <Sidebar /><CurrentRoute />
      </MemoryRouter>)

      fireEvent.click(screen.getByRole('link', { name: 'Billing' }))

      expect(screen.getByTestId('current-route')).toHaveTextContent(
        `/billing/clients/${selectedClient}/account`)
      expect(screen.getByTestId('current-route')).not.toHaveTextContent(actorClient)
    })

  it.each(['/dashboard', '/billing', '/billing/clients/invalid/account'])(
    'opens the actor Client when no valid Billing Client is selected at %s', (path) => {
      render(<MemoryRouter initialEntries={[path]}><Sidebar /><CurrentRoute /></MemoryRouter>)

      fireEvent.click(screen.getByRole('link', { name: 'Billing' }))

      expect(screen.getByTestId('current-route')).toHaveTextContent(`/billing/clients/${actorClient}/account`)
    })
})

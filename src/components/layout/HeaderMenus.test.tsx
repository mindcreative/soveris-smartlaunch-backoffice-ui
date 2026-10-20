import { clientFixturePermissions } from '../../test/authorityFixtures'
import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'
import { AppearanceProvider } from '../../appearance/AppearanceProvider'
const logout = vi.fn()
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { displayName: 'Operator', email: 'operator@example.test', role: 'ClientAdmin', permissions: clientFixturePermissions }, logout }) }))
beforeEach(() => { localStorage.clear() })
function setup() {
  render(<MemoryRouter initialEntries={['/domains']}><AppearanceProvider userId="test-user"><TopBar onOpenMobileNavigation={() => {}} menuButtonRef={createRef()} /></AppearanceProvider><button>Outside</button></MemoryRouter>)
  return userEvent.setup()
}
it('opens Appearance by keyboard, arrows/Home/End select and Escape restores focus', async () => {
  const user = setup(), trigger = screen.getByRole('button', { name: 'Appearance' })
  trigger.focus(); await user.keyboard('{Enter}')
  expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus()
  await user.keyboard('{End}'); expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus()
  await user.keyboard('{Home}{ArrowDown}{Enter}')
  expect(document.documentElement.dataset.theme).toBe('light'); expect(trigger).toHaveFocus()
  await user.click(trigger); expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  await user.keyboard('{Escape}'); expect(trigger).toHaveFocus(); expect(screen.queryByRole('menu')).toBeNull()
})
it('shows one identity menu and mutually excludes menus; outside click keeps target focus', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Appearance' }))
  await user.click(screen.getByRole('button', { name: /User menu/ }))
  expect(screen.queryByRole('menu', { name: 'Appearance' })).toBeNull()
  expect(screen.getByRole('menu', { name: 'User menu' })).toHaveTextContent('operator@example.test')
  expect(screen.getByText('ClientAdmin')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus(); expect(screen.queryByRole('menu')).toBeNull()
  await user.click(screen.getByRole('button', { name: /User menu/ }))
  await user.click(screen.getByRole('menuitem', { name: 'Logout' })); expect(logout).toHaveBeenCalledOnce()
})
it('Tab closes and continues normal focus order; reports failed save', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Appearance' }))
  await user.keyboard('{Tab}'); expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('button', { name: /User menu/ })).toHaveFocus()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked') })
  await user.click(screen.getByRole('button', { name: 'Appearance' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
  expect(screen.getByRole('status')).toHaveTextContent('could not be saved')
})
it('switches menus through activation without pointerdown and keeps focus in the new menu', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Appearance' }))
  fireEvent.click(screen.getByRole('button', { name: /User menu/ }))
  expect(screen.getByRole('menu', { name: 'User menu' })).toBeVisible()
  expect(screen.getByRole('menuitem', { name: 'Logout' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  expect(screen.getByRole('menu', { name: 'Appearance' })).toBeVisible()
  expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus()
})
it('dismisses a focused tooltip with Escape while retaining trigger focus', async () => {
  const user = setup(), trigger = screen.getByRole('button', { name: 'Appearance' })
  act(() => trigger.focus())
  expect(document.querySelector('.header-tooltip-content')).toHaveTextContent('Appearance')
  await user.keyboard('{Escape}')
  expect(document.querySelector('.header-tooltip')).toBeNull()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger).toHaveFocus()
})

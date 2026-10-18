import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { toast, ToastContainer } from 'react-toastify'
import { AppearanceProvider, useAppearance } from './AppearanceProvider'
import { NotificationClose, NotificationIcon } from './NotificationIcon'
function Notifications() {
  const { mode, setPreference } = useAppearance()
  return <><button onClick={() => setPreference('dark')}>Dark</button><ToastContainer theme={mode} icon={NotificationIcon} closeButton={NotificationClose} autoClose={false} /></>
}
it('preserves an existing notification across appearance updates with named Lucide close control', async () => {
  render(<AppearanceProvider userId="test-user"><Notifications /></AppearanceProvider>)
  act(() => { toast.success('Saved result', { toastId: 'stable' }) })
  const alert = await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  expect(screen.getByRole('alert')).toBe(alert)
  expect(alert).toHaveTextContent('Saved result')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByRole('button', { name: 'Close notification' })).toHaveAttribute('title', 'Close notification')
  expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  act(() => { toast.dismiss() })
})

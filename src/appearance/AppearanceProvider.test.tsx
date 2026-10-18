import { StrictMode, useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { AppearanceProvider, useAppearance } from './AppearanceProvider'

let dark = false
let listeners: Set<() => void>
beforeEach(() => {
  localStorage.clear(); dark = false; listeners = new Set()
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }))
})
function Consumer({ mounted }: { mounted?: () => void }) {
  const appearance = useAppearance()
  const [draft, setDraft] = useState('')
  useEffect(() => { mounted?.() }, [mounted])
  return <><output>{appearance.preference}/{appearance.mode}/{String(appearance.saveFailed)}</output>
    <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
    {(['light', 'dark', 'system'] as const).map(p => <button key={p} onClick={() => appearance.setPreference(p)}>{p}</button>)}
  </>
}
it('follows live System, ignores OS overrides, returns to System without remounting or losing draft', () => {
  const mounted = vi.fn()
  render(<AppearanceProvider userId="test-user"><Consumer mounted={mounted} /></AppearanceProvider>)
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'preserved' } })
  act(() => { dark = true; listeners.forEach(fn => fn()) })
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.click(screen.getByText('light', { selector: 'button' }))
  act(() => { dark = false; listeners.forEach(fn => fn()); dark = true; listeners.forEach(fn => fn()) })
  expect(screen.getByRole('status')).toHaveTextContent('light/light/false')
  fireEvent.click(screen.getByText('system', { selector: 'button' }))
  expect(document.documentElement.style.colorScheme).toBe('dark')
  expect(screen.getByLabelText('Draft')).toHaveValue('preserved'); expect(mounted).toHaveBeenCalledTimes(1)
})
it('keeps an unsaved explicit choice in memory', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked') })
  render(<AppearanceProvider userId="test-user"><Consumer /></AppearanceProvider>)
  fireEvent.click(screen.getByText('dark', { selector: 'button' }))
  expect(screen.getByRole('status')).toHaveTextContent('dark/dark/true')
  expect(document.documentElement.dataset.theme).toBe('dark')
})
it('cleans subscriptions under StrictMode and unmount', () => {
  const view = render(<StrictMode><AppearanceProvider userId="test-user"><Consumer /></AppearanceProvider></StrictMode>)
  expect(listeners.size).toBe(1); view.unmount(); expect(listeners.size).toBe(0)
})
it('safely defaults to Light without a media API', () => {
  vi.stubGlobal('matchMedia', undefined)
  render(<AppearanceProvider userId="test-user"><Consumer /></AppearanceProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
})
it('uses separate account preferences and restores System at logout without remounting content', () => {
  const mounted = vi.fn()
  const tree = (userId: string | null) => <AppearanceProvider userId={userId}><Consumer mounted={mounted} /></AppearanceProvider>
  const view = render(tree('account-a'))
  fireEvent.click(screen.getByText('dark', { selector: 'button' }))
  view.rerender(tree(null))
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
  view.rerender(tree('account-b'))
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
  fireEvent.click(screen.getByText('light', { selector: 'button' }))
  view.rerender(tree('account-a'))
  expect(screen.getByRole('status')).toHaveTextContent('dark/dark/false')
  expect(mounted).toHaveBeenCalledTimes(1)
})
it('does not inherit legacy global preference and does not allow anonymous overrides', () => {
  localStorage.setItem('soveris-backoffice-appearance', 'dark')
  render(<AppearanceProvider userId={null}><Consumer /></AppearanceProvider>)
  fireEvent.click(screen.getByText('dark', { selector: 'button' }))
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
  act(() => { dark = true; listeners.forEach(fn => fn()) })
  expect(screen.getByRole('status')).toHaveTextContent('system/dark/false')
})
it('clears an unsaved override and save error across account/logout boundaries', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked') })
  const view = render(<AppearanceProvider userId="account-a"><Consumer /></AppearanceProvider>)
  fireEvent.click(screen.getByText('dark', { selector: 'button' }))
  expect(screen.getByRole('status')).toHaveTextContent('dark/dark/true')
  view.rerender(<AppearanceProvider userId="account-b"><Consumer /></AppearanceProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
  view.rerender(<AppearanceProvider userId={null}><Consumer /></AppearanceProvider>)
  view.rerender(<AppearanceProvider userId="account-a"><Consumer /></AppearanceProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('system/light/false')
})

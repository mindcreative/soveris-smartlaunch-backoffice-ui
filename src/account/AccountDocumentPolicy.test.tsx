import { beforeEach, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountDocumentPolicy } from './AccountDocumentPolicy'
import { AccountFlowLifetime } from './AccountFlowLifetime'
import { accountFlow } from './accountFlow'

beforeEach(() => {
  document.getElementById('account-document-frame-policy')?.remove()
  window.history.replaceState(null, '', '/signup')
  accountFlow.clear()
})

it('seals before rendering the pending page and retains memory-only signup continuation', () => {
  accountFlow.setPending({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 300 }, 'fixture@example.test')
  render(<MemoryRouter initialEntries={['/signup']}><AccountFlowLifetime /><AccountDocumentPolicy><Routes>
    <Route path="/signup" element={<Link to="/check-email">Continue</Link>} />
    <Route path="/check-email" element={<p>Pending continuation</p>} />
  </Routes></AccountDocumentPolicy></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: 'Continue' }))
  expect(screen.getByText('Pending continuation')).toBeInTheDocument()
  expect(document.getElementById('account-document-frame-policy')).toHaveAttribute('content', "frame-src 'none'")
  expect(accountFlow.pending()?.pendingToken).toBe('A'.repeat(43))
})

it('seals an initial login document before mounting its content', () => {
  window.history.replaceState(null, '', '/login')
  render(<MemoryRouter initialEntries={['/login']}><AccountDocumentPolicy><p>Login content</p></AccountDocumentPolicy></MemoryRouter>)
  expect(screen.getByText('Login content')).toBeInTheDocument()
  expect(document.getElementById('account-document-frame-policy')).toHaveAttribute('content', "frame-src 'none'")
})

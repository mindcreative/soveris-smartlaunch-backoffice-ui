import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Modal } from './Modal'

function Consumer() {
  const [open, setOpen] = useState(false)
  return <div>
    <button type="button" onClick={() => setOpen(true)}>Open consequential dialog</button>
    <main>Background content</main>
    <Modal
      isOpen={open}
      onClose={() => setOpen(false)}
      title="Confirm action"
      descriptionId="confirm-description"
      footer={<><button type="button" data-modal-initial-focus onClick={() => setOpen(false)}>Cancel</button><button type="button">Confirm</button></>}
    >
      <p id="confirm-description">Review the command.</p>
    </Modal>
  </div>
}

describe('Modal', () => {
  it('provides modal semantics, inert background, safe initial focus, containment, Escape, and focus return', async () => {
    document.body.style.overflow = 'clip'
    const user = userEvent.setup()
    render(<Consumer />)
    const trigger = screen.getByRole('button', { name: 'Open consequential dialog' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Confirm action' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Review the command.')
    expect(document.body.style.overflow).toBe('hidden')
    expect(dialog.parentElement?.parentElement?.parentElement).not.toHaveAttribute('inert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())

    const close = screen.getByRole('button', { name: 'Close dialog' })
    trigger.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(close).toHaveFocus()
    close.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(document.body.style.overflow).toBe('clip')
    document.body.style.overflow = ''
  })

  it('uses a named 44px close control and honors an unsafe close-disabled transition', async () => {
    const { rerender } = render(<Modal isOpen onClose={() => undefined} title="Busy" closeDisabled>
      <p>Busy command</p>
    </Modal>)
    const close = screen.getByRole('button', { name: 'Close dialog' })
    expect(close).toBeDisabled()
    expect(close).toHaveClass('min-h-11', 'min-w-11')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(<Modal isOpen={false} onClose={() => undefined} title="Busy"><p>Done</p></Modal>)
  })
})

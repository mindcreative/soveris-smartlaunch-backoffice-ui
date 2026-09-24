import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { FormErrorSummary } from './FormErrorSummary'

describe('FormErrorSummary', () => {
  it('is focusable, names every error, and moves focus to the linked field', async () => {
    const summaryRef = createRef<HTMLDivElement>()
    render(<>
      <FormErrorSummary ref={summaryRef} errors={[
        { fieldId: 'amount', label: 'Adjustment amount', message: 'Enter a non-zero amount.' },
      ]} />
      <label htmlFor="amount">Adjustment amount</label><input id="amount" />
    </>)
    summaryRef.current?.focus()
    expect(screen.getByRole('alert')).toHaveFocus()
    await userEvent.click(screen.getByRole('link', { name: /Adjustment amount/ }))
    expect(screen.getByLabelText('Adjustment amount')).toHaveFocus()
  })
})

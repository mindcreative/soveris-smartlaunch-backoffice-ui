import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditAmount } from './CreditAmount'

describe('CreditAmount', () => {
  it('groups an exact decimal string without numeric coercion or currency', () => {
    render(<CreditAmount value="99999999999999.9999" />)

    expect(screen.getByText('99,999,999,999,999.9999')).toBeInTheDocument()
    expect(screen.getByText('abstract credits')).toBeInTheDocument()
    expect(screen.queryByText(/[$€£]|USD|EUR/)).not.toBeInTheDocument()
  })

  it('preserves zero scale', () => {
    render(<CreditAmount value="0.0000" />)
    expect(screen.getByText('0.0000')).toBeInTheDocument()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  addUtcCalendarMonths,
  SubscriptionCreationForm,
  utcInputToInstant,
  validateSubscriptionDraft,
} from './SubscriptionCreationForm'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const NOW = Date.parse('2026-02-15T12:00:00.000Z')

describe('UTC subscription calendar helpers', () => {
  it.each([
    ['2025-01-29T10:15:00.000000Z', 1, '2025-02-28T10:15:00.000000Z'],
    ['2024-01-30T10:15:00.000000Z', 1, '2024-02-29T10:15:00.000000Z'],
    ['2024-01-31T10:15:00.000000Z', 2, '2024-03-31T10:15:00.000000Z'],
    ['2024-02-29T10:15:00.000000Z', 12, '2025-02-28T10:15:00.000000Z'],
    ['2026-12-31T23:59:59.123456Z', 1, '2027-01-31T23:59:59.123456Z'],
  ])('adds calendar months directly from %s', (from, count, expected) => {
    expect(addUtcCalendarMonths(from, count)).toBe(expected)
  })

  it('parses declared UTC components without applying the browser timezone', () => {
    expect(utcInputToInstant('2026-02-15T12:34')).toBe('2026-02-15T12:34:00.000000Z')
    expect(utcInputToInstant('2024-02-29T23:59:59.12')).toBe('2024-02-29T23:59:59.120000Z')
    expect(() => utcInputToInstant('2025-02-29T12:00')).toThrow('UTC')
  })

  it('requires exact amount/rates/features and an aligned optional end boundary', () => {
    const result = validateSubscriptionDraft({
      planName: ' Pro ', cycleCreditAmount: '100000000000000.0000',
      requestsPerMinute: '0', concurrentAiOperations: '1001',
      contentGeneration: false, imageGeneration: false,
      validFrom: '2026-02-15T12:00', validTo: '2026-03-16T12:00',
    }, NOW)
    expect(result.errors).toMatchObject({
      planName: expect.any(String), cycleCreditAmount: expect.any(String),
      requestsPerMinute: expect.any(String), concurrentAiOperations: expect.any(String),
      features: expect.any(String), validTo: expect.any(String),
    })
    expect(result.material).toBeNull()
  })
})

describe('SubscriptionCreationForm', () => {
  it('focuses a linked error summary and preserves entered values', async () => {
    const user = userEvent.setup()
    render(<SubscriptionCreationForm clientId={CLIENT_ID} onConfirm={vi.fn()} now={() => NOW} />)
    await user.type(screen.getByLabelText('Plan name'), ' Pro ')
    await user.type(screen.getByLabelText('Cycle credit amount'), '1.12345')
    fireEvent.submit(screen.getByRole('button', { name: 'Review subscription' }).closest('form')!)

    const summary = screen.getByRole('alert', { name: 'Correct the subscription form' })
    expect(summary).toHaveFocus()
    expect(screen.getByLabelText('Plan name')).toHaveValue(' Pro ')
    expect(screen.getByLabelText('Cycle credit amount')).toHaveValue('1.12345')
    await user.click(screen.getByRole('link', { name: /Plan name/ }))
    expect(screen.getByLabelText('Plan name')).toHaveFocus()
  })

  it('keeps the obsolete tierless submission unavailable without inferring a tier', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SubscriptionCreationForm clientId={CLIENT_ID} onConfirm={onConfirm} now={() => NOW} />)
    await user.type(screen.getByLabelText('Plan name'), 'Pro')
    await user.type(screen.getByLabelText('Cycle credit amount'), '1250.0000')
    await user.type(screen.getByLabelText('Requests per minute'), '60')
    await user.type(screen.getByLabelText('Concurrent AI operations'), '4')
    await user.click(screen.getByLabelText('Content generation'))
    await user.type(screen.getByLabelText('Valid from (UTC)'), '2026-02-15T12:00')
    await user.type(screen.getByLabelText('Valid to (UTC, optional)'), '2026-03-15T12:00')

    const review = screen.getByRole('button', { name: 'Review subscription' })
    expect(review).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/unavailable.*explicit tier/i)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(review)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clears private draft material on auth refresh', async () => {
    const user = userEvent.setup()
    render(<SubscriptionCreationForm clientId={CLIENT_ID} onConfirm={vi.fn()} now={() => NOW} />)
    await user.type(screen.getByLabelText('Plan name'), 'Private plan')
    window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { waitUntil: vi.fn() } }))
    await waitFor(() => expect(screen.getByLabelText('Plan name')).toHaveValue(''))
  })
})

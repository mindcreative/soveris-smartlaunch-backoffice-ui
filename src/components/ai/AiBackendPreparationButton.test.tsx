import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { AiBackendPreparationButton } from './AiBackendPreparationButton'

const prepare = vi.hoisted(() => vi.fn())
vi.mock('../../api/aiBackendPreparation', () => ({ prepareAiBackend: prepare }))
beforeEach(() => { prepare.mockReset() })

it('prepares once and refreshes eligibility without submitting a generation', async () => {
  prepare.mockResolvedValue(undefined)
  const refreshed = vi.fn().mockResolvedValue(undefined)
  render(<AiBackendPreparationButton kind="image" allowed onReady={refreshed} />)
  await userEvent.click(screen.getByRole('button', { name: 'Prepare AI' }))
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(prepare.mock.calls[0]?.[0]).toBe('image')
  expect(refreshed).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('Generation still requires eligibility and admission')
})

it('does not offer preparation without current permission', () => {
  render(<AiBackendPreparationButton kind="content" allowed={false} onReady={vi.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(prepare).not.toHaveBeenCalled()
})

it('a busy controller leaves a safe message and performs no eligibility refresh', async () => {
  prepare.mockRejectedValue(new Error('busy'))
  const refreshed = vi.fn()
  render(<AiBackendPreparationButton kind="content" allowed onReady={refreshed} />)
  await userEvent.click(screen.getByRole('button', { name: 'Prepare AI' }))
  expect(screen.getByRole('status')).toHaveTextContent('No generation was submitted')
  expect(refreshed).not.toHaveBeenCalled()
})

it('resets after permission cancellation and ignores the stale completion', async () => {
  let finishOld!: () => void
  let finishNew!: () => void
  prepare.mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve }))
  const refreshed = vi.fn().mockResolvedValue(undefined)
  const view = render(<AiBackendPreparationButton kind="content" allowed onReady={refreshed} />)
  await userEvent.click(screen.getByRole('button'))
  const signal = prepare.mock.calls[0]?.[1] as AbortSignal
  view.rerender(<AiBackendPreparationButton kind="content" allowed={false} onReady={refreshed} />)
  expect(signal.aborted).toBe(true)
  view.rerender(<AiBackendPreparationButton kind="content" allowed onReady={refreshed} />)
  expect(screen.getByRole('button')).toBeEnabled()
  await userEvent.click(screen.getByRole('button'))
  await act(async () => { finishOld() })
  expect(refreshed).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toBeDisabled()
  await act(async () => { finishNew() })
  expect(refreshed).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button')).toBeEnabled()
})

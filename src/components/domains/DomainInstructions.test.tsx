import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DomainInstructions } from './DomainInstructions'
import { parseDomain } from '../../api/domainContracts'
import fixture from '../../api/__fixtures__/domains-http.json'
const wire = fixture.cases.find(c => c.name === 'detail')!.responseBody
const domain = parseDomain(wire, JSON.parse(wire).clientId)
it('copies exact complete records, retaining selectable instructions after clipboard failure', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<DomainInstructions domain={domain} />)
  fireEvent.click(screen.getByRole('button', { name: /Copy ownership record/ }))
  await waitFor(() => expect(screen.getByText(/Copy unavailable. Select the record text/)).toBeVisible())
  expect(writeText.mock.calls[0][0]).toContain(domain.verification.record.value)
  expect(writeText.mock.calls[0][0]).toContain(`TTL ${domain.verification.record.ttlSeconds}`)
  expect((screen.getByLabelText('Ownership record text') as HTMLTextAreaElement).value).toContain(domain.verification.record.name)
  expect(screen.getByText(/TXT proves ownership/)).toBeVisible()
})

import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { DomainReleasePanel } from './DomainReleasePanel'
import { parseDomainRelease } from '../../api/domainContracts'
import fixture from '../../api/__fixtures__/domains-http.json'
const wire = fixture.cases.find(c => c.name === 'release-status')!.responseBody
const receipt = parseDomainRelease(wire, JSON.parse(wire).domainId)
it('keeps reservation and capacity consumed until the receipt confirms cleanup', () => {
  const view = render(<DomainReleasePanel receipt={receipt} />)
  expect(screen.getByText(/hostname remains reserved/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  view.rerender(<DomainReleasePanel receipt={{ ...receipt, state: 'released', completedAt: receipt.requestedAt }} />)
  expect(screen.getByText(/Cleanup confirmed for this immutable/)).toBeVisible()
  expect(screen.getByText(/never authorizes or controls a later claim/)).toBeVisible()
})
it('offers truthful attention guidance while backend recovery continues', () => {
  render(<DomainReleasePanel receipt={{ ...receipt, state: 'action_required', lastErrorCode: 'provider_failure' }} />)
  expect(screen.getByText(/Backend recovery may continue under the same release identity/)).toBeVisible()
})

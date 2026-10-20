import { render, screen, within, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PlatformHealthComponents } from './PlatformHealthComponents'
import { parseHealthSummary } from '@/api/healthApi'
import fixture from '@/api/fixtures/health-v2.json'
afterEach(cleanup)
it('labels scoped readiness, idle lifecycle, freshness and unverified writes without green idle', () => {
  const summary = parseHealthSummary(fixture)
  const row = summary.components.find(row => row.alias === 'provider_content')!
  Object.assign(row, { status: 'unknown', state: 'observed', lifecycle: 'idle_on_demand', reasonCode: 'idle_on_demand', ageSeconds: 2, validForSeconds: 13, executionReady: false })
  render(<PlatformHealthComponents summary={summary} />)
  expect(screen.getByText('Backoffice API process')).toBeVisible()
  expect(screen.queryByText('API', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('Overall readiness — API control plane')).toBeVisible()
  expect(screen.getByText('Idle — starts on demand')).not.toHaveClass('bg-success-soft')
  expect(screen.getByText('Observation: observed · 2 seconds old')).toBeVisible()
  expect(screen.getAllByText('Write capability unverified').length).toBeGreaterThan(0)
  expect(within(screen.getByText('AI Worker', { selector: 'dt' }).parentElement!).getByText('unknown')).toBeVisible()
})

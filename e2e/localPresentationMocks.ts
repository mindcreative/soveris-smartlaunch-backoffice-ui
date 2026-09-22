import type { Page, Route } from '@playwright/test'

const instantKeys = new Set([
  'asOf', 'stateAsOf', 'historyAsOf', 'validFrom', 'validTo', 'createdAt', 'updatedAt',
  'requestedAt', 'artifactExpiresAt', 'referenceExpiresAt', 'cycleStart', 'cycleEnd',
  'billingCycleAnchor', 'effectiveCycleStart', 'effectiveCycleEnd', 'scheduledAt',
  'evaluatedAt', 'measuredAt', 'nextBoundary', 'operationAsOf', 'effectiveAt',
  'lossAt', 'accessUntil', 'earliestProofExpiry', 'proofExpiresAt', 'dueAt',
  'recordedAt', 'restoredAt', 'commandEffectiveAt', 'observedAt',
])

export function localizeFixture(text: string): string {
  return text.replace(/"([A-Za-z][A-Za-z0-9]*)"\s*:\s*"([^"\r\n]+)"/g,
    (original, key: string, value: string) => {
      if (!instantKeys.has(key)) return original
      const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value)
      if (!match) return original
      return `"${key}":"${match[1]}.${(match[2] ?? '').padEnd(6, '0')}"`
    })
}

export async function installTimeZoneRoute(page: Page): Promise<void> {
  await page.route('**/api/backoffice/me/timezone', async (route) => {
    throw new Error(`Unexpected timezone request: ${route.request().method()} ${route.request().url()}`)
  })
}

export async function fulfillLocal(route: Route, options: Parameters<Route['fulfill']>[0]): Promise<void> {
  const body = options.body && typeof options.body === 'string' &&
    options.contentType?.includes('json') && (options.status ?? 200) < 300
    ? localizeFixture(options.body) : options.body
  await route.fulfill({ ...options, body })
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { billingApi } from '../../api/billingApi'
import { billingSubscriptionKeys } from '../../queries/billingQueries'
import type { BillingSubscriptionState, ResourceAccessPreview } from '../../types/billing'
import { SubscriptionTierControls } from './SubscriptionTierControls'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const AT = '2026-09-20T12:00:00.000000Z'
const STATE: BillingSubscriptionState = {
  clientId: CLIENT, stateAsOf: AT,
  current: {
    subscriptionId: SUBSCRIPTION, creationOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab', clientId: CLIENT,
    planName: 'Pro', subscriptionTier: 'brand', tierRevision: '7', cycleCreditAmount: '100',
    entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 }, featureFlags: { contentGeneration: true, imageGeneration: true } },
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    billingCycleAnchor: AT, status: 'active', validFrom: AT, validTo: null, createdAt: AT, updatedAt: AT,
  }, pendingChange: null, subscriptionHistory: [],
  grantHistory: { items: [], historyAsOf: AT, nextCursor: null },
}
const PREVIEW: ResourceAccessPreview = {
  clientId: CLIENT, subscriptionId: SUBSCRIPTION, action: 'schedule',
  currentSubscriptionTier: 'brand', targetSubscriptionTier: 'basic',
  effectivePolicy: 'next_billing_cycle', statusRevision: '4', classificationRevision: '5',
  tierRevision: '7', pendingTierChangeOperationId: null,
  policyPublicationId: '22222222-2222-3333-8444-555555555555', policyActivationRevision: '9',
  policyVersion: 'input-04-v1', policyHash: 'abc', commandEffectiveAt: '2026-09-30T08:30:00.000000Z', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', evaluatedAt: AT,
  lossAt: '2026-09-30T08:30:00.000000Z', accessUntil: '2026-10-07T08:30:00.000000Z',
  earliestProofExpiry: null,
  retainedCount: 1, totalCount: 3, graceCount: 2, suspendedCount: 0,
  deadlineGroups: [{ lossAt: '2026-09-30T08:30:00.000000Z', accessUntil: '2026-10-07T08:30:00.000000Z', graceCount: 2, newlyAffectedCount: 2 }],
  deadlineGroupsTruncated: false, unlistedGraceCount: 0, unlistedNewlyAffectedCount: 0,
  affectedResourcesTruncated: false,
  preservationFacts: { contentPreserved: true, assetsPreserved: true, creditsUnchanged: true, acceptedAiWorkUnchanged: true },
  affectedResources: [],
}

function renderControls(state: BillingSubscriptionState = STATE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const preflight = vi.fn().mockResolvedValue(state)
  render(<QueryClientProvider client={client}><SubscriptionTierControls
    clientId={CLIENT} state={state} preflight={preflight}
  /></QueryClientProvider>)
  return { preflight, client }
}

describe('SubscriptionTierControls', () => {
  it('does not request a preview when the fresh subscription read is unavailable', async () => {
    const preview = vi.spyOn(billingApi, 'getResourceAccessPreview')
    const { preflight } = renderControls()
    preflight.mockResolvedValueOnce(null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Fresh subscription evidence is required before confirmation.'
    ))
    expect(preview).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Tier change justification' }))
      .toHaveAttribute('aria-invalid', 'false')
  })

  it('purges private state when fresh preflight reports the subscription missing', async () => {
    const preview = vi.spyOn(billingApi, 'getResourceAccessPreview')
    const { preflight, client } = renderControls()
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    preflight.mockRejectedValueOnce({ status: 404, code: 'subscription_not_found' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    await waitFor(() => expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT)))
      .toBeUndefined())
    expect(preview).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers only configured paid targets and binds the approved server-owned downgrade copy', async () => {
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    const { preflight } = renderControls()
    const user = userEvent.setup()
    const target = screen.getByRole('combobox', { name: 'Target tier' })
    expect(within(target).queryByRole('option', { name: /freemium/i })).not.toBeInTheDocument()
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Basic', 'Brand Premium',
    ])
    await user.click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm subscription tier change' })
    expect(dialog).toHaveTextContent(`At ${PREVIEW.lossAt}, new paid work will stop. 1 of 3 resources will remain active. The policy grace deadline for 2 affected resources is ${PREVIEW.accessUntil}.`)
    expect(dialog).toHaveTextContent('They may remain available until then if ownership, TLS, and routing evidence stays current')
    expect(billingApi.getResourceAccessPreview).toHaveBeenCalledWith(
      CLIENT, SUBSCRIPTION,
      expect.objectContaining({ action: 'schedule', expectedTierRevision: '7', subscriptionTier: 'basic' }),
      expect.any(AbortSignal)
    )
  })

  it('shows known earlier proof expiry separately from the policy grace deadline', async () => {
    const proofExpiresAt = '2026-10-03T08:30:00.000000Z'
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue({
      ...PREVIEW, earliestProofExpiry: proofExpiresAt,
      affectedResources: [{ resourceType: 'domain_binding',
        resourceId: '33333333-2222-3333-8444-555555555555', disposition: 'grace',
        accessUntil: PREVIEW.accessUntil, proofExpiresAt }],
    })
    renderControls()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(`policy grace deadline for 2 affected resources is ${PREVIEW.accessUntil}`)
    expect(dialog).toHaveTextContent(`earliest known ownership or TLS proof expiry for an affected domain binding is ${proofExpiresAt}`)
    expect(dialog).toHaveTextContent('This does not change the policy grace deadline')
    expect(dialog).not.toHaveTextContent('active routes')
  })

  it('uses safe modal focus and restores the command trigger on Escape', async () => {
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    renderControls()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Schedule for next cycle' })
    await user.click(trigger)
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps fresh preflight visibly busy and prevents a second preview attempt', async () => {
    const preview = vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    const { preflight } = renderControls()
    let release!: (state: BillingSubscriptionState) => void
    preflight.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    expect(screen.getByRole('status')).toHaveTextContent('Checking fresh subscription authority')
    expect(screen.getByRole('button', { name: 'Schedule for next cycle' })).toBeDisabled()
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(preview).not.toHaveBeenCalled()
    release(STATE)
    await screen.findByRole('dialog')
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('names each mixed grace deadline and distinguishes continuing grace', async () => {
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue({
      ...PREVIEW, lossAt: '2026-09-19T12:00:00.000000Z',
      accessUntil: '2026-09-22T12:00:00.000000Z',
      deadlineGroups: [
        { lossAt: '2026-09-19T12:00:00.000000Z', accessUntil: '2026-09-22T12:00:00.000000Z',
          graceCount: 1, newlyAffectedCount: 0 },
        { lossAt: '2026-09-30T08:30:00.000000Z', accessUntil: '2026-10-07T08:30:00.000000Z',
          graceCount: 1, newlyAffectedCount: 1 },
      ],
    })
    renderControls()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 already in grace')
    expect(dialog).toHaveTextContent('1 newly affected resource stops new paid work at 2026-09-30')
    expect(dialog).toHaveTextContent('2026-09-22T12:00:00.000000Z')
    expect(dialog).toHaveTextContent('2026-10-07T08:30:00.000000Z')
  })

  it('blocks confirmation when the bounded preview omits deadline groups', async () => {
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue({
      ...PREVIEW, deadlineGroups: [{ ...PREVIEW.deadlineGroups[0], graceCount: 1,
        newlyAffectedCount: 1 }], deadlineGroupsTruncated: true, unlistedGraceCount: 1,
      unlistedNewlyAffectedCount: 1,
    })
    renderControls()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 affected resource in grace has additional deadlines')
    expect(screen.getByRole('button', { name: 'Confirm tier change' })).toBeDisabled()
  })

  it('allows a non-loss action when only continuing deadlines are unlisted', async () => {
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue({
      ...PREVIEW, deadlineGroups: [{ ...PREVIEW.deadlineGroups[0], graceCount: 1,
        newlyAffectedCount: 0 }], deadlineGroupsTruncated: true, unlistedGraceCount: 1,
      unlistedNewlyAffectedCount: 0,
    })
    renderControls()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 affected resource in grace has additional deadlines')
    expect(dialog).not.toHaveTextContent('Confirmation is unavailable')
    expect(screen.getByRole('button', { name: 'Confirm tier change' })).toBeEnabled()
  })

  it('submits the visible replacement target and describes cancellation separately', async () => {
    const pendingState: BillingSubscriptionState = {
      ...STATE,
      pendingTierChange: {
        schemaVersion: 1, operationId: '01991f20-5678-7abc-8abc-1234567890ab',
        subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', effectiveCycleIndex: 1,
        effectiveCycleStart: '2026-09-30T08:30:00.000000Z',
        effectiveCycleEnd: '2026-10-30T08:30:00.000000Z',
        scheduledAt: AT, reason: 'Earlier change',
      },
    }
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockImplementation(
      async (_client, _subscription, request) => ({
        ...PREVIEW, action: request.action, targetSubscriptionTier: request.subscriptionTier,
        pendingTierChangeOperationId: pendingState.pendingTierChange?.operationId ?? null,
        ...(request.action === 'cancel_pending'
          ? { deadlineGroupsTruncated: true, unlistedGraceCount: 1,
              unlistedNewlyAffectedCount: 0,
              deadlineGroups: [{ ...PREVIEW.deadlineGroups[0], graceCount: 1 }] }
          : {}),
      })
    )
    renderControls(pendingState)
    const user = userEvent.setup()
    const target = screen.getByRole('combobox', { name: 'Target tier' })
    expect(target).toHaveValue('brand_premium')
    expect(within(target).getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Replace pending tier' }))
    await screen.findByRole('dialog')
    expect(billingApi.getResourceAccessPreview).toHaveBeenCalledWith(
      CLIENT, SUBSCRIPTION,
      expect.objectContaining({ action: 'replace', subscriptionTier: 'brand_premium' }),
      expect.any(AbortSignal)
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Cancel pending tier' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm pending tier cancellation' })
    expect(dialog).toHaveTextContent('Cancel the pending basic tier change')
    expect(dialog).not.toHaveTextContent('Change brand to basic')
    expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeEnabled()
    expect(dialog).not.toHaveTextContent('Confirmation is unavailable')
    expect(billingApi.getResourceAccessPreview).toHaveBeenCalledWith(
      CLIENT, SUBSCRIPTION,
      expect.objectContaining({ action: 'cancel_pending', subscriptionTier: 'basic' }),
      expect.any(AbortSignal)
    )
  })

  it('links only a reason-specific error to the reason field', async () => {
    renderControls()
    const user = userEvent.setup()
    const reason = screen.getByRole('textbox', { name: 'Tier change justification' })
    await user.clear(reason)
    await user.click(screen.getByRole('button', { name: 'Schedule for next cycle' }))
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(reason).toHaveAccessibleDescription(/1–512 characters/)
    await user.type(reason, 'Approved change')
    expect(reason).toHaveAttribute('aria-invalid', 'false')
  })
})
